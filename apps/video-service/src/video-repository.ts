import {
  mapVideoRow,
  type MySqlPool,
  type VideoRecord,
  type VideoRow,
} from '@fiap-x/infrastructure';
import type { ProcessingStatusEventV1 } from '@fiap-x/contracts';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';

type VideoDatabaseRow = VideoRow & RowDataPacket;

export interface CreateVideoInput {
  id: string;
  userId: string;
  originalName: string;
  extension: string;
  sizeBytes: number;
  fps: number;
  inputPath: string;
}

export interface VideoRepository {
  create(input: CreateVideoInput): Promise<void>;
  delete(userId: string, videoId: string): Promise<void>;
  deleteQueued(userId: string, videoId: string): Promise<boolean>;
  listByUser(userId: string): Promise<VideoRecord[]>;
  findByUser(userId: string, videoId: string): Promise<VideoRecord | null>;
  retryFailed(video: VideoRecord): Promise<boolean>;
  restoreFailed(video: VideoRecord): Promise<void>;
  applyStatusEvent(event: ProcessingStatusEventV1): Promise<boolean>;
  ping(): Promise<void>;
}

export class VideoRepositoryUnavailableError extends Error {
  public constructor() {
    super('The video repository is unavailable');
    this.name = 'VideoRepositoryUnavailableError';
  }
}

export class MySqlVideoRepository implements VideoRepository {
  public constructor(private readonly pool: MySqlPool) {}

  public async create(input: CreateVideoInput): Promise<void> {
    try {
      await this.pool.execute(
        `INSERT INTO videos
           (id, user_id, original_name, extension, size_bytes, fps, status, input_path, attempt)
         VALUES (?, ?, ?, ?, ?, ?, 'QUEUED', ?, 1)`,
        [
          input.id,
          input.userId,
          input.originalName,
          input.extension,
          input.sizeBytes,
          input.fps,
          input.inputPath,
        ],
      );
    } catch {
      throw new VideoRepositoryUnavailableError();
    }
  }

  public async delete(userId: string, videoId: string): Promise<void> {
    try {
      await this.pool.execute('DELETE FROM videos WHERE id = ? AND user_id = ?', [videoId, userId]);
    } catch {
      throw new VideoRepositoryUnavailableError();
    }
  }

  public async deleteQueued(userId: string, videoId: string): Promise<boolean> {
    try {
      const [result] = await this.pool.execute<ResultSetHeader>(
        "DELETE FROM videos WHERE id = ? AND user_id = ? AND status = 'QUEUED'",
        [videoId, userId],
      );
      return result.affectedRows === 1;
    } catch {
      throw new VideoRepositoryUnavailableError();
    }
  }

  public async listByUser(userId: string): Promise<VideoRecord[]> {
    try {
      const [rows] = await this.pool.execute<VideoDatabaseRow[]>(
        `SELECT id, user_id, original_name, extension, size_bytes, fps, status, input_path,
                output_path, error_code, error_message, attempt, processing_started_at, completed_at,
                created_at, updated_at
         FROM videos
         WHERE user_id = ?
         ORDER BY created_at DESC`,
        [userId],
      );

      return rows.map(mapVideoRow);
    } catch {
      throw new VideoRepositoryUnavailableError();
    }
  }

  public async findByUser(userId: string, videoId: string): Promise<VideoRecord | null> {
    try {
      const [rows] = await this.pool.execute<VideoDatabaseRow[]>(
        `SELECT id, user_id, original_name, extension, size_bytes, fps, status, input_path,
                output_path, error_code, error_message, attempt, processing_started_at, completed_at,
                created_at, updated_at
         FROM videos
         WHERE id = ? AND user_id = ?
         LIMIT 1`,
        [videoId, userId],
      );
      const row = rows[0];

      return row === undefined ? null : mapVideoRow(row);
    } catch {
      throw new VideoRepositoryUnavailableError();
    }
  }

  public async retryFailed(video: VideoRecord): Promise<boolean> {
    try {
      const [result] = await this.pool.execute<ResultSetHeader>(
        `UPDATE videos
         SET status = 'QUEUED', attempt = attempt + 1, output_path = NULL, error_code = NULL,
             error_message = NULL, processing_started_at = NULL, completed_at = NULL
         WHERE id = ? AND user_id = ? AND status = 'FAILED' AND attempt = ?`,
        [video.id, video.userId, video.attempt],
      );

      return result.affectedRows === 1;
    } catch {
      throw new VideoRepositoryUnavailableError();
    }
  }

  public async restoreFailed(video: VideoRecord): Promise<void> {
    try {
      await this.pool.execute(
        `UPDATE videos
         SET status = 'FAILED', attempt = ?, output_path = ?, error_code = ?, error_message = ?,
             processing_started_at = ?, completed_at = ?
         WHERE id = ? AND user_id = ? AND status = 'QUEUED' AND attempt = ?`,
        [
          video.attempt,
          video.outputPath,
          video.errorCode,
          video.errorMessage,
          video.processingStartedAt,
          video.completedAt,
          video.id,
          video.userId,
          video.attempt + 1,
        ],
      );
    } catch {
      throw new VideoRepositoryUnavailableError();
    }
  }

  public async applyStatusEvent(event: ProcessingStatusEventV1): Promise<boolean> {
    const { videoId, userId, attempt } = event.payload;
    const occurredAt = new Date(event.occurredAt);
    let sql: string;
    let values: readonly unknown[];

    switch (event.eventType) {
      case 'video.processing.started':
        sql = `UPDATE videos SET status = 'PROCESSING', processing_started_at = ?,
                      error_code = NULL, error_message = NULL
               WHERE id = ? AND user_id = ? AND attempt = ? AND status = 'QUEUED'`;
        values = [occurredAt, videoId, userId, attempt];
        break;
      case 'video.processing.completed':
        sql = `UPDATE videos SET status = 'COMPLETED', output_path = ?, completed_at = ?,
                      error_code = NULL, error_message = NULL
               WHERE id = ? AND user_id = ? AND attempt = ? AND status = 'PROCESSING'`;
        values = [event.payload.archiveObjectKey, occurredAt, videoId, userId, attempt];
        break;
      case 'video.processing.failed':
        sql = `UPDATE videos SET status = 'FAILED', error_code = ?, error_message = ?,
                      completed_at = ?
               WHERE id = ? AND user_id = ? AND attempt = ? AND status = 'PROCESSING'`;
        values = [
          event.payload.errorCode,
          event.payload.errorMessage,
          occurredAt,
          videoId,
          userId,
          attempt,
        ];
        break;
    }

    try {
      const [result] = await this.pool.execute<ResultSetHeader>(sql, values);
      return result.affectedRows === 1;
    } catch {
      throw new VideoRepositoryUnavailableError();
    }
  }

  public async ping(): Promise<void> {
    try {
      await this.pool.query('SELECT 1');
    } catch {
      throw new VideoRepositoryUnavailableError();
    }
  }
}
