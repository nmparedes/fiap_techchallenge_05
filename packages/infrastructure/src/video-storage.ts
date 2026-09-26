import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import { mkdir, rm } from 'node:fs/promises';

import { normalizeUuid } from './identifiers.js';

export const SUPPORTED_VIDEO_EXTENSIONS = [
  'mp4',
  'avi',
  'mov',
  'mkv',
  'wmv',
  'flv',
  'webm',
] as const;

export interface VideoStoragePaths {
  storageRoot: string;
  videoDirectory: string;
  inputPath: string;
  framesDirectory: string;
  outputPath: string;
}

export interface VideoStorageFileSystem {
  makeDirectory(path: string): Promise<void>;
  remove(path: string, options: { recursive: boolean; force: boolean }): Promise<void>;
}

const defaultFileSystem: VideoStorageFileSystem = {
  makeDirectory: async (path) => {
    await mkdir(path, { recursive: true });
  },
  remove: async (path, options) => {
    await rm(path, options);
  },
};

function normalizeExtension(extension: string): string {
  const normalized = extension.replace(/^\./, '').toLowerCase();

  if (!(SUPPORTED_VIDEO_EXTENSIONS as readonly string[]).includes(normalized)) {
    throw new TypeError('extension must be a supported video extension');
  }

  return normalized;
}

function assertContained(storageRoot: string, path: string): void {
  const pathFromRoot = relative(storageRoot, path);

  if (pathFromRoot === '..' || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot)) {
    throw new TypeError('video storage path must remain inside storageRoot');
  }
}

function assertSafeStoragePaths(paths: VideoStoragePaths): void {
  for (const path of [
    paths.videoDirectory,
    paths.inputPath,
    paths.framesDirectory,
    paths.outputPath,
  ]) {
    assertContained(resolve(paths.storageRoot), resolve(path));
  }
}

export function createVideoStoragePaths(
  storageRoot: string,
  userId: string,
  videoId: string,
  extension: string,
): VideoStoragePaths {
  if (storageRoot.trim().length === 0 || storageRoot.includes('\0')) {
    throw new TypeError('storageRoot must be a non-empty filesystem path');
  }

  const normalizedRoot = resolve(storageRoot);
  const normalizedUserId = normalizeUuid(userId, 'userId');
  const normalizedVideoId = normalizeUuid(videoId, 'videoId');
  const normalizedExtension = normalizeExtension(extension);
  const videoDirectory = join(normalizedRoot, normalizedUserId, normalizedVideoId);
  const paths: VideoStoragePaths = {
    storageRoot: normalizedRoot,
    videoDirectory,
    inputPath: join(videoDirectory, `input.${normalizedExtension}`),
    framesDirectory: join(videoDirectory, 'frames'),
    outputPath: join(videoDirectory, 'output.zip'),
  };

  for (const path of [
    paths.videoDirectory,
    paths.inputPath,
    paths.framesDirectory,
    paths.outputPath,
  ]) {
    assertContained(normalizedRoot, path);
  }

  return paths;
}

export async function prepareVideoProcessingAttempt(
  paths: VideoStoragePaths,
  fileSystem: VideoStorageFileSystem = defaultFileSystem,
): Promise<void> {
  assertSafeStoragePaths(paths);
  await fileSystem.makeDirectory(paths.videoDirectory);
  await fileSystem.remove(paths.framesDirectory, { recursive: true, force: true });
  await fileSystem.makeDirectory(paths.framesDirectory);
}

export async function cleanupVideoProcessingAttempt(
  paths: VideoStoragePaths,
  succeeded: boolean,
  fileSystem: VideoStorageFileSystem = defaultFileSystem,
): Promise<void> {
  assertSafeStoragePaths(paths);
  await fileSystem.remove(paths.framesDirectory, { recursive: true, force: true });

  if (succeeded) {
    await fileSystem.remove(paths.inputPath, { recursive: false, force: true });
  }
}
