import { describe, expect, it, jest } from '@jest/globals';
import type { ProcessingStartedEventV1, ProcessingStatusEventV1 } from '@fiap-x/contracts';

import { ProcessingStatusEventHandler } from './status-event-handler.js';

const event: ProcessingStartedEventV1 = {
  eventId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  eventType: 'video.processing.started',
  version: 1,
  occurredAt: '2026-01-01T00:00:00.000Z',
  payload: {
    videoId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    fps: 1,
    attempt: 1,
  },
};

function createFixture(applied: boolean) {
  const service = {
    applyStatusEvent: jest
      .fn<(event: ProcessingStatusEventV1) => Promise<boolean>>()
      .mockResolvedValue(applied),
  };
  const statusEvents = { inc: jest.fn() };
  const videosByStatus = { inc: jest.fn() };
  const logger = { info: jest.fn(), error: jest.fn() };
  const handler = new ProcessingStatusEventHandler({
    service,
    metrics: { statusEvents, videosByStatus } as never,
    logger,
  });
  return { handler, service, statusEvents, videosByStatus, logger };
}

describe('ProcessingStatusEventHandler', () => {
  it.each([
    [true, 'applied', 'Video status event applied'],
    [false, 'ignored', 'Video status event ignored'],
  ] as const)('records and logs an %s persistence result', async (applied, outcome, message) => {
    const fixture = createFixture(applied);

    await expect(fixture.handler.handle(event)).resolves.toBeUndefined();

    expect(fixture.service.applyStatusEvent).toHaveBeenCalledWith(event);
    expect(fixture.statusEvents.inc).toHaveBeenCalledWith({
      event_type: event.eventType,
      outcome,
    });
    expect(fixture.videosByStatus.inc).toHaveBeenCalledTimes(applied ? 1 : 0);
    if (applied) {
      expect(fixture.videosByStatus.inc).toHaveBeenCalledWith({
        operation: 'transitioned',
        status: 'PROCESSING',
      });
    }
    expect(fixture.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        correlationId: event.eventId,
        eventId: event.eventId,
        eventType: event.eventType,
        videoId: event.payload.videoId,
        attempt: 1,
        outcome,
      }),
      message,
    );
  });

  it('records a database failure, logs only its name, and rethrows for broker nack', async () => {
    const fixture = createFixture(true);
    const failure = new Error('mysql://user:password@host');
    fixture.service.applyStatusEvent.mockRejectedValueOnce(failure);

    await expect(fixture.handler.handle(event)).rejects.toBe(failure);

    expect(fixture.statusEvents.inc).toHaveBeenCalledWith({
      event_type: event.eventType,
      outcome: 'failed',
    });
    expect(fixture.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ errorName: 'Error', outcome: 'failed' }),
      'Video status event persistence failed',
    );
    expect(JSON.stringify(fixture.logger.error.mock.calls)).not.toContain('password');
  });
});
