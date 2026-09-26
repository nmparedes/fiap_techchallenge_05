import { describe, expect, it, jest } from '@jest/globals';

import {
  MigrationIntegrityError,
  createSqlMigration,
  loadDatabaseMigrations,
  runDatabaseMigrations,
  type MigrationConnection,
  type MigrationFileSystem,
} from './migration-runner.js';

function createConnection(
  history: readonly { version: string; checksum: string }[] = [],
  lockAcquired = true,
) {
  const query = jest.fn<MigrationConnection['query']>(async (sql) => {
    if (sql.includes('GET_LOCK')) {
      return [[{ acquired: lockAcquired ? 1 : 0 }], []];
    }
    if (sql.includes('SELECT version, checksum')) {
      return [history, []];
    }
    return [[], []];
  });

  return { connection: { query }, query };
}

describe('MySQL migration runner', () => {
  it('parses versioned filenames and computes stable checksums', () => {
    const first = createSqlMigration('auth_db', '0001_create_users.sql', 'SELECT 1');
    const second = createSqlMigration('auth_db', '0001_create_users.sql', 'SELECT 1');

    expect(first).toMatchObject({
      database: 'auth_db',
      version: '0001',
      name: 'create_users',
      sql: 'SELECT 1',
    });
    expect(first.checksum).toHaveLength(64);
    expect(first.checksum).toBe(second.checksum);
    expect(() => createSqlMigration('auth_db', 'create-users.sql', 'SELECT 1')).toThrow(
      MigrationIntegrityError,
    );
  });

  it('loads SQL files in version order and ignores non-SQL files', async () => {
    const fileSystem: MigrationFileSystem = {
      listFiles: jest
        .fn<MigrationFileSystem['listFiles']>()
        .mockResolvedValue(['notes.md', '0002_second.sql', '0001_first.sql']),
      readTextFile: jest.fn<MigrationFileSystem['readTextFile']>(async (path) => `-- ${path}`),
    };

    const migrations = await loadDatabaseMigrations('/migrations', 'video_db', fileSystem);

    expect(migrations.map(({ version }) => version)).toEqual(['0001', '0002']);
    expect(fileSystem.readTextFile).toHaveBeenCalledWith(
      expect.stringContaining('video_db/0001_first.sql'),
    );
  });

  it('rejects duplicate versions in one database', async () => {
    const fileSystem: MigrationFileSystem = {
      listFiles: jest
        .fn<MigrationFileSystem['listFiles']>()
        .mockResolvedValue(['0001_first.sql', '0001_duplicate.sql']),
      readTextFile: jest.fn<MigrationFileSystem['readTextFile']>().mockResolvedValue('SELECT 1'),
    };

    await expect(loadDatabaseMigrations('/migrations', 'auth_db', fileSystem)).rejects.toThrow(
      'Duplicate migration version 0001 for auth_db',
    );
  });

  it('applies pending migrations, skips recorded ones, and releases its lock', async () => {
    const first = createSqlMigration('video_db', '0001_first.sql', 'SELECT 1');
    const second = createSqlMigration('video_db', '0002_second.sql', 'SELECT 2');
    const { connection, query } = createConnection([
      { version: first.version, checksum: first.checksum },
    ]);

    await expect(runDatabaseMigrations(connection, 'video_db', [first, second])).resolves.toEqual({
      applied: ['0002'],
      skipped: ['0001'],
    });
    expect(query).toHaveBeenCalledWith('SELECT 2');
    expect(query).toHaveBeenCalledWith(
      'INSERT INTO schema_migrations (version, name, checksum) VALUES (?, ?, ?)',
      ['0002', 'second', second.checksum],
    );
    expect(query).toHaveBeenLastCalledWith('SELECT RELEASE_LOCK(?)', ['fiapx:migrations:video_db']);
  });

  it('rejects changed or incorrectly targeted migrations and still releases the lock', async () => {
    const changed = createSqlMigration('auth_db', '0001_users.sql', 'SELECT 1');
    const firstConnection = createConnection([{ version: '0001', checksum: 'old-checksum' }]);

    await expect(
      runDatabaseMigrations(firstConnection.connection, 'auth_db', [changed]),
    ).rejects.toThrow('Applied migration auth_db/0001 has changed');
    expect(firstConnection.query).toHaveBeenLastCalledWith('SELECT RELEASE_LOCK(?)', [
      'fiapx:migrations:auth_db',
    ]);

    const wrongDatabase = createSqlMigration('video_db', '0001_videos.sql', 'SELECT 1');
    const secondConnection = createConnection();
    await expect(
      runDatabaseMigrations(secondConnection.connection, 'auth_db', [wrongDatabase]),
    ).rejects.toThrow('targets video_db, not auth_db');
  });

  it('stops when the database lock cannot be acquired', async () => {
    const { connection, query } = createConnection([], false);

    await expect(runDatabaseMigrations(connection, 'notification_db', [])).rejects.toThrow(
      'Could not acquire the migration lock for notification_db',
    );
    expect(query).not.toHaveBeenCalledWith('SELECT RELEASE_LOCK(?)', expect.anything());
  });

  it('rejects malformed MySQL results', async () => {
    const query = jest.fn<MigrationConnection['query']>().mockResolvedValue([{}, []]);

    await expect(runDatabaseMigrations({ query }, 'auth_db', [])).rejects.toThrow(
      'MySQL returned an unexpected migration result',
    );
  });
});
