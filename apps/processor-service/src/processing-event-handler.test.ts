import { describe, expect, it, jest } from '@jest/globals';
import type { ProcessingRequestedEventV1, ProcessingStatusEventV1 } from '@fiap-x/contracts';

import type { CompletedArchiveLookup } from './completed-archive.js';
import type { ProcessingAttemptResult } from './processing-attempt.js';
import {
  ProcessingEventHandler,
  type ProcessingAttemptProcessor,
} from './processing-event-handler.js';
import type { ProcessingStatusPublisher } from './processing-event-publisher.js';

const requestedEvent: ProcessingRequestedEventV1 = {
  eventId: '11111111-1111-4111-8111-111111111111',
  eventType: 'video.processing.requested',
  version: 1,
  occurredAt: '2026-01-01T00:00:00.000Z',
  payload: {
    videoId: '22222222-2222-4222-8222-222222222222',
    userId: '33333333-3333-4333-8333-333333333333',
    sourceObjectKey:
      '/storage/33333333-3333-4333-8333-333333333333/22222222-2222-4222-8222-222222222222/input.mp4',
    fps: 2,
    attempt: 3,
  },
};

const completedResult: ProcessingAttemptResult = {
  success: true,
  videoId: requestedEvent.payload.videoId,
  userId: requestedEvent.payload.userId,
  fps: 2,
  attempt: 3,
  archiveObjectKey: `${requestedEvent.payload.userId}/${requestedEvent.payload.videoId}/output.zip`,
  outputPath: '/storage/output.zip',
  frameCount: 4,
};

function createFixture(result: ProcessingAttemptResult = completedResult) {
  const sequence: string[] = [];
  const processor: ProcessingAttemptProcessor = {
    process: jest.fn(async () => {
      sequence.push('process');
      return result;
    }),
  };
  const publisher: ProcessingStatusPublisher = {
    publish: jest.fn(async (event: ProcessingStatusEventV1) => {
      sequence.push(event.eventType);
    }),
  };
  const completedArchives: CompletedArchiveLookup = {
    find: jest.fn<CompletedArchiveLookup['find']>(async () => null),
  };
  const metrics = {
    jobs: { inc: jest.fn() },
    jobDuration: { observe: jest.fn() },
    failures: { inc: jest.fn() },
  };
  const logger = { info: jest.fn(), error: jest.fn() };
  const ids = ['44444444-4444-4444-8444-444444444444', '55555555-5555-4555-8555-555555555555'];
  let clock = 1_000;
  const handler = new ProcessingEventHandler({
    processor,
    publisher,
    completedArchives,
    metrics,
    logger,
    storageRoot: '/storage',
    createId: () => ids.shift() ?? '66666666-6666-4666-8666-666666666666',
    now: () => new Date('2026-02-03T04:05:06.000Z'),
    clock: () => {
      clock += 250;
      return clock;
    },
  });
  return { handler, processor, publisher, completedArchives, metrics, logger, sequence };
}

describe('ProcessingEventHandler', () => {
  it('publishes started, processes exactly once, and publishes completed', async () => {
    const fixture = createFixture();

    await fixture.handler.handle(requestedEvent);

    expect(fixture.sequence).toEqual([
      'video.processing.started',
      'process',
      'video.processing.completed',
    ]);
    expect(fixture.processor.process).toHaveBeenCalledTimes(1);
    expect(fixture.processor.process).toHaveBeenCalledWith({
      storageRoot: '/storage',
      videoId: requestedEvent.payload.videoId,
      userId: requestedEvent.payload.userId,
      extension: 'mp4',
      fps: 2,
      attempt: 3,
    });
    expect(fixture.publisher.publish).toHaveBeenNthCalledWith(1, {
      eventId: '44444444-4444-4444-8444-444444444444',
      eventType: 'video.processing.started',
      version: 1,
      occurredAt: '2026-02-03T04:05:06.000Z',
      payload: {
        videoId: requestedEvent.payload.videoId,
        userId: requestedEvent.payload.userId,
        fps: 2,
        attempt: 3,
      },
    });
    expect(fixture.publisher.publish).toHaveBeenNthCalledWith(2, {
      eventId: '55555555-5555-4555-8555-555555555555',
      eventType: 'video.processing.completed',
      version: 1,
      occurredAt: '2026-02-03T04:05:06.000Z',
      payload: {
        videoId: requestedEvent.payload.videoId,
        userId: requestedEvent.payload.userId,
        archiveObjectKey: completedResult.success ? completedResult.archiveObjectKey : '',
        fps: 2,
        attempt: 3,
      },
    });
    expect(fixture.metrics.jobs.inc).toHaveBeenCalledTimes(1);
    expect(fixture.metrics.jobs.inc).toHaveBeenCalledWith({ outcome: 'completed' });
    expect(fixture.metrics.jobDuration.observe).toHaveBeenCalledWith(
      { outcome: 'completed' },
      0.25,
    );
    expect(fixture.logger.info).toHaveBeenLastCalledWith(
      expect.objectContaining({
        correlationId: requestedEvent.eventId,
        eventId: requestedEvent.eventId,
        eventType: requestedEvent.eventType,
        videoId: requestedEvent.payload.videoId,
        attempt: 3,
        outcome: 'completed',
        durationMs: 250,
        reusedArchive: false,
      }),
      'Processing job completed',
    );
  });

  it('republishes completed without processing when a non-empty ZIP already exists', async () => {
    const fixture = createFixture();
    jest
      .mocked(fixture.completedArchives.find)
      .mockResolvedValueOnce(
        `${requestedEvent.payload.userId}/${requestedEvent.payload.videoId}/output.zip`,
      );

    await fixture.handler.handle(requestedEvent);

    expect(fixture.processor.process).not.toHaveBeenCalled();
    expect(fixture.publisher.publish).toHaveBeenCalledTimes(1);
    expect(fixture.publisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'video.processing.completed',
        payload: expect.objectContaining({
          archiveObjectKey: `${requestedEvent.payload.userId}/${requestedEvent.payload.videoId}/output.zip`,
        }),
      }),
    );
    expect(fixture.metrics.jobs.inc).toHaveBeenCalledTimes(1);
    expect(fixture.metrics.jobs.inc).toHaveBeenCalledWith({ outcome: 'completed' });
    expect(fixture.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'completed', reusedArchive: true }),
      'Processing job completed',
    );
  });

  it.each(['FFMPEG_ERROR', 'ZIP_ERROR'] as const)(
    'publishes a sanitized and bounded failed event for %s',
    async (errorCode) => {
      const result: ProcessingAttemptResult = {
        success: false,
        videoId: requestedEvent.payload.videoId,
        userId: requestedEvent.payload.userId,
        fps: 2,
        attempt: 3,
        errorCode,
        errorMessage: `  functional\nmessage\u0000${'x'.repeat(300)}  `,
      };
      const fixture = createFixture(result);

      await fixture.handler.handle(requestedEvent);

      expect(fixture.sequence).toEqual([
        'video.processing.started',
        'process',
        'video.processing.failed',
      ]);
      expect(fixture.processor.process).toHaveBeenCalledTimes(1);
      const failedEvent = jest.mocked(fixture.publisher.publish).mock.calls[1]?.[0];
      expect(failedEvent?.eventType).toBe('video.processing.failed');
      if (failedEvent?.eventType !== 'video.processing.failed') {
        throw new Error('Expected a failed event');
      }
      expect(failedEvent.payload).toMatchObject({
        videoId: requestedEvent.payload.videoId,
        userId: requestedEvent.payload.userId,
        errorCode,
        fps: 2,
        attempt: 3,
      });
      expect(failedEvent.payload.errorMessage).toHaveLength(256);
      expect(failedEvent.payload.errorMessage).not.toContain('\n');
      expect(failedEvent.payload.errorMessage).not.toContain('\u0000');
      expect(fixture.metrics.jobs.inc).toHaveBeenCalledWith({ outcome: 'failed' });
      expect(fixture.metrics.jobDuration.observe).toHaveBeenCalledWith({ outcome: 'failed' }, 0.25);
      expect(fixture.metrics.failures.inc).toHaveBeenCalledWith({ error_code: errorCode });
    },
  );

  it('uses a safe functional fallback when the failure message has no printable content', async () => {
    const fixture = createFixture({
      success: false,
      videoId: requestedEvent.payload.videoId,
      userId: requestedEvent.payload.userId,
      fps: 2,
      attempt: 3,
      errorCode: 'ZIP_ERROR',
      errorMessage: '\n\u0000\t',
    });

    await fixture.handler.handle(requestedEvent);

    expect(jest.mocked(fixture.publisher.publish).mock.calls[1]?.[0]).toMatchObject({
      eventType: 'video.processing.failed',
      payload: { errorMessage: 'Video frame archive creation failed' },
    });
  });

  it('does not finish until publication of the final event is confirmed', async () => {
    let confirmFinal: (() => void) | undefined;
    let finished = false;
    const processor: ProcessingAttemptProcessor = {
      process: jest.fn(async () => completedResult),
    };
    const publisher: ProcessingStatusPublisher = {
      publish: jest
        .fn<(event: ProcessingStatusEventV1) => Promise<void>>()
        .mockResolvedValueOnce(undefined)
        .mockImplementationOnce(
          async () =>
            new Promise<void>((resolve) => {
              confirmFinal = resolve;
            }),
        ),
    };
    const handler = new ProcessingEventHandler({
      processor,
      publisher,
      completedArchives: { find: jest.fn(async () => null) },
      metrics: {
        jobs: { inc: jest.fn() },
        jobDuration: { observe: jest.fn() },
        failures: { inc: jest.fn() },
      },
      logger: { info: jest.fn(), error: jest.fn() },
      storageRoot: '/storage',
      createId: () => '44444444-4444-4444-8444-444444444444',
      now: () => new Date('2026-02-03T04:05:06.000Z'),
      clock: () => 1_000,
    });

    const handling = handler.handle(requestedEvent).then(() => {
      finished = true;
    });
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });

    expect(finished).toBe(false);
    expect(confirmFinal).toBeDefined();
    confirmFinal?.();
    await handling;
    expect(finished).toBe(true);
  });

  it('waits for failed-event confirmation before a known failure finishes', async () => {
    let confirmFailure: (() => void) | undefined;
    let finished = false;
    const fixture = createFixture({
      success: false,
      videoId: requestedEvent.payload.videoId,
      userId: requestedEvent.payload.userId,
      fps: 2,
      attempt: 3,
      errorCode: 'FFMPEG_ERROR',
      errorMessage: 'Video frame extraction failed',
    });
    jest
      .mocked(fixture.publisher.publish)
      .mockResolvedValueOnce(undefined)
      .mockImplementationOnce(
        async () =>
          new Promise<void>((resolve) => {
            confirmFailure = resolve;
          }),
      );

    const handling = fixture.handler.handle(requestedEvent).then(() => {
      finished = true;
    });
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });

    expect(finished).toBe(false);
    expect(confirmFailure).toBeDefined();
    expect(fixture.metrics.jobs.inc).not.toHaveBeenCalledWith({ outcome: 'failed' });
    confirmFailure?.();
    await handling;
    expect(finished).toBe(true);
    expect(fixture.metrics.jobs.inc).toHaveBeenCalledWith({ outcome: 'failed' });
  });

  it('propagates unexpected processing failures without publishing failed', async () => {
    const failure = new Error('storage unavailable');
    const fixture = createFixture();
    jest.mocked(fixture.processor.process).mockRejectedValueOnce(failure);

    await expect(fixture.handler.handle(requestedEvent)).rejects.toBe(failure);

    expect(fixture.processor.process).toHaveBeenCalledTimes(1);
    expect(fixture.publisher.publish).toHaveBeenCalledTimes(1);
    expect(fixture.sequence).toEqual(['video.processing.started']);
    expect(fixture.metrics.jobs.inc).toHaveBeenCalledWith({ outcome: 'failed' });
    expect(fixture.metrics.jobDuration.observe).toHaveBeenCalledWith({ outcome: 'failed' }, 0.25);
    expect(fixture.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        correlationId: requestedEvent.eventId,
        eventId: requestedEvent.eventId,
        eventType: requestedEvent.eventType,
        videoId: requestedEvent.payload.videoId,
        attempt: 3,
        outcome: 'infrastructure_error',
        errorName: 'Error',
      }),
      'Processing job infrastructure failure',
    );
  });

  it('propagates final publication failures for broker redelivery', async () => {
    const failure = new Error('publisher confirm failed');
    const fixture = createFixture();
    jest
      .mocked(fixture.publisher.publish)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(failure);

    await expect(fixture.handler.handle(requestedEvent)).rejects.toBe(failure);

    expect(fixture.processor.process).toHaveBeenCalledTimes(1);
    expect(fixture.metrics.jobs.inc).toHaveBeenCalledWith({ outcome: 'failed' });
  });
});
