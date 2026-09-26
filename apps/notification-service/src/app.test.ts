import { Writable } from 'node:stream';

import { afterEach, describe, expect, it, jest } from '@jest/globals';
import type { AuthTokenClaims } from '@fiap-x/contracts';
import { createJsonLogger, createPrometheusRegistry } from '@fiap-x/observability';
import type { FastifyInstance } from 'fastify';

import { buildNotificationService } from './app.js';
import { createNotificationServiceMetrics } from './metrics.js';
import type { NotificationView } from './notification.js';
import {
  NotificationRepositoryUnavailableError,
  type NotificationReader,
} from './notification-repository.js';
import type { NotificationReadinessChecks } from './readiness.js';

const johnId = '11111111-1111-4111-8111-111111111111';
const maryId = '22222222-2222-4222-8222-222222222222';

function claims(sub: string, username: string): AuthTokenClaims {
  return {
    sub,
    username,
    iss: 'fiap-x-auth-service',
    aud: 'fiap-x-api',
    iat: 1,
    exp: 4_102_444_800,
  };
}

const records: Readonly<Record<string, readonly NotificationView[]>> = {
  [johnId]: [
    {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      videoId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      attempt: 2,
      errorCode: 'ZIP_ERROR',
      message: 'Video processing failed while creating the archive.',
      createdAt: '2026-09-02T12:00:00.000Z',
    },
    {
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      videoId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      attempt: 1,
      errorCode: 'FFMPEG_ERROR',
      message: 'Video processing failed while extracting frames.',
      createdAt: '2026-09-01T12:00:00.000Z',
    },
  ],
  [maryId]: [
    {
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      videoId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      attempt: 1,
      errorCode: 'FFMPEG_ERROR',
      message: 'Video processing failed while extracting frames.',
      createdAt: '2026-09-03T12:00:00.000Z',
    },
  ],
};

function createReadiness(): NotificationReadinessChecks {
  return {
    mysql: jest.fn(async () => undefined),
    rabbitMq: jest.fn(async () => undefined),
  };
}

function createFixture() {
  const repository: NotificationReader = {
    listByUser: jest.fn<NotificationReader['listByUser']>(async (userId, pagination) => {
      const owned = records[userId] ?? [];
      const offset = (pagination.page - 1) * pagination.pageSize;
      return {
        items: owned.slice(offset, offset + pagination.pageSize),
        ...pagination,
        total: owned.length,
        totalPages: Math.ceil(owned.length / pagination.pageSize),
      };
    }),
  };
  const verifyToken = jest.fn((token: string) => {
    if (token === 'john-token') return claims(johnId, 'john.doe');
    if (token === 'mary-token') return claims(maryId, 'mary.doe');
    throw new Error(token === 'expired-token' ? 'expired' : 'invalid');
  });
  return { repository, verifyToken, readiness: createReadiness() };
}

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function createApp(
  fixture = createFixture(),
  overrides: {
    logger?: ReturnType<typeof createJsonLogger>;
  } = {},
) {
  const registry = createPrometheusRegistry();
  const metrics = createNotificationServiceMetrics(registry);
  app = await buildNotificationService({
    ...fixture,
    pagination: { defaultPageSize: 20, maximumPageSize: 100 },
    registry,
    metrics,
    ...(overrides.logger === undefined ? {} : { logger: overrides.logger }),
  });
  await app.ready();
  return { server: app, fixture, registry, metrics };
}

describe('Notification Service HTTP API', () => {
  it.each([
    ['missing', undefined],
    ['invalid', 'Bearer invalid-token'],
    ['expired', 'Bearer expired-token'],
  ] as const)('returns 401 for a %s token', async (_case, authorization) => {
    const { server, fixture } = await createApp();

    const response = await server.inject({
      method: 'GET',
      url: '/notifications',
      ...(authorization === undefined ? {} : { headers: { authorization } }),
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'A valid Bearer token is required' },
    });
    expect(fixture.repository.listByUser).not.toHaveBeenCalled();
  });

  it('isolates John and Mary exclusively through each JWT subject', async () => {
    const { server, fixture } = await createApp();

    const john = await server.inject({
      method: 'GET',
      url: '/notifications',
      headers: { authorization: 'Bearer john-token', 'x-user-id': maryId },
    });
    const mary = await server.inject({
      method: 'GET',
      url: '/notifications',
      headers: { authorization: 'Bearer mary-token', 'x-user-id': johnId },
    });

    expect(john.json().data.items).toEqual(records[johnId]);
    expect(mary.json().data.items).toEqual(records[maryId]);
    expect(fixture.repository.listByUser).toHaveBeenNthCalledWith(1, johnId, {
      page: 1,
      pageSize: 20,
    });
    expect(fixture.repository.listByUser).toHaveBeenNthCalledWith(2, maryId, {
      page: 1,
      pageSize: 20,
    });
  });

  it('returns the typed newest-first page using validated pagination', async () => {
    const { server, fixture } = await createApp();

    const response = await server.inject({
      method: 'GET',
      url: '/notifications?page=2&pageSize=1',
      headers: { authorization: 'Bearer john-token' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      success: true,
      data: {
        items: [records[johnId]?.[1]],
        page: 2,
        pageSize: 1,
        total: 2,
        totalPages: 2,
      },
    });
    expect(fixture.repository.listByUser).toHaveBeenCalledWith(johnId, {
      page: 2,
      pageSize: 1,
    });
    expect(response.body).not.toContain('userId');
  });

  it('rejects invalid pagination and ignores attempts to select a user through query parameters', async () => {
    const { server, fixture } = await createApp();

    const invalidPage = await server.inject({
      method: 'GET',
      url: '/notifications?page=0&pageSize=101',
      headers: { authorization: 'Bearer john-token' },
    });
    const selectedUser = await server.inject({
      method: 'GET',
      url: `/notifications?userId=${maryId}`,
      headers: { authorization: 'Bearer john-token' },
    });

    expect(invalidPage.statusCode).toBe(400);
    expect(selectedUser.statusCode).toBe(200);
    expect(fixture.repository.listByUser).toHaveBeenCalledTimes(1);
    expect(fixture.repository.listByUser).toHaveBeenCalledWith(johnId, {
      page: 1,
      pageSize: 20,
    });
  });

  it('returns a sanitized 500 when listing persistence fails', async () => {
    const fixture = createFixture();
    jest
      .mocked(fixture.repository.listByUser)
      .mockRejectedValueOnce(new NotificationRepositoryUnavailableError());
    const { server } = await createApp(fixture);

    const response = await server.inject({
      method: 'GET',
      url: '/notifications',
      headers: { authorization: 'Bearer john-token' },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'The notification operation failed' },
    });
    expect(response.body).not.toContain('repository unavailable');
  });

  it('keeps internal endpoints public and reports dependency readiness', async () => {
    const { server, fixture } = await createApp();

    const live = await server.inject({ method: 'GET', url: '/health/live' });
    const ready = await server.inject({ method: 'GET', url: '/health/ready' });
    const metrics = await server.inject({ method: 'GET', url: '/metrics' });

    expect(live.statusCode).toBe(200);
    expect(ready.statusCode).toBe(200);
    expect(metrics.statusCode).toBe(200);
    expect(fixture.readiness.mysql).toHaveBeenCalledTimes(1);
    expect(fixture.readiness.rabbitMq).toHaveBeenCalledTimes(1);
  });

  it.each(['mysql', 'rabbitMq'] as const)(
    'returns 503 when the %s readiness check fails',
    async (failedCheck) => {
      const fixture = createFixture();
      jest.mocked(fixture.readiness[failedCheck]).mockRejectedValueOnce(new Error('unavailable'));
      const { server } = await createApp(fixture);

      const response = await server.inject({ method: 'GET', url: '/health/ready' });
      const metrics = await server.inject({ method: 'GET', url: '/metrics' });

      expect(response.statusCode).toBe(503);
      expect(response.json().error.code).toBe('SERVICE_UNAVAILABLE');
      const dependency = failedCheck === 'rabbitMq' ? 'rabbitmq' : failedCheck;
      expect(metrics.body).toContain(
        `fiap_x_readiness{service="notification-service",dependency="${dependency}"} 0`,
      );
    },
  );

  it('exposes essential HTTP and consumption metrics', async () => {
    const { server, metrics } = await createApp();
    metrics.notificationsConsumed.inc({ outcome: 'persisted' });
    metrics.consumptionDuration.observe({ outcome: 'persisted' }, 0.01);
    await server.inject({ method: 'GET', url: '/health/ready' });
    await server.inject({
      method: 'GET',
      url: '/notifications',
      headers: { authorization: 'Bearer john-token' },
    });

    const response = await server.inject({ method: 'GET', url: '/metrics' });

    expect(response.body).toContain(
      'fiap_x_http_requests_total{service="notification-service",method="GET",route="/notifications",status_code="200"} 1',
    );
    expect(response.body).toContain('fiap_x_http_request_duration_seconds');
    expect(response.body).toContain(
      'fiap_x_notification_events_consumed_total{outcome="persisted"} 1',
    );
    expect(response.body).toContain('fiap_x_notification_consumption_duration_seconds');
    expect(response.body).toContain(
      'fiap_x_readiness{service="notification-service",dependency="mysql"} 1',
    );
    expect(response.body).not.toContain('john-token');
    expect(response.body).not.toContain(johnId);
  });

  it('documents the real list schema, pagination, errors, and Bearer security', async () => {
    const { server } = await createApp();
    const document = server.swagger();
    const operation = document.paths?.['/notifications']?.get;

    expect(document).toMatchObject({
      openapi: '3.1.0',
      info: { title: 'FIAP X Notification Service' },
      security: [{ bearerAuth: [] }],
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
      },
      paths: {
        '/health/live': { get: { security: [] } },
        '/health/ready': { get: { security: [] } },
        '/metrics': { get: { security: [] } },
      },
    });
    expect(operation?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'page', schema: expect.objectContaining({ minimum: 1 }) }),
        expect.objectContaining({
          name: 'pageSize',
          schema: expect.objectContaining({ minimum: 1, maximum: 100, default: 20 }),
        }),
      ]),
    );
    expect(operation?.responses).toEqual(
      expect.objectContaining({
        '200': expect.any(Object),
        '400': expect.any(Object),
        '401': expect.any(Object),
        '500': expect.any(Object),
      }),
    );
    const docs = await server.inject({ method: 'GET', url: '/docs' });
    expect(docs.statusCode).toBe(200);
    expect(docs.headers['content-type']).toContain('text/html');
  });

  it('writes structured logs without exposing the Bearer token', async () => {
    let output = '';
    const destination = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        output += chunk.toString('utf8');
        callback();
      },
    });
    const logger = createJsonLogger({ name: 'notification-service-test', destination });
    const { server } = await createApp(createFixture(), { logger });

    const response = await server.inject({
      method: 'GET',
      url: '/notifications',
      headers: { authorization: 'Bearer john-token' },
    });

    expect(response.statusCode).toBe(200);
    expect(output).toContain('notifications_listed');
    expect(output).toContain(String(response.headers['x-request-id']));
    expect(output).not.toContain('john-token');
    expect(output).not.toContain('authorization');
  });
});
