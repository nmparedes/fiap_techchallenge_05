import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { delimiter, join } from 'node:path';

export type ReadinessCheck = () => Promise<void>;

export interface ProcessorReadinessChecks {
  rabbitMq: ReadinessCheck;
  storage: ReadinessCheck;
  ffmpeg: ReadinessCheck;
}

export type FileAccess = (path: string, mode: number) => Promise<void>;

const defaultFileAccess: FileAccess = async (path, mode) => access(path, mode);

export interface RabbitMqConnectionEvents {
  on(event: 'error' | 'close', listener: () => void): unknown;
}

export function createRabbitMqReadinessCheck(connection: RabbitMqConnectionEvents): ReadinessCheck {
  let connected = true;
  const markDisconnected = () => {
    connected = false;
  };
  connection.on('error', markDisconnected);
  connection.on('close', markDisconnected);

  return async () => {
    if (!connected) {
      throw new Error('RabbitMQ connection is unavailable');
    }
  };
}

export function createStorageReadinessCheck(
  storageRoot: string,
  fileAccess: FileAccess = defaultFileAccess,
): ReadinessCheck {
  return async () => {
    await fileAccess(storageRoot, constants.R_OK | constants.W_OK);
  };
}

export function createFfmpegReadinessCheck(
  environment: NodeJS.ProcessEnv = process.env,
  fileAccess: FileAccess = defaultFileAccess,
): ReadinessCheck {
  return async () => {
    const searchPath = environment['PATH'];
    if (searchPath === undefined || searchPath.trim().length === 0) {
      throw new Error('PATH is unavailable');
    }

    const candidates = searchPath
      .split(delimiter)
      .filter((directory) => directory.length > 0)
      .map((directory) => fileAccess(join(directory, 'ffmpeg'), constants.X_OK));

    if (candidates.length === 0) {
      throw new Error('FFmpeg executable is unavailable');
    }

    try {
      await Promise.any(candidates);
    } catch {
      throw new Error('FFmpeg executable is unavailable');
    }
  };
}
