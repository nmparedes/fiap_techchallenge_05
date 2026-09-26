import { afterEach, describe, expect, it, jest } from '@jest/globals';
import type { AuthTokenClaims, VideoView } from '@fiap-x/contracts';
import { createPrometheusRegistry } from '@fiap-x/observability';
import type { FastifyInstance } from 'fastify';
import { Readable } from 'node:stream';

import { buildVideoService, type VideoServiceApi } from './app.js';
import type { ProcessingRequestPublisher } from './processing-publisher.js';
import { VideoFileStoreError } from './video-files.js';
import {
  InvalidVideoUploadError,
  VideoConflictError,
  VideoNotFoundError,
  VideoOperationError,
} from './video-service.js';
import type { VideoRepository } from './video-repository.js';

const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const videoId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const claims: AuthTokenClaims = {
  sub: userId,
  username: 'john.doe',
  iss: 'fiap-x-auth-service',
  aud: 'fiap-x-api',
  iat: 1,
  exp: 4_102_444_800,
};

function view(overrides: Partial<VideoView> = {}): VideoView {
  return {
    id: videoId,
    originalName: 'movie.mp4',
    extension: 'mp4',
    sizeBytes: '5',
    fps: 1,
    status: 'QUEUED',
    attempt: 1,
    errorCode: null,
    errorMessage: null,
    downloadAvailable: false,
    processingStartedAt: null,
    completedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function createFixture() {
  const service: VideoServiceApi = {
    upload: jest.fn(async () => ({ id: videoId, status: 'QUEUED' as const, attempt: 1 })),
    list: jest.fn(async (_userId: string, pagination: { page: number; pageSize: number }) => ({
      items: [view()],
      ...pagination,
      total: 1,
      totalPages: 1,
    })),
    get: jest.fn(async () => view()),
    retry: jest.fn(async () => ({ id: videoId, status: 'QUEUED' as const, attempt: 2 })),
    removeFromQueue: jest.fn(async () => undefined),
    download: jest.fn(async () => Readable.from([Buffer.from('zip')])),
  };
  const repository: VideoRepository = {
    create: jest.fn(async () => undefined),
    delete: jest.fn(async () => undefined),
    deleteQueued: jest.fn(async () => true),
    listByUser: jest.fn(async () => []),
    findByUser: jest.fn(async () => null),
    retryFailed: jest.fn(async () => true),
    restoreFailed: jest.fn(async () => undefined),
    applyStatusEvent: jest.fn(async () => true),
    ping: jest.fn(async () => undefined),
  };
  const publisher: ProcessingRequestPublisher = {
    publish: jest.fn(async () => undefined),
    ping: jest.fn(async () => undefined),
  };
  const verifyToken = jest.fn((token: string) => {
    if (token !== 'valid-token') throw new Error('invalid token');
    return claims;
  });
  return { service, repository, publisher, verifyToken };
}

function multipartVideo(
  filename = 'movie.mp4',
  content: Buffer = Buffer.from('video'),
  fps?: string,
) {
  const boundary = 'fiap-x-test-boundary';
  const file = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="video"; filename="${filename}"\r\n` +
        'Content-Type: application/octet-stream\r\n\r\n',
    ),
    content,
    Buffer.from('\r\n'),
  ]);
  const fpsField =
    fps === undefined
      ? Buffer.alloc(0)
      : Buffer.from(
          `--${boundary}\r\n` + 'Content-Disposition: form-data; name="fps"\r\n\r\n' + `${fps}\r\n`,
        );
  return {
    payload: Buffer.concat([fpsField, file, Buffer.from(`--${boundary}--\r\n`)]),
    headers: {
      authorization: 'Bearer valid-token',
      'content-type': `multipart/form-data; boundary=${boundary}`,
    },
  };
}

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function createApp(fixture = createFixture(), registry = createPrometheusRegistry()) {
  app = await buildVideoService({
    ...fixture,
    maxUploadBytes: 1024,
    registry,
  });
  await app.ready();
  return { server: app, fixture, registry };
}

describe('Video Service HTTP API', () => {
  it('rejects missing and malformed Bearer tokens consistently', async () => {
    const { server, fixture } = await createApp();
    const missing = await server.inject({ method: 'GET', url: '/videos' });
    const malformed = await server.inject({
      method: 'GET',
      url: '/videos',
      headers: { authorization: 'Bearer wrong-token' },
    });
    const protectedDownload = await server.inject({
      method: 'GET',
      url: `/videos/${videoId}/download`,
    });
    const protectedRetry = await server.inject({
      method: 'POST',
      url: `/videos/${videoId}/retry`,
    });
    const protectedDelete = await server.inject({
      method: 'DELETE',
      url: `/videos/${videoId}`,
    });

    expect(missing.statusCode).toBe(401);
    expect(malformed.statusCode).toBe(401);
    expect(malformed.json()).toEqual(missing.json());
    expect(protectedDownload.statusCode).toBe(401);
    expect(protectedRetry.statusCode).toBe(401);
    expect(protectedDelete.statusCode).toBe(401);
    expect(fixture.service.download).not.toHaveBeenCalled();
    expect(fixture.service.retry).not.toHaveBeenCalled();
  });

  it('accepts a valid upload asynchronously and scopes it to token sub', async () => {
    const { server, fixture } = await createApp();
    const content = Buffer.from('video');
    const multipart = multipartVideo('movie.MP4', content, '2');

    const response = await server.inject({
      method: 'POST',
      url: '/videos',
      ...multipart,
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({
      success: true,
      data: { id: videoId, status: 'QUEUED', attempt: 1 },
    });
    expect(fixture.service.upload).toHaveBeenCalledWith({
      userId,
      originalName: 'movie.MP4',
      content,
      fps: 2,
    });
  });

  it('uses FPS 1 when the multipart field is absent', async () => {
    const { server, fixture } = await createApp();
    const response = await server.inject({
      method: 'POST',
      url: '/videos',
      ...multipartVideo(),
    });

    expect(response.statusCode).toBe(202);
    expect(fixture.service.upload).toHaveBeenCalledWith(expect.objectContaining({ fps: 1 }));
  });

  it('returns 400 for invalid multipart uploads and invalid parameters', async () => {
    const fixture = createFixture();
    jest
      .mocked(fixture.service.upload)
      .mockRejectedValueOnce(new InvalidVideoUploadError('unsupported'));
    const { server } = await createApp(fixture);
    const invalidUpload = await server.inject({
      method: 'POST',
      url: '/videos',
      ...multipartVideo('movie.txt'),
    });
    const invalidId = await server.inject({
      method: 'GET',
      url: '/videos/not-a-uuid',
      headers: { authorization: 'Bearer valid-token' },
    });
    const invalidPage = await server.inject({
      method: 'GET',
      url: '/videos?page=0&pageSize=101',
      headers: { authorization: 'Bearer valid-token' },
    });
    const invalidFps = await server.inject({
      method: 'POST',
      url: '/videos',
      ...multipartVideo('movie.mp4', Buffer.from('video'), '11'),
    });
    const oversized = await server.inject({
      method: 'POST',
      url: '/videos',
      ...multipartVideo('movie.mp4', Buffer.alloc(1025)),
    });
    const invalidDownloadId = await server.inject({
      method: 'GET',
      url: '/videos/not-a-uuid/download',
      headers: { authorization: 'Bearer valid-token' },
    });
    const invalidRetryId = await server.inject({
      method: 'POST',
      url: '/videos/not-a-uuid/retry',
      headers: { authorization: 'Bearer valid-token' },
    });

    expect(invalidUpload.statusCode).toBe(400);
    expect(invalidId.statusCode).toBe(400);
    expect(invalidPage.statusCode).toBe(400);
    expect(invalidFps.statusCode).toBe(400);
    expect(oversized.statusCode).toBe(400);
    expect(invalidDownloadId.statusCode).toBe(400);
    expect(invalidRetryId.statusCode).toBe(400);
    const metrics = await server.inject({ method: 'GET', url: '/metrics' });
    expect(metrics.body).toMatch(/fiap_x_video_uploads_total\{outcome="invalid"\} [1-9]/u);
    expect(metrics.body).toContain('fiap_x_video_retries_total{outcome="invalid"} 1');
  });

  it('returns a sanitized 500 when an accepted upload cannot be stored or enqueued', async () => {
    const fixture = createFixture();
    jest.mocked(fixture.service.upload).mockRejectedValueOnce(new VideoOperationError());
    const { server } = await createApp(fixture);

    const response = await server.inject({
      method: 'POST',
      url: '/videos',
      ...multipartVideo(),
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'The video operation failed' },
    });
    const metrics = await server.inject({ method: 'GET', url: '/metrics' });
    expect(metrics.body).toContain('fiap_x_video_uploads_total{outcome="failed"} 1');
  });

  it('lists only the authenticated user catalog', async () => {
    const { server, fixture } = await createApp();
    const response = await server.inject({
      method: 'GET',
      url: '/videos?page=2&pageSize=5',
      headers: { authorization: 'Bearer valid-token' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      items: [expect.objectContaining({ id: videoId })],
      page: 2,
      pageSize: 5,
      total: 1,
      totalPages: 1,
    });
    expect(fixture.service.list).toHaveBeenCalledWith(userId, { page: 2, pageSize: 5 });
  });

  it('reports post-processing failure with HTTP 200, success false, and FAILED status', async () => {
    const fixture = createFixture();
    jest
      .mocked(fixture.service.get)
      .mockResolvedValueOnce(
        view({ status: 'FAILED', errorCode: 'FFMPEG_ERROR', errorMessage: 'FFmpeg failed' }),
      );
    const { server } = await createApp(fixture);

    const response = await server.inject({
      method: 'GET',
      url: `/videos/${videoId}`,
      headers: { authorization: 'Bearer valid-token' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      success: false,
      data: { id: videoId, status: 'FAILED' },
      error: { code: 'FFMPEG_ERROR', message: 'FFmpeg failed' },
    });
  });

  it('removes only the authenticated user queued video', async () => {
    const { server, fixture } = await createApp();
    const response = await server.inject({
      method: 'DELETE',
      url: `/videos/${videoId}`,
      headers: { authorization: 'Bearer valid-token' },
    });

    expect(response.statusCode).toBe(204);
    expect(fixture.service.removeFromQueue).toHaveBeenCalledWith(userId, videoId);
  });

  it('downloads only the owned completed archive', async () => {
    const { server, fixture } = await createApp();
    const response = await server.inject({
      method: 'GET',
      url: `/videos/${videoId}/download`,
      headers: { authorization: 'Bearer valid-token' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('zip');
    expect(response.headers['content-type']).toContain('application/zip');
    expect(response.headers['content-disposition']).toBe(
      `attachment; filename="frames-${videoId}.zip"`,
    );
    expect(fixture.service.download).toHaveBeenCalledWith(userId, videoId);
  });

  it('maps a foreign video to 404 and a missing archive to a sanitized 500', async () => {
    const fixture = createFixture();
    jest.mocked(fixture.service.download).mockRejectedValueOnce(new VideoNotFoundError());
    const { server } = await createApp(fixture);
    const foreign = await server.inject({
      method: 'GET',
      url: `/videos/${videoId}/download`,
      headers: { authorization: 'Bearer valid-token' },
    });

    jest.mocked(fixture.service.download).mockRejectedValueOnce(new VideoFileStoreError());
    const missingArchive = await server.inject({
      method: 'GET',
      url: `/videos/${videoId}/download`,
      headers: { authorization: 'Bearer valid-token' },
    });

    expect(foreign.statusCode).toBe(404);
    expect(missingArchive.statusCode).toBe(500);
    expect(missingArchive.json()).toEqual({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'The video operation failed' },
    });
  });

  it('accepts retry asynchronously and maps domain errors consistently', async () => {
    const fixture = createFixture();
    const { server } = await createApp(fixture);
    const accepted = await server.inject({
      method: 'POST',
      url: `/videos/${videoId}/retry`,
      headers: { authorization: 'Bearer valid-token' },
    });
    expect(accepted.statusCode).toBe(202);

    jest.mocked(fixture.service.retry).mockRejectedValueOnce(new VideoNotFoundError());
    const missing = await server.inject({
      method: 'POST',
      url: `/videos/${videoId}/retry`,
      headers: { authorization: 'Bearer valid-token' },
    });
    jest
      .mocked(fixture.service.retry)
      .mockRejectedValueOnce(new VideoConflictError('Only failed videos can be retried'));
    const conflict = await server.inject({
      method: 'POST',
      url: `/videos/${videoId}/retry`,
      headers: { authorization: 'Bearer valid-token' },
    });
    jest.mocked(fixture.service.retry).mockRejectedValueOnce(new VideoFileStoreError());
    const missingInput = await server.inject({
      method: 'POST',
      url: `/videos/${videoId}/retry`,
      headers: { authorization: 'Bearer valid-token' },
    });

    expect(missing.statusCode).toBe(404);
    expect(conflict.statusCode).toBe(409);
    expect(missingInput.statusCode).toBe(500);
    expect(missingInput.json().error).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'The video operation failed',
    });
    const metrics = await server.inject({ method: 'GET', url: '/metrics' });
    expect(metrics.body).toContain('fiap_x_video_retries_total{outcome="accepted"} 1');
    expect(metrics.body).toContain('fiap_x_video_retries_total{outcome="not_found"} 1');
    expect(metrics.body).toContain('fiap_x_video_retries_total{outcome="conflict"} 1');
    expect(metrics.body).toContain('fiap_x_video_retries_total{outcome="failed"} 1');
  });

  it('keeps health and metrics public and checks only required readiness dependencies', async () => {
    const registry = createPrometheusRegistry();
    const { server, fixture } = await createApp(createFixture(), registry);
    const live = await server.inject({ method: 'GET', url: '/health/live' });
    const ready = await server.inject({ method: 'GET', url: '/health/ready' });
    await server.inject({ method: 'POST', url: '/videos', ...multipartVideo() });
    await server.inject({
      method: 'GET',
      url: '/videos',
      headers: { authorization: 'Bearer valid-token' },
    });
    await server.inject({
      method: 'POST',
      url: `/videos/${videoId}/retry`,
      headers: { authorization: 'Bearer valid-token' },
    });
    const metrics = await server.inject({ method: 'GET', url: '/metrics' });

    expect(live.statusCode).toBe(200);
    expect(ready.statusCode).toBe(200);
    expect(metrics.statusCode).toBe(200);
    expect(metrics.body).toContain(
      'fiap_x_http_requests_total{service="video-service",method="POST",route="/videos",status_code="202"} 1',
    );
    expect(metrics.body).toContain('fiap_x_http_request_duration_seconds');
    expect(metrics.body).toContain('fiap_x_video_status_events_total');
    expect(metrics.body).toContain(
      'fiap_x_video_status_total{operation="transitioned",status="QUEUED"} 2',
    );
    expect(metrics.body).toContain(
      'fiap_x_video_status_total{operation="observed",status="QUEUED"} 1',
    );
    expect(metrics.body).toContain('fiap_x_video_retries_total{outcome="accepted"} 1');
    expect(metrics.body).toContain(
      'fiap_x_readiness{service="video-service",dependency="mysql"} 1',
    );
    expect(metrics.body).toContain(
      'fiap_x_readiness{service="video-service",dependency="rabbitmq"} 1',
    );
    expect(metrics.body).not.toContain(userId);
    expect(metrics.body).not.toContain(videoId);
    expect(metrics.body).not.toContain('movie.mp4');
    expect(metrics.body).not.toContain('valid-token');
    expect(fixture.repository.ping).toHaveBeenCalledTimes(1);
    expect(fixture.publisher.ping).toHaveBeenCalledTimes(1);
  });

  it('returns 503 when a required readiness dependency is unavailable', async () => {
    const fixture = createFixture();
    jest.mocked(fixture.publisher.ping).mockRejectedValueOnce(new Error('RabbitMQ unavailable'));
    const { server } = await createApp(fixture);

    const response = await server.inject({ method: 'GET', url: '/health/ready' });
    const metrics = await server.inject({ method: 'GET', url: '/metrics' });
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe('SERVICE_UNAVAILABLE');
    expect(metrics.body).toContain(
      'fiap_x_readiness{service="video-service",dependency="rabbitmq"} 0',
    );
  });

  it('sanitizes unexpected internal errors', async () => {
    const fixture = createFixture();
    jest.mocked(fixture.service.list).mockRejectedValueOnce(new Error('sensitive storage path'));
    const { server } = await createApp(fixture);

    const response = await server.inject({
      method: 'GET',
      url: '/videos',
      headers: { authorization: 'Bearer valid-token' },
    });
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain('sensitive storage path');
  });

  it('publishes Swagger for every endpoint with Bearer security only on video routes', async () => {
    const { server } = await createApp();
    const document = server.swagger();

    expect(document.paths).toEqual(
      expect.objectContaining({
        '/videos': expect.any(Object),
        '/videos/{id}': expect.any(Object),
        '/videos/{id}/download': expect.any(Object),
        '/videos/{id}/retry': expect.any(Object),
        '/health/live': expect.any(Object),
        '/health/ready': expect.any(Object),
        '/metrics': expect.any(Object),
      }),
    );
    expect(document).toMatchObject({
      security: [{ bearerAuth: [] }],
      paths: {
        '/health/live': { get: { security: [] } },
        '/health/ready': { get: { security: [] } },
        '/metrics': { get: { security: [] } },
      },
    });
    expect(document.paths?.['/videos']?.post).toMatchObject({
      requestBody: {
        content: {
          'multipart/form-data': {
            schema: {
              properties: {
                video: { type: 'string', format: 'binary' },
                fps: { type: 'integer', minimum: 1, maximum: 10, default: 1 },
              },
            },
          },
        },
      },
    });
    expect(document.paths?.['/videos/{id}/download']?.get?.responses).toEqual(
      expect.objectContaining({ '200': expect.any(Object), '400': expect.any(Object) }),
    );
    expect(document.paths?.['/videos/{id}/retry']?.post?.responses).toEqual(
      expect.objectContaining({ '202': expect.any(Object), '400': expect.any(Object) }),
    );
    const docs = await server.inject({ method: 'GET', url: '/docs' });
    expect(docs.statusCode).toBe(200);
  });
});
