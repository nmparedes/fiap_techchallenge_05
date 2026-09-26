import { describe, expect, it, jest } from '@jest/globals';
import type { MySqlPool } from '@fiap-x/infrastructure';
import type { ProcessingStatusEventV1 } from '@fiap-x/contracts';

import { MySqlVideoRepository, VideoRepositoryUnavailableError } from './video-repository.js';

const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const videoId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const startedEvent = {
  eventId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  eventType: 'video.processing.started',
  version: 1,
  occurredAt: '2026-01-01T00:00:00.000Z',
  payload: { videoId, userId, fps: 1, attempt: 1 },
} satisfies ProcessingStatusEventV1;

const row = {
  id: videoId,
  user_id: userId,
  original_name: 'movie.mp4',
  extension: 'mp4',
  size_bytes: '5',
  fps: '1',
  status: 'FAILED',
  input_path: '/storage/input.mp4',
  output_path: null,
  error_code: 'ZIP_ERROR',
  error_message: 'failed',
  attempt: '1',
  processing_started_at: null,
  completed_at: '2026-01-01T00:02:00.000Z',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:02:00.000Z',
};

function createPool() {
  const execute =
    jest.fn<(sql: string, values?: readonly unknown[]) => Promise<[unknown, unknown]>>();
  const query = jest.fn<(sql: string) => Promise<[unknown, unknown]>>();
  return {
    pool: { execute, query } as unknown as MySqlPool,
    execute,
    query,
  };
}

describe('MySqlVideoRepository', () => {
  it('creates and deletes videos using both owner and video identifiers', async () => {
    const { pool, execute } = createPool();
    execute.mockResolvedValue([{}, []]);
    const repository = new MySqlVideoRepository(pool);

    await repository.create({
      id: videoId,
      userId,
      originalName: 'movie.mp4',
      extension: 'mp4',
      sizeBytes: 5,
      fps: 1,
      inputPath: '/storage/input.mp4',
    });
    await repository.delete(userId, videoId);

    expect(execute.mock.calls[0]?.[0]).toContain("'QUEUED'");
    expect(execute).toHaveBeenLastCalledWith(expect.stringContaining('user_id = ?'), [
      videoId,
      userId,
    ]);
  });

  it('removes only a queued video through an atomic owner-scoped condition', async () => {
    const { pool, execute } = createPool();
    execute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);

    await expect(new MySqlVideoRepository(pool).deleteQueued(userId, videoId)).resolves.toBe(true);
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining("status = 'QUEUED'"),
      [videoId, userId],
    );
  });

  it('lists and loads videos only inside the authenticated owner boundary', async () => {
    const { pool, execute } = createPool();
    execute.mockResolvedValueOnce([[row], []]).mockResolvedValueOnce([[row], []]);
    const repository = new MySqlVideoRepository(pool);

    await expect(repository.listByUser(userId)).resolves.toEqual([
      expect.objectContaining({ id: videoId, userId, status: 'FAILED' }),
    ]);
    await expect(repository.findByUser(userId, videoId)).resolves.toEqual(
      expect.objectContaining({ id: videoId, userId }),
    );
    expect(execute.mock.calls[0]?.[1]).toEqual([userId]);
    expect(execute.mock.calls[0]?.[0]).toContain('ORDER BY created_at DESC');
    expect(execute.mock.calls[1]?.[1]).toEqual([videoId, userId]);
  });

  it('returns null when an owned video does not exist', async () => {
    const { pool, execute } = createPool();
    execute.mockResolvedValueOnce([[], []]);

    await expect(new MySqlVideoRepository(pool).findByUser(userId, videoId)).resolves.toBeNull();
  });

  it('atomically queues and restores retry state', async () => {
    const { pool, execute } = createPool();
    execute.mockResolvedValueOnce([{ affectedRows: 1 }, []]).mockResolvedValueOnce([{}, []]);
    const repository = new MySqlVideoRepository(pool);
    const record = {
      id: videoId,
      userId,
      originalName: 'movie.mp4',
      extension: 'mp4',
      sizeBytes: 5n,
      fps: 1,
      status: 'FAILED' as const,
      inputPath: '/storage/input.mp4',
      outputPath: null,
      errorCode: 'ZIP_ERROR' as const,
      errorMessage: 'failed',
      attempt: 1,
      processingStartedAt: null,
      completedAt: new Date('2026-01-01T00:00:00.000Z'),
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    };

    await expect(repository.retryFailed(record)).resolves.toBe(true);
    await expect(repository.restoreFailed(record)).resolves.toBeUndefined();
    expect(execute.mock.calls[0]?.[0]).toContain('attempt = attempt + 1');
    expect(execute.mock.calls[0]?.[0]).toContain('error_code = NULL');
    expect(execute.mock.calls[0]?.[0]).toContain("status = 'FAILED'");
    expect(execute.mock.calls[0]?.[1]).toEqual([videoId, userId, 1]);
    expect(execute.mock.calls[1]?.[1]).toContain(2);
  });

  it.each<ProcessingStatusEventV1>([
    startedEvent,
    {
      eventId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      eventType: 'video.processing.completed',
      version: 1,
      occurredAt: '2026-01-01T00:01:00.000Z',
      payload: {
        videoId,
        userId,
        archiveObjectKey: '/storage/output.zip',
        fps: 1,
        attempt: 1,
      },
    },
    {
      eventId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      eventType: 'video.processing.failed',
      version: 1,
      occurredAt: '2026-01-01T00:01:00.000Z',
      payload: {
        videoId,
        userId,
        errorCode: 'ZIP_ERROR',
        errorMessage: 'failed',
        fps: 1,
        attempt: 1,
      },
    },
  ])('applies $eventType only to the matching attempt', async (event) => {
    const { pool, execute } = createPool();
    execute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);

    await expect(new MySqlVideoRepository(pool).applyStatusEvent(event)).resolves.toBe(true);
    const sql = execute.mock.calls[0]?.[0];
    expect(sql).toContain('attempt = ?');
    expect(sql).toContain(
      event.eventType === 'video.processing.started'
        ? "status = 'QUEUED'"
        : "status = 'PROCESSING'",
    );
    expect(execute.mock.calls[0]?.[1]).toContain(userId);
    expect(execute.mock.calls[0]?.[1]).toContainEqual(new Date(event.occurredAt));
    if (event.eventType === 'video.processing.failed') {
      expect(execute.mock.calls[0]?.[1]).toEqual([
        'ZIP_ERROR',
        'failed',
        new Date(event.occurredAt),
        videoId,
        userId,
        1,
      ]);
    }
  });

  it('ignores duplicate, old, or out-of-order events through atomic state and attempt guards', async () => {
    const { pool, execute } = createPool();
    execute.mockResolvedValueOnce([{ affectedRows: 0 }, []]);

    await expect(new MySqlVideoRepository(pool).applyStatusEvent(startedEvent)).resolves.toBe(
      false,
    );
    expect(execute).toHaveBeenCalledWith(expect.stringContaining("status = 'QUEUED'"), [
      new Date(startedEvent.occurredAt),
      videoId,
      userId,
      1,
    ]);
  });

  it('reports readiness and sanitizes database failures', async () => {
    const { pool, execute, query } = createPool();
    query.mockResolvedValueOnce([[], []]);
    const repository = new MySqlVideoRepository(pool);
    await expect(repository.ping()).resolves.toBeUndefined();

    execute.mockRejectedValueOnce(new Error('mysql://user:password@host'));
    await expect(repository.listByUser(userId)).rejects.toEqual(
      new VideoRepositoryUnavailableError(),
    );

    execute.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(repository.applyStatusEvent(startedEvent)).rejects.toEqual(
      new VideoRepositoryUnavailableError(),
    );
  });
});
