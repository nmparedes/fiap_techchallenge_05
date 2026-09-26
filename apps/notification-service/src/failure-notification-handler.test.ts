import { describe, expect, it, jest } from '@jest/globals';
import type { ProcessingFailedEventV1 } from '@fiap-x/contracts';

import { FailureNotificationHandler } from './failure-notification-handler.js';
import type {
  CreateNotificationInput,
  NotificationPersistenceOutcome,
  NotificationWriter,
} from './notification-repository.js';

const failedEvent: ProcessingFailedEventV1 = {
  eventId: '11111111-1111-4111-8111-111111111111',
  eventType: 'video.processing.failed',
  version: 1,
  occurredAt: '2026-09-01T12:01:00.000Z',
  payload: {
    videoId: '22222222-2222-4222-8222-222222222222',
    userId: '33333333-3333-4333-8333-333333333333',
    errorCode: 'FFMPEG_ERROR',
    errorMessage: 'ffmpeg stderr containing an internal storage path',
    fps: 1,
    attempt: 1,
  },
};

class InMemoryNotificationRepository implements NotificationWriter {
  public readonly records = new Map<string, CreateNotificationInput>();

  public async persist(input: CreateNotificationInput): Promise<NotificationPersistenceOutcome> {
    const key = `${input.videoId}:${input.attempt}`;
    if (this.records.has(key)) {
      return 'duplicate';
    }
    this.records.set(key, input);
    return 'created';
  }
}

function createHandler(repository: NotificationWriter) {
  const logger = { info: jest.fn(), error: jest.fn() };
  const notificationsConsumed = { inc: jest.fn() };
  const consumptionDuration = { observe: jest.fn() };
  let nextId = 0;
  let clock = 1_000;
  const handler = new FailureNotificationHandler({
    repository,
    createId: () => `00000000-0000-4000-8000-${String(++nextId).padStart(12, '0')}`,
    logger: logger as never,
    metrics: { notificationsConsumed, consumptionDuration } as never,
    clock: () => {
      clock += 250;
      return clock;
    },
  });
  return { handler, logger, notificationsConsumed, consumptionDuration };
}

describe('FailureNotificationHandler', () => {
  it('maps only event fields and replaces the raw error with a sanitized message', async () => {
    const persist = jest.fn<NotificationWriter['persist']>().mockResolvedValue('created');
    const { handler, logger, notificationsConsumed, consumptionDuration } = createHandler({
      persist,
    });

    await handler.handle(failedEvent);

    expect(persist).toHaveBeenCalledWith({
      id: '00000000-0000-4000-8000-000000000001',
      userId: failedEvent.payload.userId,
      videoId: failedEvent.payload.videoId,
      attempt: 1,
      errorCode: 'FFMPEG_ERROR',
      message: 'Video processing failed while extracting frames.',
      createdAt: new Date(failedEvent.occurredAt),
    });
    expect(JSON.stringify(persist.mock.calls)).not.toContain(failedEvent.payload.errorMessage);
    expect(notificationsConsumed.inc).toHaveBeenCalledWith({ outcome: 'persisted' });
    expect(consumptionDuration.observe).toHaveBeenCalledWith({ outcome: 'persisted' }, 0.25);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        correlationId: failedEvent.eventId,
        eventId: failedEvent.eventId,
        eventType: failedEvent.eventType,
        videoId: failedEvent.payload.videoId,
        attempt: failedEvent.payload.attempt,
        outcome: 'created',
      }),
      'Failure notification created',
    );
  });

  it('stores one notification for duplicate video attempts', async () => {
    const repository = new InMemoryNotificationRepository();
    const { handler, logger, notificationsConsumed, consumptionDuration } =
      createHandler(repository);

    await handler.handle(failedEvent);
    await handler.handle({ ...failedEvent, eventId: '44444444-4444-4444-8444-444444444444' });

    expect(repository.records.size).toBe(1);
    expect(notificationsConsumed.inc).toHaveBeenNthCalledWith(1, { outcome: 'persisted' });
    expect(notificationsConsumed.inc).toHaveBeenNthCalledWith(2, { outcome: 'duplicate' });
    expect(consumptionDuration.observe).toHaveBeenNthCalledWith(2, { outcome: 'duplicate' }, 0.25);
    expect(logger.info).toHaveBeenLastCalledWith(
      expect.objectContaining({ outcome: 'duplicate' }),
      'Duplicate failure acknowledged',
    );
  });

  it('stores distinct notifications for different attempts of the same video', async () => {
    const repository = new InMemoryNotificationRepository();
    const { handler } = createHandler(repository);

    await handler.handle(failedEvent);
    await handler.handle({
      ...failedEvent,
      eventId: '55555555-5555-4555-8555-555555555555',
      payload: { ...failedEvent.payload, attempt: 2, errorCode: 'ZIP_ERROR' },
    });

    expect(repository.records.size).toBe(2);
    expect([...repository.records.values()]).toEqual([
      expect.objectContaining({ attempt: 1, errorCode: 'FFMPEG_ERROR' }),
      expect.objectContaining({
        attempt: 2,
        errorCode: 'ZIP_ERROR',
        message: 'Video processing failed while creating the archive.',
      }),
    ]);
  });

  it('counts and propagates persistence failures', async () => {
    const failure = new Error('repository unavailable');
    const persist = jest.fn<NotificationWriter['persist']>().mockRejectedValue(failure);
    const { handler, logger, notificationsConsumed, consumptionDuration } = createHandler({
      persist,
    });

    await expect(handler.handle(failedEvent)).rejects.toBe(failure);
    expect(notificationsConsumed.inc).toHaveBeenCalledWith({ outcome: 'failed' });
    expect(consumptionDuration.observe).toHaveBeenCalledWith({ outcome: 'failed' }, 0.25);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        correlationId: failedEvent.eventId,
        eventId: failedEvent.eventId,
        eventType: failedEvent.eventType,
        videoId: failedEvent.payload.videoId,
        attempt: failedEvent.payload.attempt,
        outcome: 'failed',
        errorName: 'Error',
      }),
      'Failure notification persistence failed',
    );
  });
});
