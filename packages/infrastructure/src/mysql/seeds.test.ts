import { compare } from 'bcryptjs';
import { describe, expect, it, jest } from '@jest/globals';

import {
  LOCAL_DEMO_USERS,
  seedLocalDemoUsers,
  type PasswordHasher,
  type SeedConnection,
} from './seeds.js';

describe('local MySQL seeds', () => {
  it('hashes and inserts only users that are not already present', async () => {
    const query = jest.fn<SeedConnection['query']>(async (sql, parameters) => {
      if (sql.startsWith('SELECT') && parameters?.[0] === 'john.doe') {
        return [[{ id: LOCAL_DEMO_USERS[0]?.id }], []];
      }
      return [[], []];
    });
    const passwordHasher = jest
      .fn<PasswordHasher>()
      .mockImplementation(async (password) => `hash:${password}`);

    await expect(seedLocalDemoUsers({ query }, passwordHasher)).resolves.toEqual({
      inserted: ['mary.doe'],
      skipped: ['john.doe'],
    });
    expect(passwordHasher).toHaveBeenCalledWith('MaryDoe123!', 12);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT IGNORE INTO users'), [
      '22222222-2222-4222-8222-222222222222',
      'mary.doe',
      'Mary Doe',
      'hash:MaryDoe123!',
    ]);
  });

  it('is idempotent when both demo users already exist', async () => {
    const query = jest.fn<SeedConnection['query']>(async () => [[{ id: 'existing-id' }], []]);
    const passwordHasher = jest.fn<PasswordHasher>();

    await expect(seedLocalDemoUsers({ query }, passwordHasher)).resolves.toEqual({
      inserted: [],
      skipped: ['john.doe', 'mary.doe'],
    });
    expect(passwordHasher).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('uses bcryptjs hashes by default and never inserts plaintext passwords', async () => {
    const insertedParameters: unknown[][] = [];
    const query = jest.fn<SeedConnection['query']>(async (sql, parameters) => {
      if (sql.includes('INSERT IGNORE')) {
        insertedParameters.push([...(parameters ?? [])]);
      }
      return [[], []];
    });

    await seedLocalDemoUsers({ query });

    expect(insertedParameters).toHaveLength(2);
    for (const [index, parameters] of insertedParameters.entries()) {
      const hash = parameters[3];
      const user = LOCAL_DEMO_USERS[index];
      expect(typeof hash).toBe('string');
      expect(hash).not.toBe(user?.password);
      await expect(compare(user?.password ?? '', String(hash))).resolves.toBe(true);
    }
  });
});
