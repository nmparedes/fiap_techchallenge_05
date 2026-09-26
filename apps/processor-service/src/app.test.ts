import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { createPrometheusRegistry } from '@fiap-x/observability';
import type { FastifyInstance } from 'fastify';

import { buildProcessorService } from './app.js';
import type { ProcessorReadinessChecks } from './readiness.js';

function createReadiness(): ProcessorReadinessChecks {
  return {
    rabbitMq: jest.fn(async () => undefined),
    storage: jest.fn(async () => undefined),
    ffmpeg: jest.fn(async () => undefined),
  };
}

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function createApp(readiness = createReadiness()) {
  const registry = createPrometheusRegistry();
  app = await buildProcessorService({ readiness, registry });
  await app.ready();
  return { server: app, readiness, registry };
}

describe('Processor Service internal endpoints', () => {
  it('reports process liveness', async () => {
    const { server } = await createApp();

    const response = await server.inject({ method: 'GET', url: '/health/live' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      success: true,
      data: { service: 'processor-service', status: 'ok' },
    });
  });

  it('reports readiness after all injected checks succeed', async () => {
    const { server, readiness } = await createApp();

    const response = await server.inject({ method: 'GET', url: '/health/ready' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      success: true,
      data: { service: 'processor-service', status: 'ready' },
    });
    expect(readiness.rabbitMq).toHaveBeenCalledTimes(1);
    expect(readiness.storage).toHaveBeenCalledTimes(1);
    expect(readiness.ffmpeg).toHaveBeenCalledTimes(1);
  });

  it.each(['rabbitMq', 'storage', 'ffmpeg'] as const)(
    'reports not ready when the %s check fails',
    async (failedCheck) => {
      const readiness = createReadiness();
      jest.mocked(readiness[failedCheck]).mockRejectedValueOnce(new Error('unavailable'));
      const { server } = await createApp(readiness);

      const response = await server.inject({ method: 'GET', url: '/health/ready' });
      const metrics = await server.inject({ method: 'GET', url: '/metrics' });

      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({
        success: false,
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'A required dependency is unavailable',
        },
      });
      const dependency = failedCheck === 'rabbitMq' ? 'rabbitmq' : failedCheck;
      expect(metrics.body).toContain(
        `fiap_x_readiness{service="processor-service",dependency="${dependency}"} 0`,
      );
    },
  );

  it('exposes Prometheus metrics', async () => {
    const { server } = await createApp();

    await server.inject({ method: 'GET', url: '/health/live' });
    await server.inject({ method: 'GET', url: '/health/ready' });
    const response = await server.inject({ method: 'GET', url: '/metrics' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/plain');
    expect(response.body).toContain(
      'fiap_x_http_requests_total{service="processor-service",method="GET",route="/health/live",status_code="200"} 1',
    );
    expect(response.body).toContain('fiap_x_http_request_duration_seconds');
    expect(response.body).toContain(
      'fiap_x_readiness{service="processor-service",dependency="rabbitmq"} 1',
    );
    expect(response.body).toContain(
      'fiap_x_readiness{service="processor-service",dependency="storage"} 1',
    );
    expect(response.body).toContain(
      'fiap_x_readiness{service="processor-service",dependency="ffmpeg"} 1',
    );
    expect(response.body).toContain('fiap_x_processor_jobs_total');
    expect(response.body).toContain('fiap_x_processor_job_duration_seconds');
    expect(response.body).toContain('fiap_x_processor_failures_total');
  });
});
