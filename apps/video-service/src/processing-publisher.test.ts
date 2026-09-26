import { describe, expect, it, jest } from '@jest/globals';
import type { ConfirmChannel } from 'amqplib';

import { RabbitMqProcessingRequestPublisher } from './processing-publisher.js';

describe('RabbitMqProcessingRequestPublisher', () => {
  it('publishes persistent processing requests and checks exchange readiness', async () => {
    const channel = {
      publish: jest.fn(() => true),
      waitForConfirms: jest.fn(async () => undefined),
      checkExchange: jest.fn(async () => ({ exchange: 'video.events' })),
    } as unknown as ConfirmChannel;
    const publisher = new RabbitMqProcessingRequestPublisher(channel);
    const event = {
      eventId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      eventType: 'video.processing.requested' as const,
      version: 1 as const,
      occurredAt: '2026-01-01T00:00:00.000Z',
      payload: {
        videoId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        sourceObjectKey: '/storage/input.mp4',
        fps: 1,
        attempt: 1,
      },
    };

    await expect(publisher.publish(event)).resolves.toBeUndefined();
    await expect(publisher.ping()).resolves.toBeUndefined();
    expect(channel.publish).toHaveBeenCalledWith(
      'video.events',
      event.eventType,
      expect.any(Buffer),
      expect.objectContaining({ deliveryMode: 2 }),
    );
    expect(channel.checkExchange).toHaveBeenCalledWith('video.events');
  });
});
