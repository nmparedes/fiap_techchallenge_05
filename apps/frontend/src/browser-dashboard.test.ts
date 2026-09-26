import { describe, expect, jest, test } from '@jest/globals';

import { createBrowserDashboardGateway } from './browser-dashboard.js';

function response(body: unknown): Response {
  return {
    status: 200,
    ok: true,
    json: jest.fn<() => Promise<unknown>>().mockResolvedValue(body),
  } as unknown as Response;
}

describe('browser dashboard gateway', () => {
  test('loads videos and notifications with native same-origin requests', async () => {
    const fetchImplementation = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response({
          success: true,
          data: { items: [], page: 1, pageSize: 20, total: 0, totalPages: 0 },
        }),
      )
      .mockResolvedValueOnce(
        response({ success: true, data: { items: [], page: 1, pageSize: 20, total: 0, totalPages: 0 } }),
      );
    const gateway = createBrowserDashboardGateway({
      fetchImplementation,
      origin: 'http://fiap-x.local',
    });

    await expect(gateway.load('token')).resolves.toEqual({ videos: [], notifications: [] });

    expect(fetchImplementation.mock.calls.map(([url]) => String(url))).toEqual([
      'http://fiap-x.local/videos?page=1&pageSize=20',
      'http://fiap-x.local/notifications?page=1&pageSize=20',
    ]);
    for (const [, init] of fetchImplementation.mock.calls) {
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer token');
    }
  });

  test('keeps rendering videos when notifications are temporarily unavailable', async () => {
    const video = {
      id: 'video-id',
      originalName: 'aula.mp4',
      extension: 'mp4',
      sizeBytes: '1024',
      fps: 1,
      status: 'QUEUED',
      attempt: 1,
      errorCode: null,
      errorMessage: null,
      downloadAvailable: false,
      processingStartedAt: null,
      completedAt: null,
      createdAt: '2026-09-23T14:00:00.000Z',
      updatedAt: '2026-09-23T14:00:00.000Z',
    };
    const gateway = createBrowserDashboardGateway({
      fetchImplementation: jest
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          response({
            success: true,
            data: { items: [video], page: 1, pageSize: 20, total: 1, totalPages: 1 },
          }),
        )
        .mockResolvedValueOnce({ status: 500, ok: false } as Response),
      origin: 'http://fiap-x.local',
    });

    await expect(gateway.load('token')).resolves.toEqual({ videos: [video], notifications: [] });
  });

  test('deletes a queued video through the same-origin API', async () => {
    const fetchImplementation = jest
      .fn<typeof fetch>()
      .mockResolvedValue({ status: 204, ok: true } as Response);
    const gateway = createBrowserDashboardGateway({
      fetchImplementation,
      origin: 'http://fiap-x.local',
    });

    await expect(gateway.removeFromQueue('video-id', 'token')).resolves.toBeUndefined();

    const [url, init] = fetchImplementation.mock.calls[0] ?? [];
    expect(String(url)).toBe('http://fiap-x.local/videos/video-id');
    expect(init?.method).toBe('DELETE');
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer token');
  });
});
