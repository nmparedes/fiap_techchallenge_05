import { Type, type Static } from '@sinclair/typebox';

export const VideoStatusSchema = Type.Union([
  Type.Literal('QUEUED'),
  Type.Literal('PROCESSING'),
  Type.Literal('COMPLETED'),
  Type.Literal('FAILED'),
]);

export type VideoStatus = Static<typeof VideoStatusSchema>;

export const ProcessingErrorCodeSchema = Type.Union([
  Type.Literal('FFMPEG_ERROR'),
  Type.Literal('ZIP_ERROR'),
]);

export type ProcessingErrorCode = Static<typeof ProcessingErrorCodeSchema>;

export const IdentifierSchema = Type.String({ format: 'uuid' });
export const TimestampSchema = Type.String({ format: 'date-time' });
export const FpsSchema = Type.Number({ exclusiveMinimum: 0 });
export const AttemptSchema = Type.Integer({ minimum: 1 });
