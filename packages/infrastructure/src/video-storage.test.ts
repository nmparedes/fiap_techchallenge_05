import { describe, expect, it, jest } from '@jest/globals';

import {
  cleanupVideoProcessingAttempt,
  createVideoStoragePaths,
  prepareVideoProcessingAttempt,
  type VideoStorageFileSystem,
  type VideoStoragePaths,
} from './video-storage.js';

const userId = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA';
const normalizedUserId = userId.toLowerCase();
const videoId = 'BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB';
const normalizedVideoId = videoId.toLowerCase();

function createFileSystem() {
  return {
    makeDirectory: jest.fn<VideoStorageFileSystem['makeDirectory']>().mockResolvedValue(undefined),
    remove: jest.fn<VideoStorageFileSystem['remove']>().mockResolvedValue(undefined),
  };
}

describe('video shared storage paths', () => {
  it('normalizes the root, UUIDs, and extension into the required layout', () => {
    expect(
      createVideoStoragePaths('/srv/fiap-x/../fiap-x/storage', userId, videoId, '.MP4'),
    ).toEqual({
      storageRoot: '/srv/fiap-x/storage',
      videoDirectory: `/srv/fiap-x/storage/${normalizedUserId}/${normalizedVideoId}`,
      inputPath: `/srv/fiap-x/storage/${normalizedUserId}/${normalizedVideoId}/input.mp4`,
      framesDirectory: `/srv/fiap-x/storage/${normalizedUserId}/${normalizedVideoId}/frames`,
      outputPath: `/srv/fiap-x/storage/${normalizedUserId}/${normalizedVideoId}/output.zip`,
    });
  });

  it.each([
    ['user traversal', '../../etc/passwd', videoId, 'mp4'],
    ['video traversal', userId, `${videoId}/../../other`, 'mp4'],
    ['extension traversal', userId, videoId, 'mp4/../../secret'],
    ['unsupported extension', userId, videoId, 'zip'],
  ])('rejects %s', (_case, candidateUserId, candidateVideoId, extension) => {
    expect(() =>
      createVideoStoragePaths('/srv/fiap-x/storage', candidateUserId, candidateVideoId, extension),
    ).toThrow(TypeError);
  });

  it.each(['', '   ', 'bad\0root'])('rejects the invalid storage root %j', (storageRoot) => {
    expect(() => createVideoStoragePaths(storageRoot, userId, videoId, 'mp4')).toThrow(
      'storageRoot must be a non-empty filesystem path',
    );
  });

  it('clears leftovers and creates a fresh frames directory before an attempt', async () => {
    const paths = createVideoStoragePaths('/srv/fiap-x/storage', userId, videoId, 'mp4');
    const fileSystem = createFileSystem();

    await prepareVideoProcessingAttempt(paths, fileSystem);

    expect(fileSystem.makeDirectory).toHaveBeenNthCalledWith(1, paths.videoDirectory);
    expect(fileSystem.remove).toHaveBeenCalledWith(paths.framesDirectory, {
      recursive: true,
      force: true,
    });
    expect(fileSystem.makeDirectory).toHaveBeenNthCalledWith(2, paths.framesDirectory);
    expect(fileSystem.remove.mock.invocationCallOrder[0]).toBeGreaterThan(
      fileSystem.makeDirectory.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('removes temporary frames but preserves input after a failed attempt', async () => {
    const paths = createVideoStoragePaths('/srv/fiap-x/storage', userId, videoId, 'mkv');
    const fileSystem = createFileSystem();

    await cleanupVideoProcessingAttempt(paths, false, fileSystem);

    expect(fileSystem.remove).toHaveBeenCalledTimes(1);
    expect(fileSystem.remove).toHaveBeenCalledWith(paths.framesDirectory, {
      recursive: true,
      force: true,
    });
  });

  it('removes input only after a successful attempt', async () => {
    const paths = createVideoStoragePaths('/srv/fiap-x/storage', userId, videoId, 'webm');
    const fileSystem = createFileSystem();

    await cleanupVideoProcessingAttempt(paths, true, fileSystem);

    expect(fileSystem.remove).toHaveBeenNthCalledWith(1, paths.framesDirectory, {
      recursive: true,
      force: true,
    });
    expect(fileSystem.remove).toHaveBeenNthCalledWith(2, paths.inputPath, {
      recursive: false,
      force: true,
    });
  });

  it('revalidates paths before any destructive filesystem operation', async () => {
    const paths = {
      ...createVideoStoragePaths('/srv/fiap-x/storage', userId, videoId, 'mp4'),
      framesDirectory: '/etc',
    } satisfies VideoStoragePaths;
    const fileSystem = createFileSystem();

    await expect(cleanupVideoProcessingAttempt(paths, false, fileSystem)).rejects.toThrow(
      'video storage path must remain inside storageRoot',
    );
    expect(fileSystem.remove).not.toHaveBeenCalled();
  });
});
