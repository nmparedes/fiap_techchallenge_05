import fastifyMultipart, { ajvFilePlugin, type MultipartFile } from '@fastify/multipart';
import type { Readable } from 'node:stream';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import {
  HttpErrorResponseSchema,
  VideoAcceptedResponseSchema,
  VideoIdParamsSchema,
  VideoListQuerySchema,
  VideoListResponseSchema,
  VideoStatusResponseSchema,
  createHttpSuccessSchema,
  type AuthTokenClaims,
  type VideoIdParams,
  type VideoListQuery,
  type VideoPage,
  type VideoView,
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

import { createVideoServiceMetrics, type VideoServiceMetrics } from './metrics.js';
import type { ProcessingRequestPublisher } from './processing-publisher.js';
import { DEFAULT_VIDEO_FPS, MAX_VIDEO_FPS, MIN_VIDEO_FPS } from './upload-policy.js';
import {
  InvalidVideoUploadError,
  VideoConflictError,
  VideoNotFoundError,
  VideoOperationError,
  type AcceptedVideo,
} from './video-service.js';
import { VideoFileStoreError } from './video-files.js';
import { VideoRepositoryUnavailableError, type VideoRepository } from './video-repository.js';

const ServiceStatusSchema = createHttpSuccessSchema(
  Type.Object(
    {
      service: Type.Literal('video-service'),
      status: Type.Union([Type.Literal('ok'), Type.Literal('ready')]),
    },
    { additionalProperties: false },
  ),
);

function createUploadBodySchema() {
  return Type.Object(
    {
      video: Type.Unsafe<MultipartFile>({ isFile: true }),
      fps: Type.Optional(Type.Unsafe<MultipartFpsField>({ isMultipartFps: true })),
    },
    { additionalProperties: false },
  );
}

const DownloadSchema = Type.String({
  contentEncoding: 'binary',
  contentMediaType: 'application/zip',
});

const standardErrors = {
  400: HttpErrorResponseSchema,
  401: HttpErrorResponseSchema,
  404: HttpErrorResponseSchema,
  409: HttpErrorResponseSchema,
  500: HttpErrorResponseSchema,
} as const;

interface UploadBody {
  video: MultipartFile;
  fps?: MultipartFpsField;
}

interface MultipartFpsField {
  value: string;
}

type FastifyAjvPlugin = NonNullable<NonNullable<FastifyServerOptions['ajv']>['plugins']>[number];

export interface BuildVideoServiceOptions {
  service: VideoServiceApi;
  repository: VideoRepository;
  publisher: ProcessingRequestPublisher;
  verifyToken: AuthTokenVerifier;
  maxUploadBytes: number;
  logger?: JsonLogger | false;
  registry?: PrometheusRegistry;
  metrics?: VideoServiceMetrics;
}

export interface VideoServiceApi {
  upload(input: {
    userId: string;
    originalName: string;
    content: Buffer;
    fps: number;
  }): Promise<AcceptedVideo>;
  list(userId: string, pagination: { page: number; pageSize: number }): Promise<VideoPage>;
  get(userId: string, videoId: string): Promise<VideoView>;
  retry(userId: string, videoId: string): Promise<AcceptedVideo>;
  removeFromQueue(userId: string, videoId: string): Promise<void>;
  download(userId: string, videoId: string): Promise<Readable>;
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

function ajvMultipartFpsPlugin(ajv: { addKeyword(definition: object): unknown }): unknown {
  return ajv.addKeyword({
    keyword: 'isMultipartFps',
    compile: (_schema: unknown, parent: Record<string, unknown>) => {
      parent['type'] = 'integer';
      parent['minimum'] = MIN_VIDEO_FPS;
      parent['maximum'] = MAX_VIDEO_FPS;
      parent['default'] = DEFAULT_VIDEO_FPS;
      delete parent['isMultipartFps'];

      return (field: unknown) => {
        if (typeof field !== 'object' || field === null || !('value' in field)) {
          return false;
        }
        return /^(?:[1-9]|10)$/.test(String(field.value));
      };
    },
    error: { message: 'must be an integer between 1 and 10' },
  });
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

function isMultipartClientError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    (error.code.startsWith('FST_') || error.code.startsWith('FST_PARTS_'))
  );
}

export async function buildVideoService(
  options: BuildVideoServiceOptions,
): Promise<FastifyInstance> {
  const logger = options.logger ?? false;
  const serverOptions: FastifyServerOptions = {
    ...(logger === false
      ? { logger: false }
      : {
          loggerInstance: logger,
          requestIdHeader: 'x-request-id',
          logController: new LogController({
            disableRequestLogging: true,
            requestIdLogLabel: 'correlationId',
          }),
        }),
    ajv: {
      plugins: [
        ajvFilePlugin as unknown as FastifyAjvPlugin,
        ajvMultipartFpsPlugin as unknown as FastifyAjvPlugin,
      ],
    },
  };
  const app = Fastify(serverOptions);
  const registry = options.registry ?? createPrometheusRegistry();
  const metrics = options.metrics ?? createVideoServiceMetrics(registry);
  const requireAuthentication = createAuthenticationHook(options.verifyToken);

  app.decorateRequest('authUser', undefined);
  await app.register(fastifySwagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'FIAP X Video Service',
        description: 'Authenticated asynchronous video catalog and processing API.',
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
        { name: 'Videos', description: 'Authenticated video operations.' },
        { name: 'Operations', description: 'Unauthenticated operational endpoints.' },
      ],
    },
  });
  await app.register(fastifySwaggerUi, { routePrefix: '/docs', staticCSP: true });
  await app.register(fastifyMultipart, {
    attachFieldsToBody: true,
    limits: { files: 1, fields: 1, fileSize: options.maxUploadBytes },
  });

  app.addHook('onRequest', async (request, reply) => {
    void reply.header('x-request-id', request.id);
  });
  app.addHook('onResponse', async (request, reply) => {
    const labels = {
      service: 'video-service' as const,
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
    const route = request.routeOptions.url;
    if (
      (typeof error === 'object' &&
        error !== null &&
        'validation' in error &&
        error.validation !== undefined) ||
      isMultipartClientError(error) ||
      error instanceof InvalidVideoUploadError
    ) {
      if (route === '/videos') {
        metrics.uploads.inc({ outcome: 'invalid' });
      } else if (route === '/videos/:id/retry') {
        metrics.retries.inc({ outcome: 'invalid' });
      }
      await reply.status(400).send(errorResponse('INVALID_REQUEST', 'The request is invalid'));
      return;
    }
    if (error instanceof VideoNotFoundError) {
      if (route === '/videos/:id/retry') {
        metrics.retries.inc({ outcome: 'not_found' });
      }
      await reply.status(404).send(errorResponse('VIDEO_NOT_FOUND', 'Video not found'));
      return;
    }
    if (error instanceof VideoConflictError) {
      if (route === '/videos/:id/retry') {
        metrics.retries.inc({ outcome: 'conflict' });
      }
      await reply.status(409).send(errorResponse('VIDEO_CONFLICT', error.message));
      return;
    }

    const expectedOperationalError =
      error instanceof VideoOperationError ||
      error instanceof VideoRepositoryUnavailableError ||
      error instanceof VideoFileStoreError;
    if (route === '/videos') {
      metrics.uploads.inc({ outcome: 'failed' });
    } else if (route === '/videos/:id/retry') {
      metrics.retries.inc({ outcome: 'failed' });
    }
    request.log.error(
      { err: error, event: 'video_request_failed', expectedOperationalError },
      'Video request failed',
    );
    await reply.status(500).send(errorResponse('INTERNAL_ERROR', 'The video operation failed'));
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
      data: { service: 'video-service' as const, status: 'ok' as const },
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
          observeDependency('mysql', options.repository.ping, options.repository, metrics),
          observeDependency('rabbitmq', options.publisher.ping, options.publisher, metrics),
        ]);
        return {
          success: true as const,
          data: { service: 'video-service' as const, status: 'ready' as const },
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

  app.post<{ Body: UploadBody }>(
    '/videos',
    {
      onRequest: requireAuthentication,
      schema: {
        tags: ['Videos'],
        summary: 'Upload a video for asynchronous processing',
        description:
          'Accepts one video file up to exactly 200 MiB and an optional integer fps field from 1 to 10 (default 1). The service validates the file signature and returns only after RabbitMQ publisher confirmation.',
        consumes: ['multipart/form-data'],
        body: createUploadBodySchema(),
        response: { 202: VideoAcceptedResponseSchema, ...standardErrors },
      },
    },
    async (request, reply) => {
      const file = request.body.video;
      const accepted = await options.service.upload({
        userId: authenticatedUserId(request),
        originalName: file.filename,
        content: await file.toBuffer(),
        fps: request.body.fps === undefined ? DEFAULT_VIDEO_FPS : Number(request.body.fps.value),
      });
      metrics.uploads.inc({ outcome: 'accepted' });
      metrics.videosByStatus.inc({ operation: 'transitioned', status: accepted.status });
      request.log.info(
        { event: 'video_upload_accepted', userId: request.authUser?.id, videoId: accepted.id },
        'Video upload accepted',
      );
      return reply.status(202).send({ success: true as const, data: accepted });
    },
  );

  app.get<{ Querystring: VideoListQuery }>(
    '/videos',
    {
      onRequest: requireAuthentication,
      schema: {
        tags: ['Videos'],
        summary: 'List the authenticated user videos',
        querystring: VideoListQuerySchema,
        response: {
          200: VideoListResponseSchema,
          401: HttpErrorResponseSchema,
          500: HttpErrorResponseSchema,
        },
      },
    },
    async (request) => {
      const pagination = {
        page: request.query.page ?? 1,
        pageSize: request.query.pageSize ?? 20,
      };
      const page = await options.service.list(authenticatedUserId(request), pagination);
      for (const video of page.items) {
        metrics.videosByStatus.inc({ operation: 'observed', status: video.status });
      }
      return {
        success: true as const,
        data: page,
      };
    },
  );

  app.get<{ Params: VideoIdParams }>(
    '/videos/:id',
    {
      onRequest: requireAuthentication,
      schema: {
        tags: ['Videos'],
        summary: 'Read video processing status',
        params: VideoIdParamsSchema,
        response: {
          200: VideoStatusResponseSchema,
          401: HttpErrorResponseSchema,
          404: HttpErrorResponseSchema,
          500: HttpErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const video = await options.service.get(authenticatedUserId(request), request.params.id);
      metrics.videosByStatus.inc({ operation: 'observed', status: video.status });
      if (video.status === 'FAILED') {
        return reply.status(200).send({
          success: false as const,
          data: video,
          error: {
            code: video.errorCode ?? 'PROCESSING_FAILED',
            message: video.errorMessage ?? 'Video processing failed',
          },
        });
      }
      return { success: true as const, data: video };
    },
  );

  app.delete<{ Params: VideoIdParams }>(
    '/videos/:id',
    {
      onRequest: requireAuthentication,
      schema: {
        tags: ['Videos'],
        summary: 'Remove a queued video from the processing queue',
        description:
          'Removes an authenticated user video only while it is still queued; active and completed processing records cannot be removed.',
        params: VideoIdParamsSchema,
        response: { 204: Type.Null(), ...standardErrors },
      },
    },
    async (request, reply) => {
      await options.service.removeFromQueue(authenticatedUserId(request), request.params.id);
      return reply.status(204).send();
    },
  );

  app.get<{ Params: VideoIdParams }>(
    '/videos/:id/download',
    {
      onRequest: requireAuthentication,
      schema: {
        tags: ['Videos'],
        summary: 'Download a completed video archive',
        description:
          "Streams the authenticated owner's ZIP archive only when the database status is COMPLETED.",
        params: VideoIdParamsSchema,
        produces: ['application/zip'],
        response: {
          200: DownloadSchema,
          400: HttpErrorResponseSchema,
          401: HttpErrorResponseSchema,
          404: HttpErrorResponseSchema,
          409: HttpErrorResponseSchema,
          500: HttpErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const archive = await options.service.download(
        authenticatedUserId(request),
        request.params.id,
      );
      return reply
        .header('content-type', 'application/zip')
        .header('content-disposition', `attachment; filename="frames-${request.params.id}.zip"`)
        .send(archive);
    },
  );

  app.post<{ Params: VideoIdParams }>(
    '/videos/:id/retry',
    {
      onRequest: requireAuthentication,
      schema: {
        tags: ['Videos'],
        summary: 'Retry a failed video',
        description:
          'Verifies the stored input, atomically increments the attempt, and returns only after RabbitMQ publisher confirmation.',
        params: VideoIdParamsSchema,
        response: {
          202: VideoAcceptedResponseSchema,
          400: HttpErrorResponseSchema,
          401: HttpErrorResponseSchema,
          404: HttpErrorResponseSchema,
          409: HttpErrorResponseSchema,
          500: HttpErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const accepted = await options.service.retry(authenticatedUserId(request), request.params.id);
      metrics.retries.inc({ outcome: 'accepted' });
      metrics.videosByStatus.inc({ operation: 'transitioned', status: accepted.status });
      return reply.status(202).send({ success: true as const, data: accepted });
    },
  );

  return app;
}

async function observeDependency<TContext>(
  dependency: string,
  check: (this: TContext) => Promise<void>,
  context: TContext,
  metrics: VideoServiceMetrics,
): Promise<void> {
  try {
    await check.call(context);
    metrics.readiness.set({ service: 'video-service', dependency }, 1);
  } catch (error) {
    metrics.readiness.set({ service: 'video-service', dependency }, 0);
    throw error;
  }
}
