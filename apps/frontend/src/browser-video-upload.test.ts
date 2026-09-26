import { describe, expect, jest, test } from '@jest/globals';

import { createBrowserVideoUploadGateway } from './browser-video-upload.js';

function jsonResponse(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: jest.fn<() => Promise<unknown>>().mockResolvedValue(body),
  } as unknown as Response;
}

describe('browser video upload gateway', () => {
  test('posts multipart data directly to the same-origin video route', async () => {
    const fetchImplementation = jest.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(202, {
        success: true,
        data: { id: 'video-id', status: 'QUEUED', attempt: 1 },
      }),
    );
    const gateway = createBrowserVideoUploadGateway({
      fetchImplementation,
      origin: 'http://fiap-x.local',
    });
    const file = new File(['video'], 'aula.mp4', { type: 'video/mp4' });

    await expect(gateway.upload(file, 3, 'token')).resolves.toBeUndefined();

    const [url, init] = fetchImplementation.mock.calls[0] ?? [];
    const body = init?.body as FormData;
    expect(String(url)).toBe('http://fiap-x.local/videos');
    expect(init?.method).toBe('POST');
    expect(body.get('video')).toBe(file);
    expect(body.get('fps')).toBe('3');
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer token');
    expect(new Headers(init?.headers).has('Content-Type')).toBe(false);
  });

  test('reports a service error when the direct request is unavailable', async () => {
    const gateway = createBrowserVideoUploadGateway({
      fetchImplementation: jest.fn<typeof fetch>().mockRejectedValue(new Error('offline')),
      origin: 'http://fiap-x.local',
    });

    await expect(gateway.upload(new File(['video'], 'aula.mp4'), 1, 'token')).rejects.toMatchObject(
      {
        status: null,
        message: 'O serviço de vídeos está indisponível.',
      },
    );
  });
});
