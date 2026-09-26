import { readdir } from 'node:fs/promises';
import { relative, sep } from 'node:path';

import type { ProcessingErrorCode } from '@fiap-x/contracts';
import {
  cleanupVideoProcessingAttempt,
  createVideoStoragePaths,
  prepareVideoProcessingAttempt,
  type VideoStoragePaths,
} from '@fiap-x/infrastructure';

import type { FfmpegRunner } from './ffmpeg.js';
import type { ZipCreator } from './zip.js';

const FRAME_NAME_PATTERN = /^frame-\d{6,}\.png$/;

export interface ProcessingAttemptInput {
  storageRoot: string;
  userId: string;
  videoId: string;
  extension: string;
  fps: number;
  attempt: number;
}

export interface ProcessingAttemptSuccess {
  success: true;
  videoId: string;
  userId: string;
  fps: number;
  attempt: number;
  archiveObjectKey: string;
  outputPath: string;
  frameCount: number;
}

export interface ProcessingAttemptFailure {
  success: false;
  videoId: string;
  userId: string;
  fps: number;
  attempt: number;
  errorCode: ProcessingErrorCode;
  errorMessage: string;
}

export type ProcessingAttemptResult = ProcessingAttemptSuccess | ProcessingAttemptFailure;

export interface ProcessingAttemptStorage {
  prepare(paths: VideoStoragePaths): Promise<void>;
  listFrames(framesDirectory: string): Promise<string[]>;
  cleanup(paths: VideoStoragePaths, succeeded: boolean): Promise<void>;
}

const defaultStorage: ProcessingAttemptStorage = {
  prepare: prepareVideoProcessingAttempt,
  listFrames: async (framesDirectory) => {
    const entries = await readdir(framesDirectory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && FRAME_NAME_PATTERN.test(entry.name))
      .map((entry) => `${framesDirectory}${sep}${entry.name}`)
      .sort();
  },
  cleanup: cleanupVideoProcessingAttempt,
};

export interface VideoProcessingAttemptOptions {
  ffmpeg: FfmpegRunner;
  zip: ZipCreator;
  storage?: ProcessingAttemptStorage;
}

export class VideoProcessingAttempt {
  private readonly storage: ProcessingAttemptStorage;

  public constructor(private readonly options: VideoProcessingAttemptOptions) {
    this.storage = options.storage ?? defaultStorage;
  }

  public async process(input: ProcessingAttemptInput): Promise<ProcessingAttemptResult> {
    if (!Number.isInteger(input.fps) || input.fps < 1 || input.fps > 10) {
      throw new RangeError('fps must be an integer between 1 and 10');
    }

    const paths = createVideoStoragePaths(
      input.storageRoot,
      input.userId,
      input.videoId,
      input.extension,
    );
    await this.storage.prepare(paths);
    let succeeded = false;

    try {
      let frames: string[];
      try {
        await this.options.ffmpeg.extractFrames(paths.inputPath, paths.framesDirectory, input.fps);
        frames = await this.storage.listFrames(paths.framesDirectory);
        if (frames.length === 0) {
          throw new Error('FFmpeg produced no frames');
        }
      } catch {
        return this.failure(input, 'FFMPEG_ERROR', 'Video frame extraction failed');
      }

      try {
        await this.options.zip.create(frames, paths.outputPath);
      } catch {
        return this.failure(input, 'ZIP_ERROR', 'Video frame archive creation failed');
      }

      succeeded = true;
      return {
        success: true,
        videoId: input.videoId,
        userId: input.userId,
        fps: input.fps,
        attempt: input.attempt,
        archiveObjectKey: relative(paths.storageRoot, paths.outputPath).split(sep).join('/'),
        outputPath: paths.outputPath,
        frameCount: frames.length,
      };
    } finally {
      await this.storage.cleanup(paths, succeeded);
    }
  }

  private failure(
    input: ProcessingAttemptInput,
    errorCode: ProcessingErrorCode,
    errorMessage: string,
  ): ProcessingAttemptFailure {
    return {
      success: false,
      videoId: input.videoId,
      userId: input.userId,
      fps: input.fps,
      attempt: input.attempt,
      errorCode,
      errorMessage,
    };
  }
}
