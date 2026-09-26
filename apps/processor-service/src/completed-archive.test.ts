import type { Stats } from 'node:fs';

import { describe, expect, it, jest } from '@jest/globals';

import { LocalCompletedArchiveLookup, type ReadFileStats } from './completed-archive.js';

const input = {
  storageRoot: '/storage',
  userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  videoId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  extension: 'mp4',
};

function fileStats(isFile: boolean, size: number): Stats {
  return { isFile: () => isFile, size } as unknown as Stats;
}

describe('LocalCompletedArchiveLookup', () => {
  it('returns the expected object key only for a non-empty file', async () => {
    const readStats = jest.fn<ReadFileStats>(async () => fileStats(true, 42));
    const lookup = new LocalCompletedArchiveLookup(readStats);

    await expect(lookup.find(input)).resolves.toBe(`${input.userId}/${input.videoId}/output.zip`);
    expect(readStats).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`${input.userId}/${input.videoId}/output\\.zip$`)),
    );
  });

  it.each([
    ['an empty file', fileStats(true, 0)],
    ['a directory', fileStats(false, 42)],
  ])('does not reuse %s', async (_case, stats) => {
    const lookup = new LocalCompletedArchiveLookup(jest.fn<ReadFileStats>(async () => stats));

    await expect(lookup.find(input)).resolves.toBeNull();
  });

  it('treats a missing archive as not completed', async () => {
    const lookup = new LocalCompletedArchiveLookup(
      jest.fn<ReadFileStats>(async () => {
        throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      }),
    );

    await expect(lookup.find(input)).resolves.toBeNull();
  });

  it('propagates storage failures for broker redelivery', async () => {
    const failure = Object.assign(new Error('storage unavailable'), { code: 'EACCES' });
    const lookup = new LocalCompletedArchiveLookup(
      jest.fn<ReadFileStats>(async () => {
        throw failure;
      }),
    );

    await expect(lookup.find(input)).rejects.toBe(failure);
  });
});
