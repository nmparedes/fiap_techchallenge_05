import { describe, expect, it } from '@jest/globals';
import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

import {
  AttemptSchema,
  AuthTokenClaimsSchema,
  AuthenticatedUserSchema,
  FpsSchema,
  HttpErrorResponseSchema,
  LoginRequestSchema,
  LoginResponseSchema,
  ProcessingCompletedEventV1Schema,
  ProcessingErrorCodeSchema,
  ProcessingFailedEventV1Schema,
  ProcessingRequestedEventV1Schema,
  ProcessingStartedEventV1Schema,
  VideoStatusSchema,
  VideoAcceptedResponseSchema,
  VideoDetailsResponseSchema,
  VideoIdParamsSchema,
  VideoListQuerySchema,
  VideoListResponseSchema,
  VideoStatusResponseSchema,
  createHttpSuccessSchema,
} from './index.js';

describe('shared contracts', () => {
  it('accepts only the supported statuses and processing errors', () => {
    for (const status of ['QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED']) {
      expect(Value.Check(VideoStatusSchema, status)).toBe(true);
    }

    expect(Value.Check(VideoStatusSchema, 'CANCELLED')).toBe(false);
    expect(Value.Check(ProcessingErrorCodeSchema, 'FFMPEG_ERROR')).toBe(true);
    expect(Value.Check(ProcessingErrorCodeSchema, 'ZIP_ERROR')).toBe(true);
    expect(Value.Check(ProcessingErrorCodeSchema, 'UNKNOWN_ERROR')).toBe(false);
  });

  it('defines reusable HTTP success and error envelopes', () => {
    const stringSuccessSchema = createHttpSuccessSchema(Type.String());

    expect(Value.Check(stringSuccessSchema, { success: true, data: 'ok' })).toBe(true);
    expect(Value.Check(stringSuccessSchema, { success: false, data: 'ok' })).toBe(false);
    expect(
      Value.Check(HttpErrorResponseSchema, {
        success: false,
        error: { code: 'INVALID_REQUEST', message: 'Invalid request' },
      }),
    ).toBe(true);
  });

  it('defines the minimal username/password authentication contracts', () => {
    expect(Value.Check(LoginRequestSchema, { username: 'john.doe', password: 'JohnDoe123!' })).toBe(
      true,
    );
    expect(Value.Check(LoginRequestSchema, { username: 'ab', password: 'secret' })).toBe(false);
    expect(AuthenticatedUserSchema.required).toEqual(['id', 'username', 'displayName']);
    expect(AuthenticatedUserSchema.properties.id.format).toBe('uuid');
    expect(AuthTokenClaimsSchema.required).toEqual(['sub', 'username', 'iss', 'aud', 'iat', 'exp']);
    expect(LoginResponseSchema.required).toEqual(['success', 'data']);
  });

  it('constrains FPS and attempt values', () => {
    expect(Value.Check(FpsSchema, 24)).toBe(true);
    expect(Value.Check(FpsSchema, 0)).toBe(false);
    expect(Value.Check(AttemptSchema, 1)).toBe(true);
    expect(Value.Check(AttemptSchema, 1.5)).toBe(false);
  });

  it('publishes video HTTP schemas for accepted jobs, catalog, and details', () => {
    expect(VideoIdParamsSchema.properties.id.format).toBe('uuid');
    expect(VideoListQuerySchema.properties.page.minimum).toBe(1);
    expect(VideoListQuerySchema.properties.pageSize.maximum).toBe(100);
    expect(VideoAcceptedResponseSchema.required).toEqual(['success', 'data']);
    expect(VideoListResponseSchema.properties.data.properties.items.type).toBe('array');
    expect(VideoDetailsResponseSchema.properties.data.properties.status).toBeDefined();
    expect(VideoStatusResponseSchema.properties.error).toBeDefined();
  });

  it('publishes four explicitly versioned processing event schemas', () => {
    const schemas = [
      ProcessingRequestedEventV1Schema,
      ProcessingStartedEventV1Schema,
      ProcessingCompletedEventV1Schema,
      ProcessingFailedEventV1Schema,
    ];

    expect(schemas.map((schema) => schema.$id)).toEqual([
      'ProcessingRequestedEventV1',
      'ProcessingStartedEventV1',
      'ProcessingCompletedEventV1',
      'ProcessingFailedEventV1',
    ]);

    for (const schema of schemas) {
      expect(schema.properties.version.const).toBe(1);
      expect(schema.properties.eventId.format).toBe('uuid');
      expect(schema.properties.occurredAt.format).toBe('date-time');
      expect(schema.properties.payload.properties.fps.exclusiveMinimum).toBe(0);
      expect(schema.properties.payload.properties.attempt.minimum).toBe(1);
    }
  });
});
