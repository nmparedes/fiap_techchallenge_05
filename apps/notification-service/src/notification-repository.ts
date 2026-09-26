import type { ProcessingErrorCode } from '@fiap-x/contracts';
import type { MySqlPool } from '@fiap-x/infrastructure';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';

import type { NotificationPage, NotificationView } from './notification.js';

export interface CreateNotificationInput {
  id: string;
  userId: string;
  videoId: string;
  attempt: number;
  errorCode: ProcessingErrorCode;
  message: string;
  createdAt: Date;
}

export type NotificationPersistenceOutcome = 'created' | 'duplicate';

export interface NotificationWriter {
  persist(input: CreateNotificationInput): Promise<NotificationPersistenceOutcome>;
}

export interface NotificationReader {
  listByUser(
    userId: string,
    pagination: { page: number; pageSize: number },
  ): Promise<NotificationPage>;
}

export interface NotificationRepository extends NotificationWriter, NotificationReader {}

interface NotificationRow extends RowDataPacket {
  id: string;
  video_id: string;
  attempt: number;
  error_code: ProcessingErrorCode;
  message: string;
  created_at: Date | string;
}

interface NotificationCountRow extends RowDataPacket {
  total: number | string;
}

function mapNotificationRow(row: NotificationRow): NotificationView {
  return {
    id: row.id,
    videoId: row.video_id,
    attempt: row.attempt,
    errorCode: row.error_code,
    message: row.message,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export class NotificationRepositoryUnavailableError extends Error {
  public constructor() {
    super('The notification repository is unavailable');
    this.name = 'NotificationRepositoryUnavailableError';
  }
}

export class MySqlNotificationRepository implements NotificationRepository {
  public constructor(private readonly pool: MySqlPool) {}

  public async persist(input: CreateNotificationInput): Promise<NotificationPersistenceOutcome> {
    try {
      const [result] = await this.pool.execute<ResultSetHeader>(
        `INSERT INTO notifications
           (id, user_id, video_id, attempt, error_code, message, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE id = id`,
        [
          input.id,
          input.userId,
          input.videoId,
          input.attempt,
          input.errorCode,
          input.message,
          input.createdAt,
        ],
      );

      return result.affectedRows === 1 ? 'created' : 'duplicate';
    } catch {
      throw new NotificationRepositoryUnavailableError();
    }
  }

  public async listByUser(
    userId: string,
    pagination: { page: number; pageSize: number },
  ): Promise<NotificationPage> {
    const offset = (pagination.page - 1) * pagination.pageSize;
    // MySQL rejects LIMIT/OFFSET placeholders in prepared statements in the
    // version used by the local cluster. These values originate from the
    // route's bounded integer schema; user_id remains parameterized.
    const limit = boundedSqlInteger(pagination.pageSize);
    const safeOffset = boundedSqlInteger(offset);

    try {
      const [[rows], [countRows]] = await Promise.all([
        this.pool.execute<NotificationRow[]>(
          `SELECT id, video_id, attempt, error_code, message, created_at
           FROM notifications
           WHERE user_id = ?
           ORDER BY created_at DESC, id DESC
           LIMIT ${limit} OFFSET ${safeOffset}`,
          [userId],
        ),
        this.pool.execute<NotificationCountRow[]>(
          'SELECT COUNT(*) AS total FROM notifications WHERE user_id = ?',
          [userId],
        ),
      ]);
      const total = Number(countRows[0]?.total ?? 0);

      return {
        items: rows.map(mapNotificationRow),
        page: pagination.page,
        pageSize: pagination.pageSize,
        total,
        totalPages: Math.ceil(total / pagination.pageSize),
      };
    } catch {
      throw new NotificationRepositoryUnavailableError();
    }
  }
}

function boundedSqlInteger(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new NotificationRepositoryUnavailableError();
  }

  return value;
}
