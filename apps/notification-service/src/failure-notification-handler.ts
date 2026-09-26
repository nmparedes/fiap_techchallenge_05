import { performance } from 'node:perf_hooks';

import type { ProcessingErrorCode, ProcessingFailedEventV1 } from '@fiap-x/contracts';
import type { JsonLogger } from '@fiap-x/observability';

import type { NotificationServiceMetrics } from './metrics.js';
import type { NotificationWriter } from './notification-repository.js';

const FAILURE_MESSAGES = {
  FFMPEG_ERROR: 'Video processing failed while extracting frames.',
  ZIP_ERROR: 'Video processing failed while creating the archive.',
} satisfies Record<ProcessingErrorCode, string>;

export interface FailureNotificationHandlerOptions {
  repository: NotificationWriter;
  createId: () => string;
  logger: Pick<JsonLogger, 'info' | 'error'>;
  metrics: Pick<NotificationServiceMetrics, 'notificationsConsumed' | 'consumptionDuration'>;
  clock?: () => number;
}

export class FailureNotificationHandler {
  public constructor(private readonly options: FailureNotificationHandlerOptions) {}

  public async handle(event: ProcessingFailedEventV1): Promise<void> {
    const clock = this.options.clock ?? performance.now;
    const startedAt = clock();
    const context = {
      event: 'processing_failure_notification',
      correlationId: event.eventId,
      eventId: event.eventId,
      eventType: event.eventType,
      userId: event.payload.userId,
      videoId: event.payload.videoId,
      attempt: event.payload.attempt,
    };
    let outcome: 'created' | 'duplicate';
    let metricOutcome: 'persisted' | 'duplicate' | 'failed' = 'failed';
    try {
      outcome = await this.options.repository.persist({
        id: this.options.createId(),
        userId: event.payload.userId,
        videoId: event.payload.videoId,
        attempt: event.payload.attempt,
        errorCode: event.payload.errorCode,
        message: FAILURE_MESSAGES[event.payload.errorCode],
        createdAt: new Date(event.occurredAt),
      });
      metricOutcome = outcome === 'created' ? 'persisted' : 'duplicate';
    } catch (error) {
      this.options.metrics.notificationsConsumed.inc({ outcome: 'failed' });
      this.options.logger.error(
        {
          ...context,
          outcome: 'failed',
          errorName: error instanceof Error ? error.name : 'UnknownError',
        },
        'Failure notification persistence failed',
      );
      throw error;
    } finally {
      this.options.metrics.consumptionDuration.observe(
        { outcome: metricOutcome },
        Math.max(0, clock() - startedAt) / 1000,
      );
    }

    this.options.metrics.notificationsConsumed.inc({ outcome: metricOutcome });

    this.options.logger.info(
      {
        ...context,
        outcome,
      },
      outcome === 'created' ? 'Failure notification created' : 'Duplicate failure acknowledged',
    );
  }
}
