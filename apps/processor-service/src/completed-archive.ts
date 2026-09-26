import type { Stats } from 'node:fs';
import { stat } from 'node:fs/promises';
import { relative, sep } from 'node:path';

import { createVideoStoragePaths } from '@fiap-x/infrastructure';

export interface CompletedArchiveInput {
  storageRoot: string;
  userId: string;
  videoId: string;
  extension: string;
}

export interface CompletedArchiveLookup {
  find(input: CompletedArchiveInput): Promise<string | null>;
}

export type ReadFileStats = (path: string) => Promise<Stats>;

function isMissingFileError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

export class LocalCompletedArchiveLookup implements CompletedArchiveLookup {
  public constructor(private readonly readStats: ReadFileStats = stat) {}

  public async find(input: CompletedArchiveInput): Promise<string | null> {
    const paths = createVideoStoragePaths(
      input.storageRoot,
      input.userId,
      input.videoId,
      input.extension,
    );

    try {
      const file = await this.readStats(paths.outputPath);
      if (!file.isFile() || file.size === 0) {
        return null;
      }
      return relative(paths.storageRoot, paths.outputPath).split(sep).join('/');
    } catch (error) {
      if (isMissingFileError(error)) {
        return null;
      }
      throw error;
    }
  }
}
