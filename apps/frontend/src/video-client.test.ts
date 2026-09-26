import { describe, expect, jest, test } from '@jest/globals';

import { HttpClient } from './http-client.js';
import { VideoClient, type VideoView } from './video-client.js';

export const completedVideo: VideoView = {
  id: 'ea96e9e8-dc42-4439-9ff1-e1951cab91dc',
  originalName: 'aula.mp4',
  extension: 'mp4',
  sizeBytes: '1024',
  fps: 1,
  status: 'COMPLETED',
  attempt: 1,
  errorCode: null,
  errorMessage: null,
  downloadAvailable: true,
  processingStartedAt: '2026-09-13T12:00:00.000Z',
  completedAt: '2026-09-13T12:01:00.000Z',
  createdAt: '2026-09-13T12:00:00.000Z',
  updatedAt: '2026-09-13T12:01:00.000Z',
};

function jsonResponse(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: jest.fn<() => Promise<string>>().mockResolvedValue(JSON.stringify(body)),
  } as unknown as Response;
}

function clientWith(fetchImplementation: typeof fetch): VideoClient {
  return new VideoClient(
    new HttpClient({
      baseUrl: 'http://localhost:3002',
      timeoutMs: 100,
      fetchImplementation,
    }),
  );
}

describe('Video client', () => {
  test('uploads multipart fields with only the Bearer identity', async () => {
    const fetchImplementation = jest.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(202, {
        success: true,
        data: { id: completedVideo.id, status: 'QUEUED', attempt: 1 },
      }),
    );
    const client = clientWith(fetchImplementation);
    const file = new File(['video'], 'sample.mp4', { type: 'video/mp4' });

    await expect(client.upload(file, 3, 'private-token')).resolves.toMatchObject({
      status: 'QUEUED',
    });

    const [url, init] = fetchImplementation.mock.calls[0] ?? [];
    const body = init?.body as FormData;
    const headers = new Headers(init?.headers);
    expect(url).toBe('http://localhost:3002/videos');
    expect(init?.method).toBe('POST');
    expect(body.get('video')).toBe(file);
    expect(body.get('fps')).toBe('3');
    expect(body.has('userId')).toBe(false);
    expect(headers.get('Authorization')).toBe('Bearer private-token');
    expect(headers.has('Content-Type')).toBe(false);
  });

  test('lists videos without sending a client-selected user', async () => {
    const fetchImplementation = jest.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(200, {
        success: true,
        data: { items: [completedVideo], page: 1, pageSize: 20, total: 1, totalPages: 1 },
      }),
    );

    await expect(clientWith(fetchImplementation).list('private-token')).resolves.toMatchObject({
      items: [completedVideo],
    });

    const [url, init] = fetchImplementation.mock.calls[0] ?? [];
    expect(url).toBe('http://localhost:3002/videos?page=1&pageSize=20');
    expect(String(url)).not.toContain('userId');
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer private-token');
  });

  test('treats HTTP 200 with success false as a processing failure', async () => {
    const failedVideo: VideoView = {
      ...completedVideo,
      status: 'FAILED',
      downloadAvailable: false,
      errorCode: 'FFMPEG_ERROR',
      errorMessage: 'FFmpeg não conseguiu processar o vídeo',
    };
    const fetchImplementation = jest.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(200, {
        success: false,
        data: failedVideo,
        error: { code: 'FFMPEG_ERROR', message: 'Falha funcional no FFmpeg' },
      }),
    );

    await expect(clientWith(fetchImplementation).status(failedVideo.id, 'token')).resolves.toEqual({
      video: failedVideo,
      processingFailure: 'Falha funcional no FFmpeg',
    });
  });

  test('uses the documented retry and authenticated download routes', async () => {
    const archive = new Blob(['zip'], { type: 'application/zip' });
    const fetchImplementation = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(202, {
          success: true,
          data: { id: completedVideo.id, status: 'QUEUED', attempt: 2 },
        }),
      )
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        blob: jest.fn<() => Promise<Blob>>().mockResolvedValue(archive),
        headers: new Headers({
          'content-disposition': `attachment; filename="frames-${completedVideo.id}.zip"`,
        }),
      } as unknown as Response);
    const client = clientWith(fetchImplementation);

    await expect(client.retry(completedVideo.id, 'token')).resolves.toMatchObject({ attempt: 2 });
    await expect(client.download(completedVideo.id, 'token')).resolves.toEqual({
      data: archive,
      filename: `frames-${completedVideo.id}.zip`,
    });

    expect(fetchImplementation.mock.calls[0]?.[0]).toBe(
      `http://localhost:3002/videos/${completedVideo.id}/retry`,
    );
    expect(fetchImplementation.mock.calls[1]?.[0]).toBe(
      `http://localhost:3002/videos/${completedVideo.id}/download`,
    );
  });

  test.each([
    [400, 'Verifique os dados enviados.'],
    [500, 'O serviço de vídeos está indisponível.'],
  ])('maps HTTP %s to a short upload error', async (status, message) => {
    const fetchImplementation = jest
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(status, { success: false }));

    await expect(
      clientWith(fetchImplementation).upload(new File(['x'], 'sample.mp4'), 1, 'token'),
    ).rejects.toMatchObject({ status, message });
  });
});
