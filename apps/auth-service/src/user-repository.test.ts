import { describe, expect, it, jest } from '@jest/globals';
import type { MySqlPool } from '@fiap-x/infrastructure';

import { MySqlUserRepository, UserRepositoryUnavailableError } from './user-repository.js';

function createPool(rows: unknown[]) {
  const execute = jest.fn<(sql: string, values?: unknown[]) => Promise<[unknown[], unknown[]]>>(
    async () => [rows, []],
  );
  const query = jest.fn<(sql: string) => Promise<[unknown[], unknown[]]>>(async () => [[], []]);

  return {
    pool: { execute, query } as unknown as MySqlPool,
    execute,
    query,
  };
}

describe('MySqlUserRepository', () => {
  it('loads and maps a user by exact username', async () => {
    const { pool, execute } = createPool([
      {
        id: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
        username: 'john.doe',
        display_name: 'John Doe',
        password_hash: '$2b$12$hash',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-02T00:00:00.000Z',
      },
    ]);
    const repository = new MySqlUserRepository(pool);

    await expect(repository.findByUsername('john.doe')).resolves.toMatchObject({
      username: 'john.doe',
      displayName: 'John Doe',
      passwordHash: '$2b$12$hash',
    });
    expect(execute).toHaveBeenCalledWith(expect.stringContaining('WHERE username = ?'), [
      'john.doe',
    ]);
  });

  it('returns null when no user exists', async () => {
    const { pool } = createPool([]);

    await expect(new MySqlUserRepository(pool).findByUsername('missing')).resolves.toBeNull();
  });

  it('checks database connectivity without exposing data', async () => {
    const { pool, query } = createPool([]);

    await expect(new MySqlUserRepository(pool).ping()).resolves.toBeUndefined();
    expect(query).toHaveBeenCalledWith('SELECT 1');
  });

  it('maps query failures to a sanitized repository error', async () => {
    const { pool, execute } = createPool([]);
    execute.mockRejectedValueOnce(new Error('mysql://user:password@host'));

    await expect(new MySqlUserRepository(pool).findByUsername('john.doe')).rejects.toEqual(
      new UserRepositoryUnavailableError(),
    );
  });

  it('maps ping failures to a sanitized repository error', async () => {
    const { pool, query } = createPool([]);
    query.mockRejectedValueOnce(new Error('mysql unavailable'));

    await expect(new MySqlUserRepository(pool).ping()).rejects.toEqual(
      new UserRepositoryUnavailableError(),
    );
  });
});
