import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';

const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const UTF8_FLAG = 0x0800;
const ZIP_VERSION = 20;
const DOS_DATE_1980_01_01 = 0x0021;

export interface ZipCreator {
  create(framePaths: readonly string[], outputPath: string): Promise<void>;
}

export interface ZipFileSystem {
  read(path: string): Promise<Buffer>;
  write(path: string, content: Buffer): Promise<void>;
  rename(source: string, destination: string): Promise<void>;
  remove(path: string): Promise<void>;
}

const defaultFileSystem: ZipFileSystem = {
  read: readFile,
  write: writeFile,
  rename,
  remove: async (path) => {
    await rm(path, { force: true });
  },
};

interface ZipEntry {
  name: Buffer;
  content: Buffer;
  checksum: number;
  offset: number;
}

function crc32(content: Buffer): number {
  let checksum = 0xffffffff;

  for (const byte of content) {
    checksum ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      checksum = (checksum >>> 1) ^ (checksum & 1 ? 0xedb88320 : 0);
    }
  }

  return (checksum ^ 0xffffffff) >>> 0;
}

function localFileRecord(entry: ZipEntry): Buffer {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(LOCAL_FILE_HEADER_SIGNATURE, 0);
  header.writeUInt16LE(ZIP_VERSION, 4);
  header.writeUInt16LE(UTF8_FLAG, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(DOS_DATE_1980_01_01, 12);
  header.writeUInt32LE(entry.checksum, 14);
  header.writeUInt32LE(entry.content.length, 18);
  header.writeUInt32LE(entry.content.length, 22);
  header.writeUInt16LE(entry.name.length, 26);
  header.writeUInt16LE(0, 28);
  return Buffer.concat([header, entry.name, entry.content]);
}

function centralDirectoryRecord(entry: ZipEntry): Buffer {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(CENTRAL_DIRECTORY_SIGNATURE, 0);
  header.writeUInt16LE(ZIP_VERSION, 4);
  header.writeUInt16LE(ZIP_VERSION, 6);
  header.writeUInt16LE(UTF8_FLAG, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt16LE(DOS_DATE_1980_01_01, 14);
  header.writeUInt32LE(entry.checksum, 16);
  header.writeUInt32LE(entry.content.length, 20);
  header.writeUInt32LE(entry.content.length, 24);
  header.writeUInt16LE(entry.name.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(entry.offset, 42);
  return Buffer.concat([header, entry.name]);
}

function buildArchive(files: readonly { name: string; content: Buffer }[]): Buffer {
  if (files.length > 0xffff) {
    throw new RangeError('ZIP entry limit exceeded');
  }

  const entries: ZipEntry[] = [];
  const localRecords: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    if (file.content.length > 0xffffffff) {
      throw new RangeError('ZIP entry size limit exceeded');
    }

    const entry: ZipEntry = {
      name: Buffer.from(file.name, 'utf8'),
      content: file.content,
      checksum: crc32(file.content),
      offset,
    };
    const record = localFileRecord(entry);
    entries.push(entry);
    localRecords.push(record);
    offset += record.length;
  }

  const centralDirectory = entries.map(centralDirectoryRecord);
  const centralDirectorySize = centralDirectory.reduce((size, record) => size + record.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_OF_CENTRAL_DIRECTORY_SIGNATURE, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectorySize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localRecords, ...centralDirectory, end]);
}

export class StoredZipCreator implements ZipCreator {
  public constructor(private readonly fileSystem: ZipFileSystem = defaultFileSystem) {}

  public async create(framePaths: readonly string[], outputPath: string): Promise<void> {
    const partialPath = `${outputPath}.partial`;
    await this.fileSystem.remove(partialPath);

    try {
      const files = await Promise.all(
        framePaths.map(async (path) => ({
          name: basename(path),
          content: await this.fileSystem.read(path),
        })),
      );
      await this.fileSystem.write(partialPath, buildArchive(files));
      await this.fileSystem.rename(partialPath, outputPath);
    } catch (error) {
      await this.fileSystem.remove(partialPath);
      throw error;
    }
  }
}
