import type { ProcessingStatusEventV1 } from '@fiap-x/contracts';

import type { VideoServiceMetrics } from './metrics.js';

export interface StatusEventService {
  applyStatusEvent(event: ProcessingStatusEventV1): Promise<boolean>;
}

export interface StatusEventLogger {
  info(bindings: object, message: string): void;
  error(bindings: object, message: string): void;
}

export interface StatusEventHandlerDependencies {
  service: StatusEventService;
  metrics: Pick<VideoServiceMetrics, 'statusEvents' | 'videosByStatus'>;
  logger: StatusEventLogger;
}

export class ProcessingStatusEventHandler {
  public constructor(private readonly dependencies: StatusEventHandlerDependencies) {}

  public async handle(event: ProcessingStatusEventV1): Promise<void> {
    const context = {
      event: 'video_status_event',
      correlationId: event.eventId,
      eventId: event.eventId,
      eventType: event.eventType,
      videoId: event.payload.videoId,
      userId: event.payload.userId,
      attempt: event.payload.attempt,
    };

    try {
      const applied = await this.dependencies.service.applyStatusEvent(event);
      const outcome = applied ? 'applied' : 'ignored';
      this.dependencies.metrics.statusEvents.inc({ event_type: event.eventType, outcome });
      if (applied) {
        this.dependencies.metrics.videosByStatus.inc({
          operation: 'transitioned',
          status: statusForEvent(event),
        });
      }
      this.dependencies.logger.info(
        { ...context, outcome },
        applied ? 'Video status event applied' : 'Video status event ignored',
      );
    } catch (error) {
      this.dependencies.metrics.statusEvents.inc({
        event_type: event.eventType,
        outcome: 'failed',
      });
      this.dependencies.logger.error(
        {
          ...context,
          outcome: 'failed',
          errorName: error instanceof Error ? error.name : 'UnknownError',
        },
        'Video status event persistence failed',
      );
      throw error;
    }
  }
}

function statusForEvent(event: ProcessingStatusEventV1): 'PROCESSING' | 'COMPLETED' | 'FAILED' {
  switch (event.eventType) {
    case 'video.processing.started':
      return 'PROCESSING';
    case 'video.processing.completed':
      return 'COMPLETED';
    case 'video.processing.failed':
      return 'FAILED';
  }
}
