import { createConnection, type ConnectionOptions } from 'mysql2/promise';

import type { MySqlServerConfig } from '../config.js';
import type { MigrationConnection } from '../mysql/migration-runner.js';

export interface ManagedMigrationConnection extends MigrationConnection {
  end(): Promise<void>;
}

export async function createManagedMigrationConnection(
  config: MySqlServerConfig,
  database?: string,
): Promise<ManagedMigrationConnection> {
  const commonOptions = {
    host: config.host,
    port: config.port,
    user: config.username,
    password: config.password,
    multipleStatements: true,
    timezone: 'Z',
    supportBigNumbers: true,
    bigNumberStrings: true,
  } satisfies ConnectionOptions;
  const connection = await createConnection(
    database === undefined
      ? config.ssl
        ? { ...commonOptions, ssl: {} }
        : commonOptions
      : config.ssl
        ? { ...commonOptions, database, ssl: {} }
        : { ...commonOptions, database },
  );

  return connection as unknown as ManagedMigrationConnection;
}
