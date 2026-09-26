import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { createVideoStoragePaths } from '@fiap-x/infrastructure';

import type { FfmpegRunner } from './ffmpeg.js';
import {
  VideoProcessingAttempt,
  type ProcessingAttemptInput,
  type ProcessingAttemptStorage,
} from './processing-attempt.js';
import { StoredZipCreator, type ZipCreator } from './zip.js';

const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const videoId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function readStoredZipEntries(archive: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();
  let offset = 0;

  while (archive.readUInt32LE(offset) === 0x04034b50) {
    const size = archive.readUInt32LE(offset + 18);
    const nameLength = archive.readUInt16LE(offset + 26);
    const extraLength = archive.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const contentStart = nameStart + nameLength + extraLength;
    const name = archive.subarray(nameStart, nameStart + nameLength).toString('utf8');
    entries.set(name, archive.subarray(contentStart, contentStart + size));
    offset = contentStart + size;
  }

  return entries;
}

describe('VideoProcessingAttempt', () => {
  let storageRoot: string;
  let input: ProcessingAttemptInput;

  beforeEach(async () => {
    storageRoot = await mkdtemp(join(tmpdir(), 'fiap-x-processor-'));
    input = { storageRoot, userId, videoId, extension: 'mp4', fps: 1, attempt: 2 };
    const paths = createVideoStoragePaths(storageRoot, userId, videoId, 'mp4');
    await mkdir(paths.framesDirectory, { recursive: true });
    await writeFile(paths.inputPath, 'video');
    await writeFile(join(paths.framesDirectory, 'frame-000001.png'), 'stale-frame');
  });

  afterEach(async () => {
    await rm(storageRoot, { recursive: true, force: true });
  });

  it.each([1, 10])(
    'creates only current-attempt frames and cleans temporary files for fps %i',
    async (fps) => {
      input.fps = fps;
      const ffmpeg: FfmpegRunner = {
        extractFrames: jest.fn(async (_inputPath: string, framesDirectory: string) => {
          await writeFile(join(framesDirectory, 'frame-000002.png'), `frame-${fps}-two`);
          await writeFile(join(framesDirectory, 'frame-000001.png'), `frame-${fps}-one`);
          await writeFile(join(framesDirectory, 'diagnostic.txt'), 'not a frame');
        }),
      };
      const processor = new VideoProcessingAttempt({ ffmpeg, zip: new StoredZipCreator() });

      const result = await processor.process(input);

      expect(result).toMatchObject({
        success: true,
        videoId,
        userId,
        fps,
        attempt: 2,
        archiveObjectKey: `${userId}/${videoId}/output.zip`,
        frameCount: 2,
      });
      if (!result.success) {
        throw new Error('Expected successful processing');
      }

      const archiveEntries = readStoredZipEntries(await readFile(result.outputPath));
      expect([...archiveEntries.keys()]).toEqual(['frame-000001.png', 'frame-000002.png']);
      expect(archiveEntries.get('frame-000001.png')?.toString()).toBe(`frame-${fps}-one`);
      expect(archiveEntries.get('frame-000002.png')?.toString()).toBe(`frame-${fps}-two`);
      await expect(
        access(createVideoStoragePaths(storageRoot, userId, videoId, 'mp4').inputPath),
      ).rejects.toThrow();
      await expect(
        access(createVideoStoragePaths(storageRoot, userId, videoId, 'mp4').framesDirectory),
      ).rejects.toThrow();
    },
  );

  it.each([0, 1.5, 11])('rejects invalid fps %s before preparing storage', async (fps) => {
    const storage: ProcessingAttemptStorage = {
      prepare: jest.fn(async () => undefined),
      listFrames: jest.fn(async () => []),
      cleanup: jest.fn(async () => undefined),
    };
    const processor = new VideoProcessingAttempt({
      ffmpeg: { extractFrames: jest.fn(async () => undefined) },
      zip: { create: jest.fn(async () => undefined) },
      storage,
    });

    await expect(processor.process({ ...input, fps })).rejects.toThrow(
      'fps must be an integer between 1 and 10',
    );
    expect(storage.prepare).not.toHaveBeenCalled();
  });

  it('maps FFmpeg startup or exit failure and keeps the input', async () => {
    const ffmpeg: FfmpegRunner = {
      extractFrames: jest.fn(async () => {
        throw new Error('private FFmpeg detail');
      }),
    };
    const zip: ZipCreator = { create: jest.fn(async () => undefined) };
    const paths = createVideoStoragePaths(storageRoot, userId, videoId, 'mp4');
    const processor = new VideoProcessingAttempt({ ffmpeg, zip });

    const result = await processor.process(input);

    expect(result).toEqual({
      success: false,
      videoId,
      userId,
      fps: 1,
      attempt: 2,
      errorCode: 'FFMPEG_ERROR',
      errorMessage: 'Video frame extraction failed',
    });
    expect(zip.create).not.toHaveBeenCalled();
    await expect(access(paths.inputPath)).resolves.toBeUndefined();
    await expect(access(paths.framesDirectory)).rejects.toThrow();
  });

  it('maps an execution with no frames to FFMPEG_ERROR', async () => {
    const processor = new VideoProcessingAttempt({
      ffmpeg: { extractFrames: jest.fn(async () => undefined) },
      zip: { create: jest.fn(async () => undefined) },
    });

    const result = await processor.process(input);

    expect(result).toMatchObject({ success: false, errorCode: 'FFMPEG_ERROR' });
  });

  it('maps ZIP failure, removes frames, and keeps the input', async () => {
    const paths = createVideoStoragePaths(storageRoot, userId, videoId, 'mp4');
    const processor = new VideoProcessingAttempt({
      ffmpeg: {
        extractFrames: jest.fn(async (_inputPath: string, framesDirectory: string) => {
          await writeFile(join(framesDirectory, 'frame-000001.png'), 'frame');
        }),
      },
      zip: {
        create: jest.fn(async () => {
          throw new Error('private ZIP detail');
        }),
      },
    });

    const result = await processor.process(input);

    expect(result).toMatchObject({
      success: false,
      errorCode: 'ZIP_ERROR',
      errorMessage: 'Video frame archive creation failed',
    });
    await expect(access(paths.inputPath)).resolves.toBeUndefined();
    await expect(access(paths.framesDirectory)).rejects.toThrow();
    await expect(access(paths.outputPath)).rejects.toThrow();
  });
});
