import type { ConfirmChannel } from 'amqplib';
import { describe, expect, it, jest } from '@jest/globals';
import type { ProcessingStartedEventV1 } from '@fiap-x/contracts';
import { VIDEO_EVENT_TOPOLOGY } from '@fiap-x/infrastructure';

import { RabbitMqProcessingStatusPublisher } from './processing-event-publisher.js';

const event: ProcessingStartedEventV1 = {
  eventId: '44444444-4444-4444-8444-444444444444',
  eventType: 'video.processing.started',
  version: 1,
  occurredAt: '2026-02-03T04:05:06.000Z',
  payload: {
    videoId: '22222222-2222-4222-8222-222222222222',
    userId: '33333333-3333-4333-8333-333333333333',
    fps: 2,
    attempt: 3,
  },
};

describe('RabbitMqProcessingStatusPublisher', () => {
  it('publishes through the shared topology and waits for publisher confirms', async () => {
    let confirm: (() => void) | undefined;
    const channel = {
      publish: jest.fn(() => true),
      waitForConfirms: jest.fn(
        async () =>
          new Promise<void>((resolve) => {
            confirm = resolve;
          }),
      ),
    } as unknown as ConfirmChannel;
    const publisher = new RabbitMqProcessingStatusPublisher(channel);
    let finished = false;

    const publication = publisher.publish(event).then(() => {
      finished = true;
    });
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });

    expect(channel.publish).toHaveBeenCalledWith(
      VIDEO_EVENT_TOPOLOGY.exchanges.events,
      'video.processing.started',
      Buffer.from(JSON.stringify(event)),
      expect.objectContaining({
        contentType: 'application/json',
        deliveryMode: 2,
        messageId: event.eventId,
        type: event.eventType,
      }),
    );
    expect(channel.waitForConfirms).toHaveBeenCalledTimes(1);
    expect(finished).toBe(false);
    confirm?.();
    await publication;
    expect(finished).toBe(true);
  });
});
