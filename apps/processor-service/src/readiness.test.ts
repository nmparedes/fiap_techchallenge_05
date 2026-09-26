import { EventEmitter } from 'node:events';
import { delimiter, join } from 'node:path';

import { describe, expect, it, jest } from '@jest/globals';

import {
  createFfmpegReadinessCheck,
  createRabbitMqReadinessCheck,
  createStorageReadinessCheck,
  type FileAccess,
} from './readiness.js';

describe('Processor readiness checks', () => {
  it('reports the established RabbitMQ connection as ready until it closes', async () => {
    const connection = new EventEmitter();
    const check = createRabbitMqReadinessCheck(connection);

    await expect(check()).resolves.toBeUndefined();
    connection.emit('close');
    await expect(check()).rejects.toThrow('RabbitMQ connection is unavailable');
  });

  it('reports the RabbitMQ connection as unavailable after an error', async () => {
    const connection = new EventEmitter();
    connection.on('error', () => undefined);
    const check = createRabbitMqReadinessCheck(connection);

    connection.emit('error', new Error('connection lost'));

    await expect(check()).rejects.toThrow('RabbitMQ connection is unavailable');
  });

  it('requires read and write access to storage', async () => {
    const fileAccess = jest.fn<FileAccess>(async () => undefined);
    const check = createStorageReadinessCheck('/storage', fileAccess);

    await expect(check()).resolves.toBeUndefined();
    expect(fileAccess).toHaveBeenCalledWith('/storage', expect.any(Number));

    fileAccess.mockRejectedValueOnce(new Error('read only'));
    await expect(check()).rejects.toThrow('read only');
  });

  it('finds an executable FFmpeg in PATH', async () => {
    const fileAccess = jest.fn<FileAccess>(async (path) => {
      if (path !== join('/tools', 'ffmpeg')) {
        throw new Error('missing');
      }
    });
    const check = createFfmpegReadinessCheck(
      { PATH: ['/missing', '/tools'].join(delimiter) },
      fileAccess,
    );

    await expect(check()).resolves.toBeUndefined();
  });

  it('reports FFmpeg as unavailable for a missing PATH or executable', async () => {
    await expect(createFfmpegReadinessCheck({})()).rejects.toThrow('PATH is unavailable');
    await expect(createFfmpegReadinessCheck({ PATH: delimiter })()).rejects.toThrow(
      'FFmpeg executable is unavailable',
    );
    await expect(
      createFfmpegReadinessCheck(
        { PATH: '/missing' },
        jest.fn<FileAccess>(async () => {
          throw new Error('missing');
        }),
      )(),
    ).rejects.toThrow('FFmpeg executable is unavailable');
  });
});
