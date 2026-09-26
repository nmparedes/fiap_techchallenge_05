import { randomUUID } from 'node:crypto';

import type { Channel, ChannelModel } from 'amqplib';
import type { FastifyInstance } from 'fastify';
import {
  assertVideoEventTopology,
  connectRabbitMq,
  createAuthTokenVerifier,
  createMySqlPool,
} from '@fiap-x/infrastructure';
import { createJsonLogger, createPrometheusRegistry } from '@fiap-x/observability';

import { buildNotificationService } from './app.js';
import { readNotificationServiceConfig } from './config.js';
import { FailureNotificationHandler } from './failure-notification-handler.js';
import { createNotificationServiceMetrics } from './metrics.js';
import { MySqlNotificationRepository } from './notification-repository.js';
import { createMySqlReadinessCheck, createRabbitMqReadinessCheck } from './readiness.js';
import { createNotificationServiceRuntime, type NotificationServiceRuntime } from './runtime.js';
import { startNotificationWorker } from './worker.js';

const config = readNotificationServiceConfig();
const logger = createJsonLogger({ service: 'notification-service' });
const registry = createPrometheusRegistry();
const metrics = createNotificationServiceMetrics(registry);
const pool = createMySqlPool(config.mysql);
const repository = new MySqlNotificationRepository(pool);
let connection: ChannelModel | undefined;
let channel: Channel | undefined;
let app: FastifyInstance | undefined;
let runtime: NotificationServiceRuntime | undefined;

async function closeStartupResources(): Promise<void> {
  await Promise.allSettled([channel?.close(), connection?.close(), app?.close(), pool.end()]);
}

try {
  connection = await connectRabbitMq(config.rabbitMq);
  channel = await connection.createChannel();
  await assertVideoEventTopology(channel);

  const handler = new FailureNotificationHandler({
    repository,
    createId: randomUUID,
    logger,
    metrics,
  });
  const worker = await startNotificationWorker({
    channel,
    handler,
    onInvalidMessage: () => {
      metrics.notificationsConsumed.inc({ outcome: 'failed' });
      logger.warn(
        { event: 'invalid_processing_failure', outcome: 'dead_lettered' },
        'Invalid processing failure dead-lettered',
      );
    },
  });
  app = await buildNotificationService({
    repository,
    readiness: {
      mysql: createMySqlReadinessCheck(pool),
      rabbitMq: createRabbitMqReadinessCheck(connection),
    },
    verifyToken: createAuthTokenVerifier(config.jwt),
    pagination: config.pagination,
    logger,
    registry,
    metrics,
  });
  runtime = createNotificationServiceRuntime({
    app,
    worker,
    consumerChannel: channel,
    connection,
    database: { close: async () => pool.end() },
    logger,
    port: config.port,
  });

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void runtime?.shutdown(signal);
    });
  }

  await runtime.start();
  logger.info({ event: 'startup_completed', port: config.port }, 'Service started');
} catch (error) {
  logger.fatal({ err: error, event: 'startup_failed' }, 'Startup failed');
  await closeStartupResources();
  process.exitCode = 1;
}
