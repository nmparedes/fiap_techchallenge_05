import { describe, expect, jest, test } from '@jest/globals';

import { AuthClient, LoginError } from './auth-client.js';
import { HttpClient } from './http-client.js';

function createResponse(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: jest.fn<() => Promise<string>>().mockResolvedValue(JSON.stringify(body)),
  } as unknown as Response;
}

describe('Auth client', () => {
  test('sends credentials using the documented contract', async () => {
    const fetchImplementation = jest.fn<typeof fetch>().mockResolvedValue(
      createResponse(200, {
        success: true,
        data: {
          accessToken: 'signed-token',
          tokenType: 'Bearer',
          expiresIn: 3600,
          user: {
            id: 'a2a77e68-10fc-44fd-867d-78bf900acf0d',
            username: 'real.user',
            displayName: 'Pessoa Real',
          },
        },
      }),
    );
    const client = new AuthClient(
      new HttpClient({
        baseUrl: 'http://localhost:3001',
        timeoutMs: 100,
        fetchImplementation,
      }),
    );

    await expect(
      client.login({ username: 'real.user', password: 'safe-password' }),
    ).resolves.toEqual(
      expect.objectContaining({ accessToken: 'signed-token', tokenType: 'Bearer' }),
    );

    expect(fetchImplementation).toHaveBeenCalledWith(
      'http://localhost:3001/auth/login',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ username: 'real.user', password: 'safe-password' }),
      }),
    );
  });

  test('maps rejected credentials to a safe login error', async () => {
    const client = new AuthClient(
      new HttpClient({
        baseUrl: 'http://localhost:3001',
        timeoutMs: 100,
        fetchImplementation: jest
          .fn<typeof fetch>()
          .mockResolvedValue(createResponse(401, { success: false })),
      }),
    );

    await expect(client.login({ username: 'unknown', password: 'wrong' })).rejects.toEqual(
      new LoginError('credentials'),
    );
  });

  test('maps network and invalid response failures to an unavailable error', async () => {
    const networkClient = new AuthClient(
      new HttpClient({
        baseUrl: 'http://localhost:3001',
        timeoutMs: 100,
        fetchImplementation: jest.fn<typeof fetch>().mockRejectedValue(new Error('network detail')),
      }),
    );
    const invalidClient = new AuthClient(
      new HttpClient({
        baseUrl: 'http://localhost:3001',
        timeoutMs: 100,
        fetchImplementation: jest
          .fn<typeof fetch>()
          .mockResolvedValue(createResponse(200, { success: true, data: null })),
      }),
    );

    await expect(networkClient.login({ username: 'user', password: 'password' })).rejects.toEqual(
      new LoginError('unavailable'),
    );
    await expect(invalidClient.login({ username: 'user', password: 'password' })).rejects.toEqual(
      new LoginError('unavailable'),
    );
  });
});
