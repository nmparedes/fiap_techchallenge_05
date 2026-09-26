import { describe, expect, it } from '@jest/globals';

import {
  DataMappingError,
  mapNotificationRow,
  mapUserRow,
  mapVideoRow,
  type VideoRow,
} from './mappings.js';

const now = new Date('2026-09-01T12:00:00.000Z');

const videoRow: VideoRow = {
  id: 'video-id',
  user_id: 'user-id',
  original_name: 'lesson.mp4',
  extension: 'mp4',
  size_bytes: '9007199254740993',
  fps: '1.500',
  status: 'PROCESSING',
  input_path: 'videos/input.mp4',
  output_path: null,
  error_code: null,
  error_message: null,
  attempt: '2',
  processing_started_at: '2026-09-01T12:00:00.000Z',
  completed_at: null,
  created_at: now,
  updated_at: now,
};

describe('MySQL row mappings', () => {
  it('maps user columns to the application shape', () => {
    expect(
      mapUserRow({
        id: 'user-id',
        username: 'john.doe',
        display_name: 'John Doe',
        password_hash: '$2b$12$hash',
        created_at: now,
        updated_at: '2026-09-01T12:00:00.000Z',
      }),
    ).toEqual({
      id: 'user-id',
      username: 'john.doe',
      displayName: 'John Doe',
      passwordHash: '$2b$12$hash',
      createdAt: now,
      updatedAt: now,
    });
  });

  it('maps lossless sizes, decimal FPS, status, paths, attempts, and nullable values', () => {
    expect(mapVideoRow(videoRow)).toEqual({
      id: 'video-id',
      userId: 'user-id',
      originalName: 'lesson.mp4',
      extension: 'mp4',
      sizeBytes: 9_007_199_254_740_993n,
      fps: 1.5,
      status: 'PROCESSING',
      inputPath: 'videos/input.mp4',
      outputPath: null,
      errorCode: null,
      errorMessage: null,
      attempt: 2,
      processingStartedAt: now,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    });
  });

  it('maps internal notifications and optional read timestamps', () => {
    expect(
      mapNotificationRow({
        id: 'notification-id',
        user_id: 'user-id',
        video_id: 'video-id',
        message: 'Processing failed',
        read_at: '2026-09-01T12:00:00.000Z',
        created_at: now,
      }),
    ).toEqual({
      id: 'notification-id',
      userId: 'user-id',
      videoId: 'video-id',
      message: 'Processing failed',
      readAt: now,
      createdAt: now,
    });
  });

  it.each([
    [{ ...videoRow, status: 'CANCELLED' }, 'status'],
    [{ ...videoRow, error_code: 'UNKNOWN_ERROR' }, 'error_code'],
    [{ ...videoRow, fps: 'not-a-number' }, 'fps'],
    [{ ...videoRow, size_bytes: 'not-an-integer' }, 'size_bytes'],
    [{ ...videoRow, created_at: 'not-a-date' }, 'created_at'],
  ] as const)('rejects invalid values for %s', (row, field) => {
    expect(() => mapVideoRow(row)).toThrow(DataMappingError);
    expect(() => mapVideoRow(row)).toThrow(`Invalid database value for ${field}`);
  });
});
