import { createReadStream, type ReadStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';

import type { VideoStoragePaths } from '@fiap-x/infrastructure';

export interface VideoFileStore {
  saveUpload(paths: VideoStoragePaths, content: Buffer): Promise<void>;
  deleteVideo(paths: VideoStoragePaths): Promise<void>;
  assertInputAvailable(paths: VideoStoragePaths, storedInputPath: string): Promise<void>;
  openArchive(paths: VideoStoragePaths, storedOutputPath: string): Promise<ReadStream>;
}

export class VideoFileStoreError extends Error {
  public constructor() {
    super('Video storage operation failed');
    this.name = 'VideoFileStoreError';
  }
}

export class LocalVideoFileStore implements VideoFileStore {
  public async saveUpload(paths: VideoStoragePaths, content: Buffer): Promise<void> {
    try {
      await mkdir(paths.videoDirectory, { recursive: true });
      await writeFile(paths.inputPath, content, { flag: 'wx' });
    } catch {
      throw new VideoFileStoreError();
    }
  }

  public async deleteVideo(paths: VideoStoragePaths): Promise<void> {
    try {
      await rm(paths.videoDirectory, { recursive: true, force: true });
    } catch {
      throw new VideoFileStoreError();
    }
  }

  public async assertInputAvailable(
    paths: VideoStoragePaths,
    storedInputPath: string,
  ): Promise<void> {
    await this.assertExpectedFile(paths.inputPath, storedInputPath);
  }

  public async openArchive(
    paths: VideoStoragePaths,
    storedOutputPath: string,
  ): Promise<ReadStream> {
    await this.assertExpectedArchive(paths, storedOutputPath);
    return createReadStream(paths.outputPath);
  }

  private async assertExpectedArchive(
    paths: VideoStoragePaths,
    storedOutputPath: string,
  ): Promise<void> {
    const expectedObjectKey = relative(paths.storageRoot, paths.outputPath).split(sep).join('/');
    const isExpectedPath = resolve(storedOutputPath) === resolve(paths.outputPath);

    if (storedOutputPath !== expectedObjectKey && !isExpectedPath) {
      throw new VideoFileStoreError();
    }

    try {
      const file = await stat(paths.outputPath);
      if (!file.isFile()) {
        throw new VideoFileStoreError();
      }
    } catch {
      throw new VideoFileStoreError();
    }
  }

  private async assertExpectedFile(expectedPath: string, storedPath: string): Promise<void> {
    if (resolve(storedPath) !== resolve(expectedPath)) {
      throw new VideoFileStoreError();
    }

    try {
      const file = await stat(expectedPath);
      if (!file.isFile()) {
        throw new VideoFileStoreError();
      }
    } catch {
      throw new VideoFileStoreError();
    }
  }
}
