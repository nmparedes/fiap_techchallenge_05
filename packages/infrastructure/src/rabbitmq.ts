import { once } from 'node:events';

import * as amqp from 'amqplib';
import type { Channel, ConfirmChannel, ConsumeMessage, Options, Replies } from 'amqplib';
import {
  ProcessingFailedEventV1Schema,
  ProcessingRequestedEventV1Schema,
  ProcessingStatusEventV1Schema,
  registerContractFormats,
  type ProcessingEventV1,
  type ProcessingFailedEventV1,
  type ProcessingRequestedEventV1,
  type ProcessingStatusEventV1,
} from '@fiap-x/contracts';
import { Value } from '@sinclair/typebox/value';
import type { TSchema } from '@sinclair/typebox';

import type { RabbitMqConfig } from './config.js';

export type RabbitMqConnector = typeof amqp.connect;

export const VIDEO_EVENT_TOPOLOGY = {
  exchanges: {
    events: 'video.events',
    deadLetter: 'video.events.dead-letter',
  },
  queues: {
    processorRequests: 'video.processing.requests.processor',
    videoStatus: 'video.processing.status.video-service',
    notificationFailures: 'video.processing.failures.notification-service',
    deadLetters: 'video.events.dead-letter',
  },
  routingKeys: {
    processingRequested: 'video.processing.requested',
    processingStarted: 'video.processing.started',
    processingCompleted: 'video.processing.completed',
    processingFailed: 'video.processing.failed',
  },
} as const;

export interface VideoEventQueueDeclaration {
  name: string;
  bindings: readonly string[];
}

export const VIDEO_EVENT_QUEUES: readonly VideoEventQueueDeclaration[] = [
  {
    name: VIDEO_EVENT_TOPOLOGY.queues.processorRequests,
    bindings: [VIDEO_EVENT_TOPOLOGY.routingKeys.processingRequested],
  },
  {
    name: VIDEO_EVENT_TOPOLOGY.queues.videoStatus,
    bindings: [
      VIDEO_EVENT_TOPOLOGY.routingKeys.processingStarted,
      VIDEO_EVENT_TOPOLOGY.routingKeys.processingCompleted,
      VIDEO_EVENT_TOPOLOGY.routingKeys.processingFailed,
    ],
  },
  {
    name: VIDEO_EVENT_TOPOLOGY.queues.notificationFailures,
    bindings: [VIDEO_EVENT_TOPOLOGY.routingKeys.processingFailed],
  },
];

export interface VideoEventConsumerOptions {
  prefetch?: number;
  requeueOnHandlerError?: boolean;
  onInvalidMessage?: (message: ConsumeMessage) => void;
}

export type VideoEventHandler<TEvent> = (event: TEvent, message: ConsumeMessage) => Promise<void>;

export async function connectRabbitMq(
  config: RabbitMqConfig,
  connector: RabbitMqConnector = amqp.connect,
) {
  return connector(config.url);
}

export async function assertVideoEventTopology(channel: Channel): Promise<void> {
  await channel.assertExchange(VIDEO_EVENT_TOPOLOGY.exchanges.events, 'topic', { durable: true });
  await channel.assertExchange(VIDEO_EVENT_TOPOLOGY.exchanges.deadLetter, 'topic', {
    durable: true,
  });
  await channel.assertQueue(VIDEO_EVENT_TOPOLOGY.queues.deadLetters, {
    durable: true,
    arguments: { 'x-queue-type': 'quorum' },
  });
  await channel.bindQueue(
    VIDEO_EVENT_TOPOLOGY.queues.deadLetters,
    VIDEO_EVENT_TOPOLOGY.exchanges.deadLetter,
    '#',
  );

  for (const queue of VIDEO_EVENT_QUEUES) {
    const queueOptions: Options.AssertQueue = {
      durable: true,
      arguments: {
        'x-queue-type': 'quorum',
        'x-dead-letter-exchange': VIDEO_EVENT_TOPOLOGY.exchanges.deadLetter,
      },
    };

    await channel.assertQueue(queue.name, queueOptions);

    for (const routingKey of queue.bindings) {
      await channel.bindQueue(queue.name, VIDEO_EVENT_TOPOLOGY.exchanges.events, routingKey);
    }
  }
}

export async function publishVideoEvent(
  channel: ConfirmChannel,
  event: ProcessingEventV1,
): Promise<void> {
  const accepted = channel.publish(
    VIDEO_EVENT_TOPOLOGY.exchanges.events,
    event.eventType,
    Buffer.from(JSON.stringify(event)),
    {
      contentType: 'application/json',
      contentEncoding: 'utf-8',
      deliveryMode: 2,
      type: event.eventType,
      messageId: event.eventId,
      timestamp: Math.floor(Date.parse(event.occurredAt) / 1000),
    },
  );

  if (!accepted) {
    await once(channel, 'drain');
  }

  await channel.waitForConfirms();
}

function readPrefetch(options: VideoEventConsumerOptions): number {
  const prefetch = options.prefetch ?? 1;

  if (!Number.isSafeInteger(prefetch) || prefetch < 1) {
    throw new RangeError('RabbitMQ prefetch must be a positive integer');
  }

  return prefetch;
}

function parseMessage(message: ConsumeMessage): unknown {
  if (message.properties.contentType !== 'application/json') {
    return undefined;
  }

  try {
    return JSON.parse(message.content.toString('utf8')) as unknown;
  } catch {
    return undefined;
  }
}

async function consumeValidatedEvent<TEvent>(
  channel: Channel,
  queue: string,
  schema: TSchema,
  handler: VideoEventHandler<TEvent>,
  options: VideoEventConsumerOptions,
): Promise<Replies.Consume> {
  registerContractFormats();
  await channel.prefetch(readPrefetch(options));

  return channel.consume(
    queue,
    async (message) => {
      if (message === null) {
        return;
      }

      const value = parseMessage(message);
      if (!Value.Check(schema, value)) {
        options.onInvalidMessage?.(message);
        channel.nack(message, false, false);
        return;
      }

      try {
        await handler(value as TEvent, message);
        channel.ack(message);
      } catch {
        channel.nack(message, false, options.requeueOnHandlerError ?? false);
      }
    },
    { noAck: false },
  );
}

export function consumeProcessingRequests(
  channel: Channel,
  handler: VideoEventHandler<ProcessingRequestedEventV1>,
  options: VideoEventConsumerOptions = {},
): Promise<Replies.Consume> {
  return consumeValidatedEvent(
    channel,
    VIDEO_EVENT_TOPOLOGY.queues.processorRequests,
    ProcessingRequestedEventV1Schema,
    handler,
    options,
  );
}

export function consumeProcessingStatusEvents(
  channel: Channel,
  handler: VideoEventHandler<ProcessingStatusEventV1>,
  options: VideoEventConsumerOptions = {},
): Promise<Replies.Consume> {
  return consumeValidatedEvent(
    channel,
    VIDEO_EVENT_TOPOLOGY.queues.videoStatus,
    ProcessingStatusEventV1Schema,
    handler,
    options,
  );
}

export function consumeProcessingFailures(
  channel: Channel,
  handler: VideoEventHandler<ProcessingFailedEventV1>,
  options: VideoEventConsumerOptions = {},
): Promise<Replies.Consume> {
  return consumeValidatedEvent(
    channel,
    VIDEO_EVENT_TOPOLOGY.queues.notificationFailures,
    ProcessingFailedEventV1Schema,
    handler,
    options,
  );
}
