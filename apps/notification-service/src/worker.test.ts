import type { Channel, ConsumeMessage } from 'amqplib';
import { describe, expect, it, jest } from '@jest/globals';
import type { ProcessingFailedEventV1 } from '@fiap-x/contracts';
import { VIDEO_EVENT_TOPOLOGY } from '@fiap-x/infrastructure';

import type { FailureNotificationHandler } from './failure-notification-handler.js';
import { startNotificationWorker } from './worker.js';

const failedEvent: ProcessingFailedEventV1 = {
  eventId: '11111111-1111-4111-8111-111111111111',
  eventType: 'video.processing.failed',
  version: 1,
  occurredAt: '2026-09-01T12:01:00.000Z',
  payload: {
    videoId: '22222222-2222-4222-8222-222222222222',
    userId: '33333333-3333-4333-8333-333333333333',
    errorCode: 'ZIP_ERROR',
    errorMessage: 'archive failed',
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
      return { consumerTag: 'notification-consumer' };
    }),
    cancel: jest.fn(async () => ({})),
    ack: jest.fn(),
    nack: jest.fn(),
  } as unknown as Channel;
  const handler: Pick<FailureNotificationHandler, 'handle'> = {
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

describe('startNotificationWorker', () => {
  it('consumes only the shared processing-failure queue and acknowledges after persistence', async () => {
    const fixture = createFixture();
    let confirmPersistence: (() => void) | undefined;
    jest.mocked(fixture.handler.handle).mockImplementationOnce(
      async () =>
        new Promise<void>((resolve) => {
          confirmPersistence = resolve;
        }),
    );
    await startNotificationWorker({
      channel: fixture.channel,
      handler: fixture.handler,
      onInvalidMessage: fixture.onInvalidMessage,
    });
    const receivedMessage = message(failedEvent);

    const delivery = fixture.getConsumer()(receivedMessage);
    await Promise.resolve();

    expect(fixture.channel.prefetch).toHaveBeenCalledWith(1);
    expect(fixture.channel.consume).toHaveBeenCalledWith(
      VIDEO_EVENT_TOPOLOGY.queues.notificationFailures,
      expect.any(Function),
      { noAck: false },
    );
    expect(fixture.channel.ack).not.toHaveBeenCalled();

    confirmPersistence?.();
    await delivery;
    expect(fixture.channel.ack).toHaveBeenCalledWith(receivedMessage);
  });

  it('acknowledges a duplicate after the idempotent handler succeeds', async () => {
    const fixture = createFixture();
    await startNotificationWorker({ channel: fixture.channel, handler: fixture.handler });
    const first = message(failedEvent);
    const duplicate = message({
      ...failedEvent,
      eventId: '44444444-4444-4444-8444-444444444444',
    });

    await fixture.getConsumer()(first);
    await fixture.getConsumer()(duplicate);

    expect(fixture.handler.handle).toHaveBeenCalledTimes(2);
    expect(fixture.channel.ack).toHaveBeenNthCalledWith(1, first);
    expect(fixture.channel.ack).toHaveBeenNthCalledWith(2, duplicate);
    expect(fixture.channel.nack).not.toHaveBeenCalled();
  });

  it('does not acknowledge and requests redelivery when persistence fails', async () => {
    const fixture = createFixture();
    jest.mocked(fixture.handler.handle).mockRejectedValueOnce(new Error('database unavailable'));
    await startNotificationWorker({ channel: fixture.channel, handler: fixture.handler });
    const receivedMessage = message(failedEvent);

    await fixture.getConsumer()(receivedMessage);

    expect(fixture.channel.ack).not.toHaveBeenCalled();
    expect(fixture.channel.nack).toHaveBeenCalledWith(receivedMessage, false, true);
  });

  it('dead-letters an invalid event without invoking persistence', async () => {
    const fixture = createFixture();
    await startNotificationWorker({
      channel: fixture.channel,
      handler: fixture.handler,
      onInvalidMessage: fixture.onInvalidMessage,
    });
    const invalidMessage = message({ ...failedEvent, version: 2 });

    await fixture.getConsumer()(invalidMessage);

    expect(fixture.handler.handle).not.toHaveBeenCalled();
    expect(fixture.channel.ack).not.toHaveBeenCalled();
    expect(fixture.channel.nack).toHaveBeenCalledWith(invalidMessage, false, false);
    expect(fixture.onInvalidMessage).toHaveBeenCalledWith(invalidMessage);
  });

  it('cancels deliveries and waits for active persistence before becoming idle', async () => {
    const fixture = createFixture();
    let confirmPersistence: (() => void) | undefined;
    jest.mocked(fixture.handler.handle).mockImplementationOnce(
      async () =>
        new Promise<void>((resolve) => {
          confirmPersistence = resolve;
        }),
    );
    const worker = await startNotificationWorker({
      channel: fixture.channel,
      handler: fixture.handler,
    });
    const delivery = fixture.getConsumer()(message(failedEvent));
    await Promise.resolve();

    let idle = false;
    const waiting = worker.waitForIdle().then(() => {
      idle = true;
    });
    await worker.stopAccepting();

    expect(fixture.channel.cancel).toHaveBeenCalledWith('notification-consumer');
    expect(idle).toBe(false);

    confirmPersistence?.();
    await delivery;
    await waiting;
    expect(idle).toBe(true);
  });
});
