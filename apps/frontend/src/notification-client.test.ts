import { describe, expect, jest, test } from '@jest/globals';

import { HttpClient } from './http-client.js';
import { NotificationClient } from './notification-client.js';

function response(body: unknown): Response {
  return {
    status: 200,
    ok: true,
    text: jest.fn<() => Promise<string>>().mockResolvedValue(JSON.stringify(body)),
  } as unknown as Response;
}

describe('Notification client', () => {
  test('lists internal notifications using only the Bearer identity', async () => {
    const notification = {
      id: '033cb31f-b99a-4d14-ac42-eaa192078227',
      videoId: 'e840d90c-67a1-4401-9cdf-b86fb272cf03',
      attempt: 1,
      errorCode: 'ZIP_ERROR',
      message: 'Não foi possível criar o arquivo ZIP',
      createdAt: '2026-09-13T12:00:00.000Z',
    };
    const fetchImplementation = jest.fn<typeof fetch>().mockResolvedValue(
      response({
        success: true,
        data: { items: [notification], page: 1, pageSize: 20, total: 1, totalPages: 1 },
      }),
    );
    const client = new NotificationClient(
      new HttpClient({
        baseUrl: 'http://localhost:3004',
        timeoutMs: 100,
        fetchImplementation,
      }),
    );

    await expect(client.list('private-token')).resolves.toEqual([notification]);

    const [url, init] = fetchImplementation.mock.calls[0] ?? [];
    expect(url).toBe('http://localhost:3004/notifications?page=1&pageSize=20');
    expect(String(url)).not.toContain('userId');
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer private-token');
  });
});
