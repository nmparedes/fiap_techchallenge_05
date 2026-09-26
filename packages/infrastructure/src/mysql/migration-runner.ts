import { createHash } from 'node:crypto';
import { join } from 'node:path';

import { readFile, readdir } from 'node:fs/promises';

export const LOGICAL_DATABASES = ['auth_db', 'video_db', 'notification_db'] as const;

export type LogicalDatabase = (typeof LOGICAL_DATABASES)[number];

export interface SqlMigration {
  database: LogicalDatabase;
  version: string;
  name: string;
  checksum: string;
  sql: string;
}

export interface MigrationFileSystem {
  listFiles(directory: string): Promise<readonly string[]>;
  readTextFile(path: string): Promise<string>;
}

export interface MigrationConnection {
  query(sql: string, parameters?: readonly unknown[]): Promise<readonly [unknown, unknown]>;
}

export interface MigrationRunResult {
  applied: readonly string[];
  skipped: readonly string[];
}

interface MigrationHistoryRow {
  version: string;
  checksum: string;
}

interface LockRow {
  acquired: number;
}

const migrationFilePattern = /^(\d{4})_([a-z0-9_]+)\.sql$/;

const defaultFileSystem: MigrationFileSystem = {
  listFiles: (directory) => readdir(directory),
  readTextFile: (path) => readFile(path, 'utf8'),
};

export class MigrationIntegrityError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'MigrationIntegrityError';
  }
}

export function createSqlMigration(
  database: LogicalDatabase,
  fileName: string,
  sql: string,
): SqlMigration {
  const match = migrationFilePattern.exec(fileName);

  if (match === null) {
    throw new MigrationIntegrityError(
      `Invalid migration filename ${fileName}; expected NNNN_lowercase_name.sql`,
    );
  }

  const version = match[1];
  const name = match[2];

  if (version === undefined || name === undefined) {
    throw new MigrationIntegrityError(`Could not parse migration filename ${fileName}`);
  }

  return {
    database,
    version,
    name,
    checksum: createHash('sha256').update(sql).digest('hex'),
    sql,
  };
}

export async function loadDatabaseMigrations(
  migrationsRoot: string,
  database: LogicalDatabase,
  fileSystem: MigrationFileSystem = defaultFileSystem,
): Promise<readonly SqlMigration[]> {
  const databaseDirectory = join(migrationsRoot, database);
  const fileNames = (await fileSystem.listFiles(databaseDirectory))
    .filter((fileName) => fileName.endsWith('.sql'))
    .sort();

  const migrations = await Promise.all(
    fileNames.map(async (fileName) =>
      createSqlMigration(
        database,
        fileName,
        await fileSystem.readTextFile(join(databaseDirectory, fileName)),
      ),
    ),
  );

  const versions = new Set<string>();
  for (const migration of migrations) {
    if (versions.has(migration.version)) {
      throw new MigrationIntegrityError(
        `Duplicate migration version ${migration.version} for ${database}`,
      );
    }
    versions.add(migration.version);
  }

  return migrations;
}

function asRows<TRow>(result: unknown): readonly TRow[] {
  if (!Array.isArray(result)) {
    throw new MigrationIntegrityError('MySQL returned an unexpected migration result');
  }

  return result as readonly TRow[];
}

export async function runDatabaseMigrations(
  connection: MigrationConnection,
  database: LogicalDatabase,
  migrations: readonly SqlMigration[],
): Promise<MigrationRunResult> {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      name VARCHAR(160) NOT NULL,
      checksum CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      applied_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      PRIMARY KEY (version)
    ) ENGINE=InnoDB
  `);

  const lockName = `fiapx:migrations:${database}`;
  const [lockResult] = await connection.query('SELECT GET_LOCK(?, 30) AS acquired', [lockName]);
  const lockRows = asRows<LockRow>(lockResult);

  if (lockRows[0]?.acquired !== 1) {
    throw new MigrationIntegrityError(`Could not acquire the migration lock for ${database}`);
  }

  try {
    const [historyResult] = await connection.query(
      'SELECT version, checksum FROM schema_migrations ORDER BY version',
    );
    const appliedMigrations = new Map(
      asRows<MigrationHistoryRow>(historyResult).map((row) => [row.version, row.checksum]),
    );
    const result: { applied: string[]; skipped: string[] } = { applied: [], skipped: [] };

    for (const migration of migrations) {
      if (migration.database !== database) {
        throw new MigrationIntegrityError(
          `Migration ${migration.version} targets ${migration.database}, not ${database}`,
        );
      }

      const recordedChecksum = appliedMigrations.get(migration.version);
      if (recordedChecksum !== undefined) {
        if (recordedChecksum !== migration.checksum) {
          throw new MigrationIntegrityError(
            `Applied migration ${database}/${migration.version} has changed`,
          );
        }

        result.skipped.push(migration.version);
        continue;
      }

      await connection.query(migration.sql);
      await connection.query(
        'INSERT INTO schema_migrations (version, name, checksum) VALUES (?, ?, ?)',
        [migration.version, migration.name, migration.checksum],
      );
      result.applied.push(migration.version);
    }

    return result;
  } finally {
    await connection.query('SELECT RELEASE_LOCK(?)', [lockName]);
  }
}
