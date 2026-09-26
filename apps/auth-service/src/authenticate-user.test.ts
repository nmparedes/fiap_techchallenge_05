import { describe, expect, it, jest } from '@jest/globals';
import type { UserRecord } from '@fiap-x/infrastructure';

import {
  AuthenticateUser,
  InvalidCredentialsError,
  type PasswordVerifier,
} from './authenticate-user.js';
import type { UserRepository } from './user-repository.js';

const user: UserRecord = {
  id: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
  username: 'john.doe',
  displayName: 'John Doe',
  passwordHash: '$2b$12$stored',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

function repositoryReturning(result: UserRecord | null): UserRepository {
  return {
    findByUsername: jest.fn(async () => result),
    ping: jest.fn(async () => undefined),
  };
}

describe('AuthenticateUser', () => {
  it('returns a user when the password matches', async () => {
    const verifyPassword = jest.fn<PasswordVerifier>(async () => true);
    const authenticate = new AuthenticateUser(repositoryReturning(user), verifyPassword);

    await expect(authenticate.execute('john.doe', 'correct-password')).resolves.toBe(user);
    expect(verifyPassword).toHaveBeenCalledWith('correct-password', user.passwordHash);
  });

  it('rejects an incorrect password with the generic credentials error', async () => {
    const authenticate = new AuthenticateUser(
      repositoryReturning(user),
      jest.fn<PasswordVerifier>(async () => false),
    );

    await expect(authenticate.execute('john.doe', 'wrong-password')).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
  });

  it('still performs a bcrypt-compatible comparison for unknown users', async () => {
    const verifyPassword = jest.fn<PasswordVerifier>(async () => false);
    const authenticate = new AuthenticateUser(repositoryReturning(null), verifyPassword);

    await expect(authenticate.execute('unknown', 'attempt')).rejects.toThrow(
      'Invalid username or password',
    );
    expect(verifyPassword).toHaveBeenCalledTimes(1);
    expect(verifyPassword.mock.calls[0]?.[1]).toMatch(/^\$2b\$12\$/);
  });

  it('does not mask repository failures as credential failures', async () => {
    const failure = new Error('database unavailable');
    const repository: UserRepository = {
      findByUsername: jest.fn(async () => Promise.reject(failure)),
      ping: jest.fn(async () => undefined),
    };
    const authenticate = new AuthenticateUser(
      repository,
      jest.fn<PasswordVerifier>(async () => false),
    );

    await expect(authenticate.execute('john.doe', 'password')).rejects.toBe(failure);
  });
});
