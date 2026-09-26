import { describe, expect, it, jest } from '@jest/globals';

import { StoredZipCreator, type ZipFileSystem } from './zip.js';

describe('StoredZipCreator', () => {
  it('removes the partial archive when finalization fails', async () => {
    const fileSystem: ZipFileSystem = {
      read: jest.fn(async () => Buffer.from('frame')),
      write: jest.fn(async () => undefined),
      rename: jest.fn(async () => {
        throw new Error('disk failure');
      }),
      remove: jest.fn(async () => undefined),
    };
    const creator = new StoredZipCreator(fileSystem);

    await expect(creator.create(['/frames/frame-000001.png'], '/video/output.zip')).rejects.toThrow(
      'disk failure',
    );

    expect(fileSystem.write).toHaveBeenCalledWith('/video/output.zip.partial', expect.any(Buffer));
    expect(fileSystem.remove).toHaveBeenNthCalledWith(1, '/video/output.zip.partial');
    expect(fileSystem.remove).toHaveBeenNthCalledWith(2, '/video/output.zip.partial');
  });
});
