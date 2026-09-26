import { describe, expect, it, jest } from '@jest/globals';
import type { Pool, PoolConnection } from 'mysql2/promise';

import { createMySqlPool, withMySqlTransaction } from './mysql.js';

const baseConfig = {
  host: 'localhost',
  port: 3306,
  username: 'service',
  password: 'secret',
  database: 'video_db',
  connectionLimit: 5,
  ssl: false,
} as const;

function createConnectionMock() {
  return {
    beginTransaction: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    commit: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    rollback: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    release: jest.fn<() => void>(),
  };
}

describe('MySQL infrastructure', () => {
  it.each([false, true])('creates a lazy pool with SSL set to %s', async (ssl) => {
    const pool = createMySqlPool({ ...baseConfig, ssl });

    expect(pool).toBeDefined();
    await pool.end();
  });

  it('commits and releases successful transactions', async () => {
    const connection = createConnectionMock();
    const pool = {
      getConnection: jest
        .fn<() => Promise<PoolConnection>>()
        .mockResolvedValue(connection as unknown as PoolConnection),
    } as unknown as Pool;

    await expect(
      withMySqlTransaction(pool, async (transaction) => {
        expect(transaction).toBe(connection);
        return 'saved';
      }),
    ).resolves.toBe('saved');

    expect(connection.beginTransaction).toHaveBeenCalledTimes(1);
    expect(connection.commit).toHaveBeenCalledTimes(1);
    expect(connection.rollback).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalledTimes(1);
  });

  it('rolls back, releases, and preserves transaction errors', async () => {
    const connection = createConnectionMock();
    const pool = {
      getConnection: jest
        .fn<() => Promise<PoolConnection>>()
        .mockResolvedValue(connection as unknown as PoolConnection),
    } as unknown as Pool;
    const failure = new Error('write failed');

    await expect(
      withMySqlTransaction(pool, () => {
        throw failure;
      }),
    ).rejects.toBe(failure);

    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.release).toHaveBeenCalledTimes(1);
  });
});
