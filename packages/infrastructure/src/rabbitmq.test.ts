import { EventEmitter } from 'node:events';

import { describe, expect, it, jest } from '@jest/globals';
import type { Channel, ConfirmChannel, ConsumeMessage } from 'amqplib';
import type {
  ProcessingFailedEventV1,
  ProcessingRequestedEventV1,
  ProcessingStatusEventV1,
} from '@fiap-x/contracts';

import {
  VIDEO_EVENT_QUEUES,
  VIDEO_EVENT_TOPOLOGY,
  assertVideoEventTopology,
  connectRabbitMq,
  consumeProcessingFailures,
  consumeProcessingRequests,
  consumeProcessingStatusEvents,
  publishVideoEvent,
  type RabbitMqConnector,
  type VideoEventHandler,
} from './rabbitmq.js';

const requestedEvent = {
  eventId: '11111111-1111-4111-8111-111111111111',
  eventType: 'video.processing.requested',
  version: 1,
  occurredAt: '2026-09-01T12:00:00.000Z',
  payload: {
    videoId: '22222222-2222-4222-8222-222222222222',
    userId: '33333333-3333-4333-8333-333333333333',
    sourceObjectKey: 'videos/input.mp4',
    fps: 1,
    attempt: 1,
  },
} satisfies ProcessingRequestedEventV1;

const failedEvent = {
  eventId: '44444444-4444-4444-8444-444444444444',
  eventType: 'video.processing.failed',
  version: 1,
  occurredAt: '2026-09-01T12:01:00.000Z',
  payload: {
    videoId: requestedEvent.payload.videoId,
    userId: requestedEvent.payload.userId,
    errorCode: 'FFMPEG_ERROR',
    errorMessage: 'Invalid video',
    fps: 1,
    attempt: 1,
  },
} satisfies ProcessingFailedEventV1;

const startedEvent = {
  eventId: '55555555-5555-4555-8555-555555555555',
  eventType: 'video.processing.started',
  version: 1,
  occurredAt: '2026-09-01T12:00:30.000Z',
  payload: {
    videoId: requestedEvent.payload.videoId,
    userId: requestedEvent.payload.userId,
    fps: 1,
    attempt: 1,
  },
} satisfies ProcessingStatusEventV1;

const completedEvent = {
  eventId: '66666666-6666-4666-8666-666666666666',
  eventType: 'video.processing.completed',
  version: 1,
  occurredAt: '2026-09-01T12:02:00.000Z',
  payload: {
    videoId: requestedEvent.payload.videoId,
    userId: requestedEvent.payload.userId,
    archiveObjectKey: 'videos/output.zip',
    fps: 1,
    attempt: 1,
  },
} satisfies ProcessingStatusEventV1;

class RabbitChannelMock extends EventEmitter {
  public readonly assertExchange = jest.fn<Channel['assertExchange']>();
  public readonly assertQueue = jest.fn<Channel['assertQueue']>();
  public readonly bindQueue = jest.fn<Channel['bindQueue']>();
  public readonly publish = jest.fn<ConfirmChannel['publish']>();
  public readonly waitForConfirms = jest.fn<ConfirmChannel['waitForConfirms']>();
  public readonly prefetch = jest.fn<Channel['prefetch']>();
  public readonly consume = jest.fn<Channel['consume']>();
  public readonly ack = jest.fn<Channel['ack']>();
  public readonly nack = jest.fn<Channel['nack']>();

  private onMessage: ((message: ConsumeMessage | null) => void) | undefined;

  public constructor() {
    super();
    this.consume.mockImplementation(async (_queue, onMessage) => {
      this.onMessage = onMessage;
      return { consumerTag: 'test-consumer' };
    });
  }

  public async deliver(message: ConsumeMessage | null): Promise<void> {
    if (this.onMessage === undefined) {
      throw new Error('Consumer was not registered');
    }

    await this.onMessage(message);
  }
}

function createMessage(value: unknown, contentType = 'application/json'): ConsumeMessage {
  return {
    content: Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)),
    fields: {
      consumerTag: 'test-consumer',
      deliveryTag: 1,
      redelivered: false,
      exchange: VIDEO_EVENT_TOPOLOGY.exchanges.events,
      routingKey: requestedEvent.eventType,
    },
    properties: { contentType },
  } as unknown as ConsumeMessage;
}

describe('RabbitMQ infrastructure', () => {
  it('connects through the supplied amqplib connector', async () => {
    const connection = { close: jest.fn() };
    const connector = jest
      .fn<RabbitMqConnector>()
      .mockResolvedValue(connection as unknown as Awaited<ReturnType<RabbitMqConnector>>);

    await expect(connectRabbitMq({ url: 'amqp://broker.internal' }, connector)).resolves.toBe(
      connection,
    );
    expect(connector).toHaveBeenCalledWith('amqp://broker.internal');
  });

  it('declares the durable topic, quorum queues, bindings, and shared dead-letter queue', async () => {
    const channel = new RabbitChannelMock();

    await assertVideoEventTopology(channel as unknown as Channel);

    expect(channel.assertExchange).toHaveBeenNthCalledWith(1, 'video.events', 'topic', {
      durable: true,
    });
    expect(channel.assertExchange).toHaveBeenNthCalledWith(
      2,
      VIDEO_EVENT_TOPOLOGY.exchanges.deadLetter,
      'topic',
      { durable: true },
    );
    expect(channel.assertQueue).toHaveBeenCalledTimes(VIDEO_EVENT_QUEUES.length + 1);
    expect(channel.bindQueue).toHaveBeenCalledWith(
      VIDEO_EVENT_TOPOLOGY.queues.deadLetters,
      VIDEO_EVENT_TOPOLOGY.exchanges.deadLetter,
      '#',
    );
    expect(channel.bindQueue).toHaveBeenCalledWith(
      VIDEO_EVENT_TOPOLOGY.queues.processorRequests,
      VIDEO_EVENT_TOPOLOGY.exchanges.events,
      VIDEO_EVENT_TOPOLOGY.routingKeys.processingRequested,
    );
    expect(channel.bindQueue).toHaveBeenCalledWith(
      VIDEO_EVENT_TOPOLOGY.queues.notificationFailures,
      VIDEO_EVENT_TOPOLOGY.exchanges.events,
      VIDEO_EVENT_TOPOLOGY.routingKeys.processingFailed,
    );
    for (const routingKey of [
      VIDEO_EVENT_TOPOLOGY.routingKeys.processingStarted,
      VIDEO_EVENT_TOPOLOGY.routingKeys.processingCompleted,
      VIDEO_EVENT_TOPOLOGY.routingKeys.processingFailed,
    ]) {
      expect(channel.bindQueue).toHaveBeenCalledWith(
        VIDEO_EVENT_TOPOLOGY.queues.videoStatus,
        VIDEO_EVENT_TOPOLOGY.exchanges.events,
        routingKey,
      );
    }
    expect(channel.assertQueue).toHaveBeenCalledWith(
      VIDEO_EVENT_TOPOLOGY.queues.videoStatus,
      expect.objectContaining({
        durable: true,
        arguments: {
          'x-queue-type': 'quorum',
          'x-dead-letter-exchange': VIDEO_EVENT_TOPOLOGY.exchanges.deadLetter,
        },
      }),
    );
  });

  it('publishes persistent events with metadata and waits for publisher confirmation', async () => {
    const channel = new RabbitChannelMock();
    channel.publish.mockReturnValue(true);
    channel.waitForConfirms.mockResolvedValue(undefined);

    await publishVideoEvent(channel as unknown as ConfirmChannel, requestedEvent);

    expect(channel.publish).toHaveBeenCalledWith(
      'video.events',
      'video.processing.requested',
      Buffer.from(JSON.stringify(requestedEvent)),
      {
        contentType: 'application/json',
        contentEncoding: 'utf-8',
        deliveryMode: 2,
        type: requestedEvent.eventType,
        messageId: requestedEvent.eventId,
        timestamp: Math.floor(Date.parse(requestedEvent.occurredAt) / 1000),
      },
    );
    expect(channel.waitForConfirms).toHaveBeenCalledTimes(1);
  });

  it('honors channel backpressure before waiting for confirmation', async () => {
    const channel = new RabbitChannelMock();
    channel.publish.mockImplementation(() => {
      queueMicrotask(() => channel.emit('drain'));
      return false;
    });
    channel.waitForConfirms.mockResolvedValue(undefined);

    await publishVideoEvent(channel as unknown as ConfirmChannel, failedEvent);

    expect(channel.waitForConfirms).toHaveBeenCalledTimes(1);
  });

  it('consumes a valid processing request with processor prefetch 1 and manual ack', async () => {
    const channel = new RabbitChannelMock();
    const handler = jest.fn<VideoEventHandler<ProcessingRequestedEventV1>>();
    handler.mockResolvedValue(undefined);

    await consumeProcessingRequests(channel as unknown as Channel, handler);
    await channel.deliver(createMessage(requestedEvent));

    expect(channel.prefetch).toHaveBeenCalledWith(1);
    expect(channel.consume).toHaveBeenCalledWith(
      VIDEO_EVENT_TOPOLOGY.queues.processorRequests,
      expect.any(Function),
      { noAck: false },
    );
    expect(handler).toHaveBeenCalledWith(requestedEvent, expect.any(Object));
    expect(channel.ack).toHaveBeenCalledTimes(1);
    expect(channel.nack).not.toHaveBeenCalled();
  });

  it('uses configurable prefetch and validates status and notification events', async () => {
    const statusChannel = new RabbitChannelMock();
    const statusHandler = jest.fn<VideoEventHandler<ProcessingStatusEventV1>>();
    statusHandler.mockResolvedValue(undefined);

    await consumeProcessingStatusEvents(statusChannel as unknown as Channel, statusHandler, {
      prefetch: 8,
    });
    await statusChannel.deliver(createMessage(failedEvent));

    expect(statusChannel.prefetch).toHaveBeenCalledWith(8);
    expect(statusHandler).toHaveBeenCalledWith(failedEvent, expect.any(Object));
    expect(statusChannel.ack).toHaveBeenCalledTimes(1);

    const notificationChannel = new RabbitChannelMock();
    const notificationHandler = jest.fn<VideoEventHandler<ProcessingFailedEventV1>>();
    notificationHandler.mockResolvedValue(undefined);
    await consumeProcessingFailures(notificationChannel as unknown as Channel, notificationHandler);
    await notificationChannel.deliver(createMessage(failedEvent));

    expect(notificationHandler).toHaveBeenCalledWith(failedEvent, expect.any(Object));
    expect(notificationChannel.ack).toHaveBeenCalledTimes(1);
  });

  it.each([startedEvent, completedEvent, failedEvent])(
    'accepts the Video Service status event $eventType',
    async (event) => {
      const channel = new RabbitChannelMock();
      const handler = jest.fn<VideoEventHandler<ProcessingStatusEventV1>>();
      handler.mockResolvedValue(undefined);

      await consumeProcessingStatusEvents(channel as unknown as Channel, handler);
      await channel.deliver(createMessage(event));

      expect(handler).toHaveBeenCalledWith(event, expect.any(Object));
      expect(channel.ack).toHaveBeenCalledTimes(1);
    },
  );

  it('acknowledges a status event only after the persistence handler resolves', async () => {
    const channel = new RabbitChannelMock();
    let completePersistence: (() => void) | undefined;
    const persistence = new Promise<void>((resolve) => {
      completePersistence = resolve;
    });
    const handler = jest
      .fn<VideoEventHandler<ProcessingStatusEventV1>>()
      .mockImplementation(async () => persistence);

    await consumeProcessingStatusEvents(channel as unknown as Channel, handler);
    const delivery = channel.deliver(createMessage(startedEvent));
    await Promise.resolve();
    expect(channel.ack).not.toHaveBeenCalled();

    completePersistence?.();
    await delivery;
    expect(channel.ack).toHaveBeenCalledTimes(1);
  });

  it('dead-letters an invalid status event without requeue or acknowledgement', async () => {
    const channel = new RabbitChannelMock();
    const handler = jest.fn<VideoEventHandler<ProcessingStatusEventV1>>();
    const onInvalidMessage = jest.fn();
    const message = createMessage({ ...startedEvent, version: 2 });

    await consumeProcessingStatusEvents(channel as unknown as Channel, handler, {
      onInvalidMessage,
    });
    await channel.deliver(message);

    expect(handler).not.toHaveBeenCalled();
    expect(channel.ack).not.toHaveBeenCalled();
    expect(channel.nack).toHaveBeenCalledWith(message, false, false);
    expect(onInvalidMessage).toHaveBeenCalledWith(message);
  });

  it.each([
    ['malformed JSON', createMessage('{broken')],
    ['wrong content type', createMessage(requestedEvent, 'text/plain')],
    ['schema mismatch', createMessage({ ...requestedEvent, version: 2 })],
  ])('dead-letters %s without calling the handler', async (_case, message) => {
    const channel = new RabbitChannelMock();
    const handler = jest.fn<VideoEventHandler<ProcessingRequestedEventV1>>();

    await consumeProcessingRequests(channel as unknown as Channel, handler);
    await channel.deliver(message);

    expect(handler).not.toHaveBeenCalled();
    expect(channel.ack).not.toHaveBeenCalled();
    expect(channel.nack).toHaveBeenCalledWith(message, false, false);
  });

  it('dead-letters handler failures by default and can opt into broker redelivery', async () => {
    const failure = new Error('temporary dependency failure');
    const firstChannel = new RabbitChannelMock();
    const firstHandler = jest
      .fn<VideoEventHandler<ProcessingRequestedEventV1>>()
      .mockRejectedValue(failure);
    const firstMessage = createMessage(requestedEvent);

    await consumeProcessingRequests(firstChannel as unknown as Channel, firstHandler);
    await firstChannel.deliver(firstMessage);
    expect(firstChannel.nack).toHaveBeenCalledWith(firstMessage, false, false);

    const secondChannel = new RabbitChannelMock();
    const secondHandler = jest
      .fn<VideoEventHandler<ProcessingRequestedEventV1>>()
      .mockRejectedValue(failure);
    const secondMessage = createMessage(requestedEvent);
    await consumeProcessingRequests(secondChannel as unknown as Channel, secondHandler, {
      requeueOnHandlerError: true,
    });
    await secondChannel.deliver(secondMessage);
    expect(secondChannel.nack).toHaveBeenCalledWith(secondMessage, false, true);
  });

  it('ignores consumer cancellation and rejects invalid prefetch values', async () => {
    const channel = new RabbitChannelMock();
    const handler = jest.fn<VideoEventHandler<ProcessingRequestedEventV1>>();

    await consumeProcessingRequests(channel as unknown as Channel, handler);
    await channel.deliver(null);
    expect(handler).not.toHaveBeenCalled();

    await expect(
      consumeProcessingRequests(channel as unknown as Channel, handler, { prefetch: 0 }),
    ).rejects.toThrow('RabbitMQ prefetch must be a positive integer');
  });
});
