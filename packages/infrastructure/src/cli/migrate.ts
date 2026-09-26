import { resolve } from 'node:path';

import { readFile } from 'node:fs/promises';

import { readMySqlServerConfig } from '../config.js';
import {
  LOGICAL_DATABASES,
  loadDatabaseMigrations,
  runDatabaseMigrations,
} from '../mysql/migration-runner.js';
import { createManagedMigrationConnection } from './mysql-connection.js';

async function migrate(): Promise<void> {
  const config = readMySqlServerConfig();
  const migrationsRoot = resolve(
    process.env['MYSQL_MIGRATIONS_DIRECTORY'] ?? 'infra/mysql/migrations',
  );
  const bootstrapSql = await readFile(resolve(migrationsRoot, '0001_create_databases.sql'), 'utf8');
  const serverConnection = await createManagedMigrationConnection(config);

  try {
    await serverConnection.query(bootstrapSql);
  } finally {
    await serverConnection.end();
  }

  for (const database of LOGICAL_DATABASES) {
    const migrations = await loadDatabaseMigrations(migrationsRoot, database);
    const connection = await createManagedMigrationConnection(config, database);

    try {
      const result = await runDatabaseMigrations(connection, database, migrations);
      console.info(
        `${database}: ${result.applied.length} applied, ${result.skipped.length} already current`,
      );
    } finally {
      await connection.end();
    }
  }
}

await migrate();
