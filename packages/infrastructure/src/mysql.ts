import { createPool, type Pool, type PoolConnection } from 'mysql2/promise';

import type { MySqlConfig } from './config.js';

export type MySqlPool = Pool;

export function createMySqlPool(config: MySqlConfig): MySqlPool {
  const commonOptions = {
    host: config.host,
    port: config.port,
    user: config.username,
    password: config.password,
    database: config.database,
    connectionLimit: config.connectionLimit,
    waitForConnections: true,
    enableKeepAlive: true,
    timezone: 'Z',
    supportBigNumbers: true,
    bigNumberStrings: true,
  } as const;

  return createPool(config.ssl ? { ...commonOptions, ssl: {} } : commonOptions);
}

export async function withMySqlTransaction<TResult>(
  pool: MySqlPool,
  operation: (connection: PoolConnection) => Promise<TResult>,
): Promise<TResult> {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    const result = await operation(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
