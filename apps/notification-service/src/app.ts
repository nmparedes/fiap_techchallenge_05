import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import {
  HttpErrorResponseSchema,
  createHttpSuccessSchema,
  type AuthTokenClaims,
} from '@fiap-x/contracts';
import type { AuthTokenVerifier } from '@fiap-x/infrastructure';
import {
  createPrometheusRegistry,
  type JsonLogger,
  type PrometheusRegistry,
} from '@fiap-x/observability';
import { Type } from '@sinclair/typebox';
import Fastify, {
  LogController,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
  type FastifyServerOptions,
} from 'fastify';

import { createNotificationServiceMetrics, type NotificationServiceMetrics } from './metrics.js';
import {
  NotificationListResponseSchema,
  createNotificationListQuerySchema,
  type NotificationListQuery,
  type NotificationPaginationOptions,
} from './notification.js';
import {
  NotificationRepositoryUnavailableError,
  type NotificationReader,
} from './notification-repository.js';
import type { NotificationReadinessChecks } from './readiness.js';

const ServiceStatusSchema = createHttpSuccessSchema(
  Type.Object(
    {
      service: Type.Literal('notification-service'),
      status: Type.Union([Type.Literal('ok'), Type.Literal('ready')]),
    },
    { additionalProperties: false },
  ),
);

export interface BuildNotificationServiceOptions {
  repository: NotificationReader;
  readiness: NotificationReadinessChecks;
  verifyToken: AuthTokenVerifier;
  pagination: NotificationPaginationOptions;
  logger?: JsonLogger | false;
  registry?: PrometheusRegistry;
  metrics?: NotificationServiceMetrics;
}

function errorResponse(code: string, message: string) {
  return { success: false as const, error: { code, message } };
}

function bearerToken(header: string | undefined): string | null {
  if (header === undefined) {
    return null;
  }
  const match = /^Bearer ([^\s]+)$/i.exec(header);
  return match?.[1] ?? null;
}

function authenticatedUserId(request: FastifyRequest): string {
  if (request.authUser === undefined) {
    throw new Error('Authentication hook invariant violated');
  }
  return request.authUser.id;
}

function createAuthenticationHook(verifyToken: AuthTokenVerifier) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const token = bearerToken(request.headers.authorization);
    if (token === null) {
      await reply
        .status(401)
        .send(errorResponse('UNAUTHORIZED', 'A valid Bearer token is required'));
      return;
    }

    try {
      const claims: AuthTokenClaims = verifyToken(token);
      request.authUser = { id: claims.sub, username: claims.username };
    } catch {
      await reply
        .status(401)
        .send(errorResponse('UNAUTHORIZED', 'A valid Bearer token is required'));
    }
  };
}

export async function buildNotificationService(
  options: BuildNotificationServiceOptions,
): Promise<FastifyInstance> {
  const logger = options.logger ?? false;
  const serverOptions: FastifyServerOptions =
    logger === false
      ? { logger: false }
      : {
          loggerInstance: logger,
          requestIdHeader: 'x-request-id',
          logController: new LogController({
            disableRequestLogging: true,
            requestIdLogLabel: 'correlationId',
          }),
        };
  const app = Fastify(serverOptions);
  const registry = options.registry ?? createPrometheusRegistry();
  const metrics = options.metrics ?? createNotificationServiceMetrics(registry);
  const requireAuthentication = createAuthenticationHook(options.verifyToken);
  const listQuerySchema = createNotificationListQuerySchema(options.pagination);

  app.decorateRequest('authUser', undefined);
  await app.register(fastifySwagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'FIAP X Notification Service',
        description: 'Authenticated internal processing-failure notifications.',
        version: '1.0.0',
      },
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description: 'HS256 JWT issued by the FIAP X Auth Service.',
          },
        },
      },
      security: [{ bearerAuth: [] }],
      tags: [
        { name: 'Notifications', description: 'Authenticated notification operations.' },
        { name: 'Operations', description: 'Unauthenticated operational endpoints.' },
      ],
    },
  });
  await app.register(fastifySwaggerUi, { routePrefix: '/docs', staticCSP: true });

  app.addHook('onRequest', async (request, reply) => {
    void reply.header('x-request-id', request.id);
  });
  app.addHook('onResponse', async (request, reply) => {
    const labels = {
      service: 'notification-service' as const,
      method: request.method,
      route: request.routeOptions.url,
    };
    metrics.httpRequests.inc({ ...labels, status_code: String(reply.statusCode) });
    metrics.httpRequestDuration.observe(labels, reply.elapsedTime / 1000);
    request.log.info(
      {
        event: 'http_request_completed',
        method: request.method,
        route: request.routeOptions.url,
        status: reply.statusCode,
        durationMs: reply.elapsedTime,
      },
      'HTTP request completed',
    );
  });

  app.setErrorHandler(async (error, request, reply) => {
    if (
      typeof error === 'object' &&
      error !== null &&
      'validation' in error &&
      error.validation !== undefined
    ) {
      await reply.status(400).send(errorResponse('INVALID_REQUEST', 'The request is invalid'));
      return;
    }

    request.log.error(
      {
        err: error,
        event: 'notification_request_failed',
        expectedOperationalError: error instanceof NotificationRepositoryUnavailableError,
      },
      'Notification request failed',
    );
    await reply
      .status(500)
      .send(errorResponse('INTERNAL_ERROR', 'The notification operation failed'));
  });

  app.get(
    '/health/live',
    {
      schema: {
        tags: ['Operations'],
        security: [],
        summary: 'Check process health',
        response: { 200: ServiceStatusSchema },
      },
    },
    async () => ({
      success: true as const,
      data: { service: 'notification-service' as const, status: 'ok' as const },
    }),
  );

  app.get(
    '/health/ready',
    {
      schema: {
        tags: ['Operations'],
        security: [],
        summary: 'Check required MySQL and RabbitMQ dependencies',
        response: { 200: ServiceStatusSchema, 503: HttpErrorResponseSchema },
      },
    },
    async (request, reply) => {
      try {
        await Promise.all([
          observeDependency('mysql', options.readiness.mysql, metrics),
          observeDependency('rabbitmq', options.readiness.rabbitMq, metrics),
        ]);
        return {
          success: true as const,
          data: { service: 'notification-service' as const, status: 'ready' as const },
        };
      } catch (error) {
        request.log.warn({ err: error, event: 'readiness_failed' }, 'Readiness failed');
        return reply
          .status(503)
          .send(errorResponse('SERVICE_UNAVAILABLE', 'A required dependency is unavailable'));
      }
    },
  );

  app.get(
    '/metrics',
    {
      schema: {
        tags: ['Operations'],
        security: [],
        summary: 'Read Prometheus metrics',
        response: { 200: Type.String() },
      },
    },
    async (_request, reply) => {
      return reply
        .serializer((payload) => String(payload))
        .header('content-type', registry.contentType)
        .send(await registry.metrics());
    },
  );

  app.get<{ Querystring: NotificationListQuery }>(
    '/notifications',
    {
      onRequest: requireAuthentication,
      schema: {
        tags: ['Notifications'],
        summary: 'List the authenticated user notifications',
        description: 'Returns processing-failure notifications owned by the JWT subject.',
        querystring: listQuerySchema,
        response: {
          200: NotificationListResponseSchema,
          400: HttpErrorResponseSchema,
          401: HttpErrorResponseSchema,
          500: HttpErrorResponseSchema,
        },
      },
    },
    async (request) => {
      const userId = authenticatedUserId(request);
      const pagination = {
        page: request.query.page ?? 1,
        pageSize: request.query.pageSize ?? options.pagination.defaultPageSize,
      };
      const page = await options.repository.listByUser(userId, pagination);
      request.log.info(
        {
          event: 'notifications_listed',
          userId,
          page: page.page,
          pageSize: page.pageSize,
          itemCount: page.items.length,
        },
        'Notifications listed',
      );
      return { success: true as const, data: page };
    },
  );

  return app;
}

async function observeDependency(
  dependency: string,
  check: () => Promise<void>,
  metrics: NotificationServiceMetrics,
): Promise<void> {
  try {
    await check();
    metrics.readiness.set({ service: 'notification-service', dependency }, 1);
  } catch (error) {
    metrics.readiness.set({ service: 'notification-service', dependency }, 0);
    throw error;
  }
}
