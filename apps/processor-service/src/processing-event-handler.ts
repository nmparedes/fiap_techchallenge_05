import { extname } from 'node:path';

import type {
  ProcessingErrorCode,
  ProcessingRequestedEventV1,
  ProcessingStatusEventV1,
} from '@fiap-x/contracts';

import type { CompletedArchiveLookup } from './completed-archive.js';
import type { ProcessingAttemptInput, ProcessingAttemptResult } from './processing-attempt.js';
import type { ProcessingStatusPublisher } from './processing-event-publisher.js';

const MAX_FUNCTIONAL_MESSAGE_LENGTH = 256;

export interface ProcessingAttemptProcessor {
  process(input: ProcessingAttemptInput): Promise<ProcessingAttemptResult>;
}

export interface ProcessingEventHandlerOptions {
  processor: ProcessingAttemptProcessor;
  publisher: ProcessingStatusPublisher;
  completedArchives: CompletedArchiveLookup;
  metrics: ProcessingJobMetrics;
  logger: ProcessingEventLogger;
  storageRoot: string;
  createId(): string;
  now(): Date;
  clock(): number;
}

export interface ProcessingEventLogger {
  info(bindings: object, message: string): void;
  error(bindings: object, message: string): void;
}

export interface ProcessingJobMetrics {
  jobs: { inc(labels: { outcome: string }): void };
  jobDuration: { observe(labels: { outcome: string }, value: number): void };
  failures: { inc(labels: { error_code: ProcessingErrorCode }): void };
}

function sanitizeFunctionalMessage(message: string, errorCode: ProcessingErrorCode): string {
  const printable = [...message]
    .map((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127 ? ' ' : character;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();

  const fallback =
    errorCode === 'FFMPEG_ERROR'
      ? 'Video frame extraction failed'
      : 'Video frame archive creation failed';
  return (printable.length === 0 ? fallback : printable).slice(0, MAX_FUNCTIONAL_MESSAGE_LENGTH);
}

export class ProcessingEventHandler {
  public constructor(private readonly options: ProcessingEventHandlerOptions) {}

  public async handle(event: ProcessingRequestedEventV1): Promise<void> {
    const payload = event.payload;
    const extension = extname(payload.sourceObjectKey).slice(1);
    const startedAt = this.options.clock();
    const context = {
      event: 'processing_job',
      correlationId: event.eventId,
      eventId: event.eventId,
      eventType: event.eventType,
      videoId: payload.videoId,
      attempt: payload.attempt,
    };

    try {
      const completedArchive = await this.options.completedArchives.find({
        storageRoot: this.options.storageRoot,
        videoId: payload.videoId,
        userId: payload.userId,
        extension,
      });
      if (completedArchive !== null) {
        const completedEvent = this.statusEvent('video.processing.completed', {
          videoId: payload.videoId,
          userId: payload.userId,
          archiveObjectKey: completedArchive,
          fps: payload.fps,
          attempt: payload.attempt,
        });
        await this.options.publisher.publish(completedEvent);
        this.recordOutcome(context, completedEvent.eventId, 'completed', startedAt, true);
        return;
      }

      const startedEvent = this.statusEvent('video.processing.started', {
        videoId: payload.videoId,
        userId: payload.userId,
        fps: payload.fps,
        attempt: payload.attempt,
      });
      await this.options.publisher.publish(startedEvent);
      this.options.logger.info(
        { ...context, statusEventId: startedEvent.eventId, outcome: 'started' },
        'Processing job started',
      );

      const result = await this.options.processor.process({
        storageRoot: this.options.storageRoot,
        videoId: payload.videoId,
        userId: payload.userId,
        extension,
        fps: payload.fps,
        attempt: payload.attempt,
      });

      if (result.success) {
        const completedEvent = this.statusEvent('video.processing.completed', {
          videoId: payload.videoId,
          userId: payload.userId,
          archiveObjectKey: result.archiveObjectKey,
          fps: payload.fps,
          attempt: payload.attempt,
        });
        await this.options.publisher.publish(completedEvent);
        this.recordOutcome(context, completedEvent.eventId, 'completed', startedAt, false);
        return;
      }

      const failedEvent = this.statusEvent('video.processing.failed', {
        videoId: payload.videoId,
        userId: payload.userId,
        errorCode: result.errorCode,
        errorMessage: sanitizeFunctionalMessage(result.errorMessage, result.errorCode),
        fps: payload.fps,
        attempt: payload.attempt,
      });
      await this.options.publisher.publish(failedEvent);
      this.options.metrics.failures.inc({ error_code: result.errorCode });
      this.recordOutcome(context, failedEvent.eventId, 'failed', startedAt, false);
    } catch (error) {
      const durationMs = Math.max(0, this.options.clock() - startedAt);
      this.options.metrics.jobs.inc({ outcome: 'failed' });
      this.options.metrics.jobDuration.observe({ outcome: 'failed' }, durationMs / 1000);
      this.options.logger.error(
        {
          ...context,
          outcome: 'infrastructure_error',
          durationMs,
          errorName: error instanceof Error ? error.name : 'UnknownError',
        },
        'Processing job infrastructure failure',
      );
      throw error;
    }
  }

  private recordOutcome(
    context: object,
    statusEventId: string,
    outcome: 'completed' | 'failed',
    startedAt: number,
    reusedArchive: boolean,
  ): void {
    const durationMs = Math.max(0, this.options.clock() - startedAt);
    this.options.metrics.jobs.inc({ outcome });
    this.options.metrics.jobDuration.observe({ outcome }, durationMs / 1000);
    this.options.logger.info(
      { ...context, statusEventId, outcome, durationMs, reusedArchive },
      outcome === 'completed' ? 'Processing job completed' : 'Processing job failed',
    );
  }

  private statusEvent<TEvent extends ProcessingStatusEventV1>(
    eventType: TEvent['eventType'],
    payload: TEvent['payload'],
  ): TEvent {
    return {
      eventId: this.options.createId(),
      eventType,
      version: 1,
      occurredAt: this.options.now().toISOString(),
      payload,
    } as TEvent;
  }
}
