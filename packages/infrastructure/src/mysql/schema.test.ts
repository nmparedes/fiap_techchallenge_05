import { readFile } from 'node:fs/promises';

import { describe, expect, it } from '@jest/globals';

const migrationRoot = new URL('../../../../infra/mysql/migrations/', import.meta.url);

describe('versioned MySQL schema', () => {
  it('creates exactly the three requested logical databases', async () => {
    const bootstrap = await readFile(new URL('0001_create_databases.sql', migrationRoot), 'utf8');

    expect(bootstrap.match(/CREATE DATABASE IF NOT EXISTS/g)).toHaveLength(3);
    expect(bootstrap).toContain('auth_db');
    expect(bootstrap).toContain('video_db');
    expect(bootstrap).toContain('notification_db');
    expect(bootstrap).not.toContain('processor_db');
  });

  it('keeps service tables isolated and avoids cross-database relationships', async () => {
    const [auth, video, notification] = await Promise.all([
      readFile(new URL('auth_db/0001_create_users.sql', migrationRoot), 'utf8'),
      readFile(new URL('video_db/0001_create_videos.sql', migrationRoot), 'utf8'),
      readFile(new URL('notification_db/0001_create_notifications.sql', migrationRoot), 'utf8'),
    ]);

    expect(auth).toContain('CREATE TABLE IF NOT EXISTS users');
    expect(video).toContain('CREATE TABLE IF NOT EXISTS videos');
    expect(notification).toContain('CREATE TABLE IF NOT EXISTS notifications');
    expect(`${auth}${video}${notification}`).not.toMatch(/FOREIGN KEY|REFERENCES/i);
  });

  it('persists every required video field', async () => {
    const video = (
      await Promise.all([
        readFile(new URL('video_db/0001_create_videos.sql', migrationRoot), 'utf8'),
        readFile(new URL('video_db/0002_add_video_error_code.sql', migrationRoot), 'utf8'),
      ])
    ).join('\n');

    for (const column of [
      'id',
      'user_id',
      'original_name',
      'extension',
      'size_bytes',
      'fps',
      'status',
      'input_path',
      'output_path',
      'error_code',
      'error_message',
      'attempt',
      'created_at',
      'updated_at',
    ]) {
      expect(video).toMatch(new RegExp(`\\b${column}\\b`));
    }
    expect(video).toContain("error_code IN ('FFMPEG_ERROR', 'ZIP_ERROR')");
  });
});
