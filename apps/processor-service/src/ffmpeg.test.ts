import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { describe, expect, it, jest } from '@jest/globals';

import { FfmpegExecutionError, NodeFfmpegRunner, type SpawnProcess } from './ffmpeg.js';

function createChildProcess() {
  const process = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
  });
  return process;
}

describe('NodeFfmpegRunner', () => {
  it.each([1, 10])('runs FFmpeg without a shell for fps %i', async (fps) => {
    const child = createChildProcess();
    const spawnProcess = jest.fn<SpawnProcess>(() => child as unknown as ReturnType<SpawnProcess>);
    const runner = new NodeFfmpegRunner(spawnProcess);

    const execution = runner.extractFrames('/videos/input.mp4', '/videos/frames', fps);
    child.emit('close', 0);
    await execution;

    expect(spawnProcess).toHaveBeenCalledWith('ffmpeg', [
      '-nostdin',
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      '/videos/input.mp4',
      '-vf',
      `fps=${fps}`,
      '-y',
      expect.stringMatching(/frames[/\\]frame-%06d\.png$/),
    ]);
  });

  it.each([0, 0.5, 11])('rejects invalid fps %s before spawning', async (fps) => {
    const spawnProcess = jest.fn<SpawnProcess>();
    const runner = new NodeFfmpegRunner(spawnProcess);

    await expect(runner.extractFrames('input.mp4', 'frames', fps)).rejects.toThrow(
      'fps must be an integer between 1 and 10',
    );
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it('fails when the process cannot be started', async () => {
    const spawnProcess = jest.fn<SpawnProcess>(() => {
      throw new Error('spawn failed');
    });
    const runner = new NodeFfmpegRunner(spawnProcess);

    await expect(runner.extractFrames('input.mp4', 'frames', 1)).rejects.toBeInstanceOf(
      FfmpegExecutionError,
    );
  });

  it('fails on a process error event and ignores a later close event', async () => {
    const child = createChildProcess();
    const runner = new NodeFfmpegRunner(
      jest.fn<SpawnProcess>(() => child as unknown as ReturnType<SpawnProcess>),
    );

    const execution = runner.extractFrames('input.mp4', 'frames', 1);
    child.emit('error', new Error('not executable'));
    child.emit('close', 1);

    await expect(execution).rejects.toBeInstanceOf(FfmpegExecutionError);
  });

  it('fails on a nonzero exit and bounds stdout and stderr diagnostics', async () => {
    const child = createChildProcess();
    const runner = new NodeFfmpegRunner(
      jest.fn<SpawnProcess>(() => child as unknown as ReturnType<SpawnProcess>),
    );

    const execution = runner.extractFrames('input.mp4', 'frames', 1);
    child.stdout.write(Buffer.alloc(20_000, 'o'));
    child.stderr.write(Buffer.alloc(20_000, 'e'));
    child.emit('close', 2);

    const error = await execution.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(FfmpegExecutionError);
    expect((error as FfmpegExecutionError).diagnostic).toContain('exitCode=2');
    expect((error as FfmpegExecutionError).diagnostic.length).toBeLessThan(17_000);
  });

  it('fails when FFmpeg closes without an exit code', async () => {
    const child = createChildProcess();
    const runner = new NodeFfmpegRunner(
      jest.fn<SpawnProcess>(() => child as unknown as ReturnType<SpawnProcess>),
    );

    const execution = runner.extractFrames('input.mp4', 'frames', 10);
    child.emit('close', null);

    await expect(execution).rejects.toBeInstanceOf(FfmpegExecutionError);
  });
});
