import { HttpErrorResponseSchema, createHttpSuccessSchema } from '@fiap-x/contracts';
import {
  createPrometheusRegistry,
  type JsonLogger,
  type PrometheusRegistry,
} from '@fiap-x/observability';
import { Type } from '@sinclair/typebox';
import Fastify, { LogController, type FastifyInstance, type FastifyServerOptions } from 'fastify';

import { createProcessorServiceMetrics, type ProcessorServiceMetrics } from './metrics.js';
import type { ProcessorReadinessChecks } from './readiness.js';

const ServiceStatusSchema = createHttpSuccessSchema(
  Type.Object(
    {
      service: Type.Literal('processor-service'),
      status: Type.Union([Type.Literal('ok'), Type.Literal('ready')]),
    },
    { additionalProperties: false },
  ),
);

export interface BuildProcessorServiceOptions {
  readiness: ProcessorReadinessChecks;
  logger?: JsonLogger | false;
  registry?: PrometheusRegistry;
  metrics?: ProcessorServiceMetrics;
}

function errorResponse(code: string, message: string) {
  return { success: false as const, error: { code, message } };
}

export async function buildProcessorService(
  options: BuildProcessorServiceOptions,
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
  const metrics = options.metrics ?? createProcessorServiceMetrics(registry);

  app.addHook('onRequest', async (request, reply) => {
    void reply.header('x-request-id', request.id);
  });
  app.addHook('onResponse', async (request, reply) => {
    const labels = {
      service: 'processor-service' as const,
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

  app.get('/health/live', { schema: { response: { 200: ServiceStatusSchema } } }, async () => ({
    success: true as const,
    data: { service: 'processor-service' as const, status: 'ok' as const },
  }));

  app.get(
    '/health/ready',
    {
      schema: {
        response: { 200: ServiceStatusSchema, 503: HttpErrorResponseSchema },
      },
    },
    async (request, reply) => {
      try {
        await Promise.all([
          observeDependency('rabbitmq', options.readiness.rabbitMq, metrics),
          observeDependency('storage', options.readiness.storage, metrics),
          observeDependency('ffmpeg', options.readiness.ffmpeg, metrics),
        ]);
        return {
          success: true as const,
          data: { service: 'processor-service' as const, status: 'ready' as const },
        };
      } catch (error) {
        request.log.warn({ err: error, event: 'readiness_failed' }, 'Readiness failed');
        return reply
          .status(503)
          .send(errorResponse('SERVICE_UNAVAILABLE', 'A required dependency is unavailable'));
      }
    },
  );

  app.get('/metrics', { schema: { response: { 200: Type.String() } } }, async (_request, reply) => {
    return reply
      .serializer((payload) => String(payload))
      .header('content-type', registry.contentType)
      .send(await registry.metrics());
  });

  return app;
}

async function observeDependency(
  dependency: string,
  check: () => Promise<void>,
  metrics: ProcessorServiceMetrics,
): Promise<void> {
  try {
    await check();
    metrics.readiness.set({ service: 'processor-service', dependency }, 1);
  } catch (error) {
    metrics.readiness.set({ service: 'processor-service', dependency }, 0);
    throw error;
  }
}
