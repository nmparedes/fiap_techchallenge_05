import { Type, type Static } from '@sinclair/typebox';

import {
  FpsSchema,
  IdentifierSchema,
  ProcessingErrorCodeSchema,
  TimestampSchema,
  VideoStatusSchema,
} from './common.js';
import { HttpErrorSchema, createHttpSuccessSchema } from './http.js';

export const VideoIdParamsSchema = Type.Object(
  { id: IdentifierSchema },
  { additionalProperties: false },
);
export type VideoIdParams = Static<typeof VideoIdParamsSchema>;

export const VideoListQuerySchema = Type.Object(
  {
    page: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
    pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 20 })),
  },
  { additionalProperties: false },
);
export type VideoListQuery = Static<typeof VideoListQuerySchema>;

export const VideoViewSchema = Type.Object(
  {
    id: IdentifierSchema,
    originalName: Type.String({ minLength: 1, maxLength: 255 }),
    extension: Type.String({ minLength: 1, maxLength: 16 }),
    sizeBytes: Type.String({ pattern: '^[1-9][0-9]*$' }),
    fps: FpsSchema,
    status: VideoStatusSchema,
    attempt: Type.Integer({ minimum: 1 }),
    errorCode: Type.Union([ProcessingErrorCodeSchema, Type.Null()]),
    errorMessage: Type.Union([Type.String(), Type.Null()]),
    downloadAvailable: Type.Boolean(),
    processingStartedAt: Type.Union([TimestampSchema, Type.Null()]),
    completedAt: Type.Union([TimestampSchema, Type.Null()]),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  },
  { additionalProperties: false },
);
export type VideoView = Static<typeof VideoViewSchema>;

export const VideoAcceptedDataSchema = Type.Object(
  {
    id: IdentifierSchema,
    status: Type.Literal('QUEUED'),
    attempt: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);
export const VideoAcceptedResponseSchema = createHttpSuccessSchema(VideoAcceptedDataSchema);
export type VideoAcceptedResponse = Static<typeof VideoAcceptedResponseSchema>;

export const VideoPageSchema = Type.Object(
  {
    items: Type.Array(VideoViewSchema),
    page: Type.Integer({ minimum: 1 }),
    pageSize: Type.Integer({ minimum: 1, maximum: 100 }),
    total: Type.Integer({ minimum: 0 }),
    totalPages: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);
export type VideoPage = Static<typeof VideoPageSchema>;

export const VideoListResponseSchema = createHttpSuccessSchema(VideoPageSchema);
export type VideoListResponse = Static<typeof VideoListResponseSchema>;

export const VideoDetailsResponseSchema = createHttpSuccessSchema(VideoViewSchema);
export type VideoDetailsResponse = Static<typeof VideoDetailsResponseSchema>;

export const FailedVideoDetailsResponseSchema = Type.Object(
  {
    success: Type.Literal(false),
    data: VideoViewSchema,
    error: HttpErrorSchema,
  },
  { additionalProperties: false },
);
export type FailedVideoDetailsResponse = Static<typeof FailedVideoDetailsResponseSchema>;

export const VideoStatusResponseSchema = Type.Object(
  {
    success: Type.Boolean(),
    data: VideoViewSchema,
    error: Type.Optional(HttpErrorSchema),
  },
  { additionalProperties: false },
);
export type VideoStatusResponse = Static<typeof VideoStatusResponseSchema>;
