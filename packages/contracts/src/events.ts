import { Type, type Static } from '@sinclair/typebox';

import {
  AttemptSchema,
  FpsSchema,
  IdentifierSchema,
  ProcessingErrorCodeSchema,
  TimestampSchema,
} from './common.js';

const ProcessingRequestedPayloadSchema = Type.Object(
  {
    videoId: IdentifierSchema,
    userId: IdentifierSchema,
    sourceObjectKey: Type.String({ minLength: 1 }),
    fps: FpsSchema,
    attempt: AttemptSchema,
  },
  { additionalProperties: false },
);

const ProcessingStartedPayloadSchema = Type.Object(
  {
    videoId: IdentifierSchema,
    userId: IdentifierSchema,
    fps: FpsSchema,
    attempt: AttemptSchema,
  },
  { additionalProperties: false },
);

const ProcessingCompletedPayloadSchema = Type.Object(
  {
    videoId: IdentifierSchema,
    userId: IdentifierSchema,
    archiveObjectKey: Type.String({ minLength: 1 }),
    fps: FpsSchema,
    attempt: AttemptSchema,
  },
  { additionalProperties: false },
);

const ProcessingFailedPayloadSchema = Type.Object(
  {
    videoId: IdentifierSchema,
    userId: IdentifierSchema,
    errorCode: ProcessingErrorCodeSchema,
    errorMessage: Type.String({ minLength: 1 }),
    fps: FpsSchema,
    attempt: AttemptSchema,
  },
  { additionalProperties: false },
);

export const ProcessingRequestedEventV1Schema = Type.Object(
  {
    eventId: IdentifierSchema,
    eventType: Type.Literal('video.processing.requested'),
    version: Type.Literal(1),
    occurredAt: TimestampSchema,
    payload: ProcessingRequestedPayloadSchema,
  },
  { $id: 'ProcessingRequestedEventV1', additionalProperties: false },
);

export const ProcessingStartedEventV1Schema = Type.Object(
  {
    eventId: IdentifierSchema,
    eventType: Type.Literal('video.processing.started'),
    version: Type.Literal(1),
    occurredAt: TimestampSchema,
    payload: ProcessingStartedPayloadSchema,
  },
  { $id: 'ProcessingStartedEventV1', additionalProperties: false },
);

export const ProcessingCompletedEventV1Schema = Type.Object(
  {
    eventId: IdentifierSchema,
    eventType: Type.Literal('video.processing.completed'),
    version: Type.Literal(1),
    occurredAt: TimestampSchema,
    payload: ProcessingCompletedPayloadSchema,
  },
  { $id: 'ProcessingCompletedEventV1', additionalProperties: false },
);

export const ProcessingFailedEventV1Schema = Type.Object(
  {
    eventId: IdentifierSchema,
    eventType: Type.Literal('video.processing.failed'),
    version: Type.Literal(1),
    occurredAt: TimestampSchema,
    payload: ProcessingFailedPayloadSchema,
  },
  { $id: 'ProcessingFailedEventV1', additionalProperties: false },
);

export const ProcessingEventV1Schema = Type.Union([
  ProcessingRequestedEventV1Schema,
  ProcessingStartedEventV1Schema,
  ProcessingCompletedEventV1Schema,
  ProcessingFailedEventV1Schema,
]);

export const ProcessingStatusEventV1Schema = Type.Union([
  ProcessingStartedEventV1Schema,
  ProcessingCompletedEventV1Schema,
  ProcessingFailedEventV1Schema,
]);

export type ProcessingRequestedEventV1 = Static<typeof ProcessingRequestedEventV1Schema>;
export type ProcessingStartedEventV1 = Static<typeof ProcessingStartedEventV1Schema>;
export type ProcessingCompletedEventV1 = Static<typeof ProcessingCompletedEventV1Schema>;
export type ProcessingFailedEventV1 = Static<typeof ProcessingFailedEventV1Schema>;
export type ProcessingEventV1 = Static<typeof ProcessingEventV1Schema>;
export type ProcessingStatusEventV1 = Static<typeof ProcessingStatusEventV1Schema>;
