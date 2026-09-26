import { afterEach, describe, expect, it } from '@jest/globals';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createVideoStoragePaths } from '@fiap-x/infrastructure';

import { LocalVideoFileStore, VideoFileStoreError } from './video-files.js';

const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const videoId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function temporaryPaths() {
  const root = await mkdtemp(join(tmpdir(), 'fiap-x-video-service-'));
  roots.push(root);
  return createVideoStoragePaths(root, userId, videoId, 'mp4');
}

describe('LocalVideoFileStore', () => {
  it('stores uploads, opens the expected archive, and removes the video directory', async () => {
    const paths = await temporaryPaths();
    const store = new LocalVideoFileStore();
    await store.saveUpload(paths, Buffer.from('video'));
    await expect(store.assertInputAvailable(paths, paths.inputPath)).resolves.toBeUndefined();
    await writeFile(paths.outputPath, Buffer.from('archive'));

    const stream = await store.openArchive(paths, paths.outputPath);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).toString()).toBe('archive');

    const archiveObjectKey = `${userId}/${videoId}/output.zip`;
    const objectKeyStream = await store.openArchive(paths, archiveObjectKey);
    const objectKeyChunks: Buffer[] = [];
    for await (const chunk of objectKeyStream) objectKeyChunks.push(Buffer.from(chunk));
    expect(Buffer.concat(objectKeyChunks).toString()).toBe('archive');

    await expect(store.deleteVideo(paths)).resolves.toBeUndefined();
  });

  it('rejects a database path outside the derived archive location', async () => {
    const paths = await temporaryPaths();
    const store = new LocalVideoFileStore();

    await expect(store.openArchive(paths, '/tmp/other.zip')).rejects.toBeInstanceOf(
      VideoFileStoreError,
    );
    await expect(store.assertInputAvailable(paths, '/tmp/other.mp4')).rejects.toBeInstanceOf(
      VideoFileStoreError,
    );
  });

  it('sanitizes filesystem write and missing archive errors', async () => {
    const paths = await temporaryPaths();
    const store = new LocalVideoFileStore();
    await mkdir(paths.videoDirectory, { recursive: true });
    await writeFile(paths.inputPath, 'existing');

    await expect(store.saveUpload(paths, Buffer.from('again'))).rejects.toBeInstanceOf(
      VideoFileStoreError,
    );
    await expect(store.openArchive(paths, paths.outputPath)).rejects.toBeInstanceOf(
      VideoFileStoreError,
    );
  });

  it('reports a missing retry input as a sanitized storage error', async () => {
    const paths = await temporaryPaths();

    await expect(
      new LocalVideoFileStore().assertInputAvailable(paths, paths.inputPath),
    ).rejects.toEqual(new VideoFileStoreError());
  });
});
