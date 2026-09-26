import { describe, expect, it } from '@jest/globals';
import { Registry } from '@prometheus-io/client';

import { createJsonLogger, createPrometheusRegistry, createServiceMetrics } from './index.js';

describe('observability factories', () => {
  it('creates a JSON logger with structured bindings', () => {
    const records: string[] = [];
    const logger = createJsonLogger({
      base: { service: 'test-service' },
      destination: {
        write(message) {
          records.push(message);
        },
      },
    });

    logger.info({ videoId: 'video-1' }, 'processing queued');

    const line = records[0];
    expect(line).toBeDefined();

    const record = JSON.parse(line ?? '{}') as Record<string, unknown>;
    expect(record).toMatchObject({
      service: 'test-service',
      videoId: 'video-1',
      message: 'processing queued',
      level: 'info',
    });
    expect(record['timestamp']).toEqual(expect.any(String));
    expect(record['correlationId']).toEqual(expect.any(String));
    expect(Number.isNaN(Date.parse(String(record['timestamp'])))).toBe(false);
  });

  it('redacts authentication secrets and sanitizes bounded errors', () => {
    const records: string[] = [];
    const logger = createJsonLogger({
      service: 'redaction-test',
      destination: { write: (message) => records.push(message) },
    });
    const longSecret = 'x'.repeat(3_000);

    logger.error(
      {
        authorization: 'Bearer top-secret',
        credentials: { password: 'password-value', token: 'token-value' },
        req: { headers: { authorization: 'Bearer header-secret', cookie: 'session=secret' } },
        err: new Error(`mysql://user:database-password@host SELECT * FROM users ${longSecret}`),
      },
      'Sensitive operation failed',
    );

    const output = records.join('');
    const record = JSON.parse(records[0] ?? '{}') as Record<string, unknown>;
    expect(output).not.toContain('top-secret');
    expect(output).not.toContain('password-value');
    expect(output).not.toContain('token-value');
    expect(output).not.toContain('header-secret');
    expect(output).not.toContain('session=secret');
    expect(output).not.toContain('database-password');
    expect(output).not.toContain('SELECT * FROM users');
    expect(JSON.stringify(record['err']).length).toBeLessThan(2_200);
  });

  it('creates a logger with the default destination when none is provided', () => {
    const logger = createJsonLogger({ level: 'silent' });

    expect(logger.level).toBe('silent');
  });

  it('creates isolated Prometheus registries without service metrics', async () => {
    const firstRegistry = createPrometheusRegistry();
    const secondRegistry = createPrometheusRegistry();

    expect(firstRegistry).toBeInstanceOf(Registry);
    expect(secondRegistry).not.toBe(firstRegistry);
    expect((await firstRegistry.metrics()).trim()).toBe('');
  });

  it('registers shared service metrics once with bounded label names', async () => {
    const registry = createPrometheusRegistry();
    const first = createServiceMetrics(registry);
    const second = createServiceMetrics(registry);

    expect(second).toBe(first);
    first.httpRequests.inc({
      service: 'test-service',
      method: 'GET',
      route: '/items/:id',
      status_code: '200',
    });
    first.httpRequestDuration.observe(
      { service: 'test-service', method: 'GET', route: '/items/:id' },
      0.01,
    );
    first.readiness.set({ service: 'test-service', dependency: 'database' }, 1);

    const output = await registry.metrics();
    expect(output.match(/# HELP fiap_x_http_requests_total/g)).toHaveLength(1);
    expect(output).toContain(
      'fiap_x_http_requests_total{service="test-service",method="GET",route="/items/:id",status_code="200"} 1',
    );
    expect(output).toContain('fiap_x_readiness{service="test-service",dependency="database"} 1');
    expect(output).not.toMatch(/userId|videoId|eventId|filename|error_message|url=/u);
  });
});
