import fastifyJwt from '@fastify/jwt';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import {
  HttpErrorResponseSchema,
  LoginRequestSchema,
  LoginResponseSchema,
  createHttpSuccessSchema,
  type LoginRequest,
} from '@fiap-x/contracts';
import {
  createPrometheusRegistry,
  type JsonLogger,
  type PrometheusRegistry,
} from '@fiap-x/observability';
import { Type } from '@sinclair/typebox';
import Fastify, { LogController, type FastifyInstance, type FastifyServerOptions } from 'fastify';

import {
  AuthenticateUser,
  InvalidCredentialsError,
  type PasswordVerifier,
} from './authenticate-user.js';
import { createAuthServiceMetrics } from './metrics.js';
import { UserRepositoryUnavailableError, type UserRepository } from './user-repository.js';

const ServiceStatusSchema = createHttpSuccessSchema(
  Type.Object(
    {
      service: Type.Literal('auth-service'),
      status: Type.Union([Type.Literal('ok'), Type.Literal('ready')]),
    },
    { additionalProperties: false },
  ),
);

const commonErrorResponses = {
  400: HttpErrorResponseSchema,
  401: HttpErrorResponseSchema,
  503: HttpErrorResponseSchema,
  500: HttpErrorResponseSchema,
} as const;

export interface BuildAuthServiceOptions {
  userRepository: UserRepository;
  verifyPassword: PasswordVerifier;
  jwt: {
    secret: string;
    expiresInSeconds: number;
    issuer: string;
    audience: string;
  };
  logger?: JsonLogger | false;
  registry?: PrometheusRegistry;
}

function createErrorResponse(code: string, message: string) {
  return { success: false as const, error: { code, message } };
}

export async function buildAuthService(options: BuildAuthServiceOptions): Promise<FastifyInstance> {
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
  const metrics = createAuthServiceMetrics(registry);
  const authenticateUser = new AuthenticateUser(options.userRepository, options.verifyPassword);

  await app.register(fastifySwagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'FIAP X Auth Service',
        description: 'Minimal username/password authentication and JWT bearer-token API.',
        version: '1.0.0',
      },
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description:
              'HS256 JWT containing sub, username, iss, aud, iat, and exp claims. Send it as Authorization: Bearer <token>.',
          },
        },
      },
      tags: [
        { name: 'Authentication', description: 'User authentication operations.' },
        { name: 'Operations', description: 'Health and observability endpoints.' },
      ],
    },
  });
  await app.register(fastifySwaggerUi, {
    routePrefix: '/docs',
    staticCSP: true,
    uiConfig: { deepLinking: true },
  });
  await app.register(fastifyJwt, {
    secret: options.jwt.secret,
    sign: {
      algorithm: 'HS256',
      expiresIn: options.jwt.expiresInSeconds,
      iss: options.jwt.issuer,
      aud: options.jwt.audience,
    },
    verify: {
      algorithms: ['HS256'],
      allowedIss: options.jwt.issuer,
      allowedAud: options.jwt.audience,
      requiredClaims: ['sub', 'iat', 'exp'],
    },
  });

  app.addHook('onResponse', async (request, reply) => {
    const labels = {
      service: 'auth-service' as const,
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

  app.addHook('onRequest', async (request, reply) => {
    void reply.header('x-request-id', request.id);
  });

  app.setErrorHandler(async (error, request, reply) => {
    if (
      typeof error === 'object' &&
      error !== null &&
      'validation' in error &&
      error.validation !== undefined
    ) {
      await reply
        .status(400)
        .send(createErrorResponse('INVALID_REQUEST', 'Request validation failed'));
      return;
    }

    if (error instanceof UserRepositoryUnavailableError) {
      request.log.warn({ err: error, event: 'user_repository_unavailable' }, 'MySQL unavailable');
      await reply
        .status(503)
        .send(createErrorResponse('SERVICE_UNAVAILABLE', 'The database is unavailable'));
      return;
    }

    request.log.error({ err: error, event: 'request_failed' }, 'Request failed');
    await reply
      .status(500)
      .send(createErrorResponse('INTERNAL_ERROR', 'An unexpected error occurred'));
  });

  app.get(
    '/health/live',
    {
      schema: {
        tags: ['Operations'],
        summary: 'Check process health',
        security: [],
        response: { 200: ServiceStatusSchema },
      },
    },
    async () => ({
      success: true as const,
      data: { service: 'auth-service' as const, status: 'ok' as const },
    }),
  );

  app.get(
    '/health/ready',
    {
      schema: {
        tags: ['Operations'],
        summary: 'Check MySQL readiness',
        security: [],
        response: { 200: ServiceStatusSchema, 503: HttpErrorResponseSchema },
      },
    },
    async (request, reply) => {
      try {
        await options.userRepository.ping();
        metrics.readiness.set({ service: 'auth-service', dependency: 'mysql' }, 1);
        return {
          success: true as const,
          data: { service: 'auth-service' as const, status: 'ready' as const },
        };
      } catch (error) {
        metrics.readiness.set({ service: 'auth-service', dependency: 'mysql' }, 0);
        request.log.warn({ err: error, event: 'readiness_check_failed' }, 'Readiness check failed');
        return reply
          .status(503)
          .send(createErrorResponse('SERVICE_UNAVAILABLE', 'The database is unavailable'));
      }
    },
  );

  app.get(
    '/metrics',
    {
      schema: {
        tags: ['Operations'],
        summary: 'Read Prometheus metrics',
        security: [],
        response: {
          200: Type.String({ description: 'Prometheus text exposition format.' }),
        },
      },
    },
    async (_request, reply) => {
      return reply
        .serializer((payload) => String(payload))
        .header('content-type', registry.contentType)
        .send(await registry.metrics());
    },
  );

  app.post<{ Body: LoginRequest }>(
    '/auth/login',
    {
      schema: {
        tags: ['Authentication'],
        summary: 'Authenticate with username and password',
        description:
          'Returns a one-hour HS256 Bearer token when the supplied credentials are valid.',
        security: [],
        body: LoginRequestSchema,
        response: { 200: LoginResponseSchema, ...commonErrorResponses },
      },
    },
    async (request, reply) => {
      try {
        const user = await authenticateUser.execute(request.body.username, request.body.password);
        const accessToken = await reply.jwtSign({
          sub: user.id,
          username: user.username,
        });

        metrics.loginAttempts.inc({ outcome: 'success' });
        request.log.info(
          { event: 'authentication_succeeded', userId: user.id },
          'Authentication succeeded',
        );

        return {
          success: true as const,
          data: {
            accessToken,
            tokenType: 'Bearer' as const,
            expiresIn: options.jwt.expiresInSeconds,
            user: { id: user.id, username: user.username, displayName: user.displayName },
          },
        };
      } catch (error) {
        if (error instanceof InvalidCredentialsError) {
          metrics.loginAttempts.inc({ outcome: 'failure' });
          request.log.warn({ event: 'authentication_failed' }, 'Authentication failed');
          return reply
            .status(401)
            .send(createErrorResponse('INVALID_CREDENTIALS', 'Invalid username or password'));
        }

        metrics.loginAttempts.inc({ outcome: 'failure' });
        throw error;
      }
    },
  );

  return app;
}
