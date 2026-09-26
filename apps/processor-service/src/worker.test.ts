import type { Channel, ConsumeMessage } from 'amqplib';
import { describe, expect, it, jest } from '@jest/globals';
import type { ProcessingRequestedEventV1 } from '@fiap-x/contracts';
import { VIDEO_EVENT_TOPOLOGY } from '@fiap-x/infrastructure';

import type { ProcessingEventHandler } from './processing-event-handler.js';
import { startProcessorWorker } from './worker.js';

const requestedEvent: ProcessingRequestedEventV1 = {
  eventId: '11111111-1111-4111-8111-111111111111',
  eventType: 'video.processing.requested',
  version: 1,
  occurredAt: '2026-01-01T00:00:00.000Z',
  payload: {
    videoId: '22222222-2222-4222-8222-222222222222',
    userId: '33333333-3333-4333-8333-333333333333',
    sourceObjectKey: '/storage/input.mp4',
    fps: 1,
    attempt: 1,
  },
};

type Consumer = (message: ConsumeMessage | null) => void | Promise<void>;

function message(value: unknown): ConsumeMessage {
  return {
    content: Buffer.from(JSON.stringify(value)),
    properties: { contentType: 'application/json' },
  } as unknown as ConsumeMessage;
}

function createFixture() {
  let consumer: Consumer | undefined;
  const channel = {
    prefetch: jest.fn(async () => undefined),
    consume: jest.fn(async (_queue: string, callback: Consumer) => {
      consumer = callback;
      return { consumerTag: 'processor-consumer' };
    }),
    cancel: jest.fn(async () => ({})),
    ack: jest.fn(),
    nack: jest.fn(),
  } as unknown as Channel;
  const handler: Pick<ProcessingEventHandler, 'handle'> = {
    handle: jest.fn(async () => undefined),
  };
  const onInvalidMessage = jest.fn();

  return {
    channel,
    handler,
    onInvalidMessage,
    getConsumer: () => {
      if (consumer === undefined) {
        throw new Error('Consumer was not registered');
      }
      return consumer;
    },
  };
}

describe('startProcessorWorker', () => {
  it('uses the shared request queue with prefetch 1 and acknowledges a valid event', async () => {
    const fixture = createFixture();

    await startProcessorWorker({
      channel: fixture.channel,
      handler: fixture.handler,
      prefetch: 1,
      onInvalidMessage: fixture.onInvalidMessage,
    });
    const receivedMessage = message(requestedEvent);
    await fixture.getConsumer()(receivedMessage);

    expect(fixture.channel.prefetch).toHaveBeenCalledWith(1);
    expect(fixture.channel.consume).toHaveBeenCalledWith(
      VIDEO_EVENT_TOPOLOGY.queues.processorRequests,
      expect.any(Function),
      { noAck: false },
    );
    expect(fixture.handler.handle).toHaveBeenCalledTimes(1);
    expect(fixture.handler.handle).toHaveBeenCalledWith(requestedEvent);
    expect(fixture.channel.ack).toHaveBeenCalledWith(receivedMessage);
  });

  it('dead-letters an invalid event using the shared consumer behavior', async () => {
    const fixture = createFixture();
    await startProcessorWorker({
      channel: fixture.channel,
      handler: fixture.handler,
      prefetch: 1,
      onInvalidMessage: fixture.onInvalidMessage,
    });
    const invalidMessage = message({ ...requestedEvent, version: 2 });

    await fixture.getConsumer()(invalidMessage);

    expect(fixture.onInvalidMessage).toHaveBeenCalledWith(invalidMessage);
    expect(fixture.handler.handle).not.toHaveBeenCalled();
    expect(fixture.channel.nack).toHaveBeenCalledWith(invalidMessage, false, false);
  });

  it('requests redelivery when the handler propagates an unexpected failure', async () => {
    const fixture = createFixture();
    jest.mocked(fixture.handler.handle).mockRejectedValueOnce(new Error('broker unavailable'));
    await startProcessorWorker({
      channel: fixture.channel,
      handler: fixture.handler,
      prefetch: 1,
    });
    const receivedMessage = message(requestedEvent);

    await fixture.getConsumer()(receivedMessage);

    expect(fixture.channel.ack).not.toHaveBeenCalled();
    expect(fixture.channel.nack).toHaveBeenCalledWith(receivedMessage, false, true);
  });

  it('cancels new deliveries and waits for the active job to finish', async () => {
    const fixture = createFixture();
    let finishJob: (() => void) | undefined;
    jest.mocked(fixture.handler.handle).mockImplementationOnce(
      async () =>
        new Promise<void>((resolve) => {
          finishJob = resolve;
        }),
    );
    const worker = await startProcessorWorker({
      channel: fixture.channel,
      handler: fixture.handler,
      prefetch: 1,
    });
    const delivery = fixture.getConsumer()(message(requestedEvent));
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    let idle = false;
    const drain = worker.waitForIdle().then(() => {
      idle = true;
    });

    await worker.stopAccepting();
    expect(fixture.channel.cancel).toHaveBeenCalledWith('processor-consumer');
    expect(idle).toBe(false);

    finishJob?.();
    await delivery;
    await drain;
    expect(idle).toBe(true);
  });
});
