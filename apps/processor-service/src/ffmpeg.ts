import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';
import { join } from 'node:path';

const MAX_DIAGNOSTIC_BYTES = 8 * 1024;
const FRAME_FILE_PATTERN = 'frame-%06d.png';

type FfmpegChildProcess = ChildProcessByStdio<null, Readable, Readable>;

export type SpawnProcess = (command: string, arguments_: readonly string[]) => FfmpegChildProcess;

export interface FfmpegRunner {
  extractFrames(inputPath: string, framesDirectory: string, fps: number): Promise<void>;
}

export class FfmpegExecutionError extends Error {
  public constructor(public readonly diagnostic: string) {
    super('FFmpeg execution failed');
    this.name = 'FfmpegExecutionError';
  }
}

function appendBounded(current: Buffer, chunk: Buffer): Buffer {
  if (current.length >= MAX_DIAGNOSTIC_BYTES) {
    return current;
  }

  return Buffer.concat([current, chunk]).subarray(0, MAX_DIAGNOSTIC_BYTES);
}

const defaultSpawnProcess: SpawnProcess = (command, arguments_) =>
  spawn(command, arguments_, { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });

export class NodeFfmpegRunner implements FfmpegRunner {
  public constructor(private readonly spawnProcess: SpawnProcess = defaultSpawnProcess) {}

  public async extractFrames(
    inputPath: string,
    framesDirectory: string,
    fps: number,
  ): Promise<void> {
    if (!Number.isInteger(fps) || fps < 1 || fps > 10) {
      throw new RangeError('fps must be an integer between 1 and 10');
    }

    const arguments_ = [
      '-nostdin',
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      inputPath,
      '-vf',
      `fps=${fps}`,
      '-y',
      join(framesDirectory, FRAME_FILE_PATTERN),
    ];

    await new Promise<void>((resolve, reject) => {
      let child: FfmpegChildProcess;
      try {
        child = this.spawnProcess('ffmpeg', arguments_);
      } catch (error) {
        reject(new FfmpegExecutionError(String(error)));
        return;
      }

      let stdout: Buffer = Buffer.alloc(0);
      let stderr: Buffer = Buffer.alloc(0);
      let settled = false;

      child.stdout.on('data', (chunk: Buffer) => {
        stdout = appendBounded(stdout, chunk);
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr = appendBounded(stderr, chunk);
      });
      child.once('error', (error) => {
        if (!settled) {
          settled = true;
          reject(new FfmpegExecutionError(String(error)));
        }
      });
      child.once('close', (exitCode) => {
        if (settled) {
          return;
        }
        settled = true;

        if (exitCode === 0) {
          resolve();
          return;
        }

        reject(
          new FfmpegExecutionError(
            `exitCode=${String(exitCode)} stdout=${stdout.toString('utf8')} stderr=${stderr.toString('utf8')}`,
          ),
        );
      });
    });
  }
}
