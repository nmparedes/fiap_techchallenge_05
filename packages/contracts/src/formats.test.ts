import { describe, expect, it } from '@jest/globals';
import { Value } from '@sinclair/typebox/value';

import { ProcessingRequestedEventV1Schema } from './events.js';
import { registerContractFormats } from './formats.js';

const validEvent = {
  eventId: '11111111-1111-4111-8111-111111111111',
  eventType: 'video.processing.requested',
  version: 1,
  occurredAt: '2026-09-01T12:00:00.000Z',
  payload: {
    videoId: '22222222-2222-4222-8222-222222222222',
    userId: '33333333-3333-4333-8333-333333333333',
    sourceObjectKey: 'videos/input.mp4',
    fps: 1,
    attempt: 1,
  },
} as const;

describe('contract formats', () => {
  it('registers UUID and RFC 3339 date-time validation idempotently', () => {
    registerContractFormats();
    registerContractFormats();

    expect(Value.Check(ProcessingRequestedEventV1Schema, validEvent)).toBe(true);
    expect(
      Value.Check(ProcessingRequestedEventV1Schema, {
        ...validEvent,
        eventId: 'not-a-uuid',
      }),
    ).toBe(false);
    expect(
      Value.Check(ProcessingRequestedEventV1Schema, {
        ...validEvent,
        occurredAt: '2026-99-01T12:00:00Z',
      }),
    ).toBe(false);
  });
});
