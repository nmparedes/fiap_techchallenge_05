import { describe, expect, it, jest } from '@jest/globals';
import type { MySqlPool } from '@fiap-x/infrastructure';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';

import {
  MySqlNotificationRepository,
  NotificationRepositoryUnavailableError,
  type CreateNotificationInput,
} from './notification-repository.js';

const notification: CreateNotificationInput = {
  id: '11111111-1111-4111-8111-111111111111',
  userId: '22222222-2222-4222-8222-222222222222',
  videoId: '33333333-3333-4333-8333-333333333333',
  attempt: 1,
  errorCode: 'FFMPEG_ERROR',
  message: 'Video processing failed while extracting frames.',
  createdAt: new Date('2026-09-01T12:01:00.000Z'),
};

function createPool(affectedRows = 1) {
  const execute = jest
    .fn<MySqlPool['execute']>()
    .mockResolvedValue([{ affectedRows } as ResultSetHeader, []]);
  return { pool: { execute } as unknown as MySqlPool, execute };
}

describe('MySqlNotificationRepository', () => {
  it('persists the failure fields with an atomic idempotency clause', async () => {
    const { pool, execute } = createPool();

    await expect(new MySqlNotificationRepository(pool).persist(notification)).resolves.toBe(
      'created',
    );

    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('ON DUPLICATE KEY UPDATE id = id'),
      [
        notification.id,
        notification.userId,
        notification.videoId,
        notification.attempt,
        notification.errorCode,
        notification.message,
        notification.createdAt,
      ],
    );
  });

  it('treats a unique-key collision as an already persisted notification', async () => {
    const { pool } = createPool(0);

    await expect(new MySqlNotificationRepository(pool).persist(notification)).resolves.toBe(
      'duplicate',
    );
  });

  it('propagates a sanitized repository error when MySQL fails', async () => {
    const { pool, execute } = createPool();
    execute.mockRejectedValueOnce(new Error('mysql://user:password@host'));

    await expect(new MySqlNotificationRepository(pool).persist(notification)).rejects.toEqual(
      new NotificationRepositoryUnavailableError(),
    );
  });

  it('lists only the requested user with deterministic newest-first pagination', async () => {
    const { pool, execute } = createPool();
    execute
      .mockResolvedValueOnce([
        [
          {
            id: notification.id,
            video_id: notification.videoId,
            attempt: notification.attempt,
            error_code: notification.errorCode,
            message: notification.message,
            created_at: notification.createdAt,
          } as RowDataPacket,
        ] as RowDataPacket[],
        [],
      ])
      .mockResolvedValueOnce([[{ total: '6' } as RowDataPacket] as RowDataPacket[], []]);
    const repository = new MySqlNotificationRepository(pool);

    await expect(
      repository.listByUser(notification.userId, { page: 2, pageSize: 5 }),
    ).resolves.toEqual({
      items: [
        {
          id: notification.id,
          videoId: notification.videoId,
          attempt: notification.attempt,
          errorCode: notification.errorCode,
          message: notification.message,
          createdAt: notification.createdAt.toISOString(),
        },
      ],
      page: 2,
      pageSize: 5,
      total: 6,
      totalPages: 2,
    });
    expect(execute.mock.calls[0]?.[0]).toContain('WHERE user_id = ?');
    expect(execute.mock.calls[0]?.[0]).toContain('ORDER BY created_at DESC, id DESC');
    expect(execute.mock.calls[0]?.[0]).toContain('LIMIT 5 OFFSET 5');
    expect(execute.mock.calls[0]?.[1]).toEqual([notification.userId]);
    expect(execute.mock.calls[1]?.[0]).toContain('WHERE user_id = ?');
    expect(execute.mock.calls[1]?.[1]).toEqual([notification.userId]);
  });

  it('sanitizes listing failures', async () => {
    const { pool, execute } = createPool();
    execute.mockRejectedValueOnce(new Error('sensitive SQL'));

    await expect(
      new MySqlNotificationRepository(pool).listByUser(notification.userId, {
        page: 1,
        pageSize: 20,
      }),
    ).rejects.toEqual(new NotificationRepositoryUnavailableError());
  });
});
