import { randomUUID } from 'node:crypto';

import type { Channel, ChannelModel, ConfirmChannel } from 'amqplib';
import type { FastifyInstance } from 'fastify';
import {
  assertVideoEventTopology,
  connectRabbitMq,
  consumeProcessingStatusEvents,
  createAuthTokenVerifier,
  createMySqlPool,
  createRedisConnection,
  type VideoCacheClient,
} from '@fiap-x/infrastructure';
import { createJsonLogger, createPrometheusRegistry } from '@fiap-x/observability';

import { buildVideoService } from './app.js';
import { readVideoServiceConfig } from './config.js';
import { createVideoServiceMetrics } from './metrics.js';
import { RabbitMqProcessingRequestPublisher } from './processing-publisher.js';
import { ProcessingStatusEventHandler } from './status-event-handler.js';
import { MAX_VIDEO_UPLOAD_BYTES } from './upload-policy.js';
import { LocalVideoFileStore } from './video-files.js';
import { MySqlVideoRepository } from './video-repository.js';
import { VideoApplicationService } from './video-service.js';

const config = readVideoServiceConfig();
const logger = createJsonLogger({ service: 'video-service' });
const registry = createPrometheusRegistry();
const metrics = createVideoServiceMetrics(registry);
const pool = createMySqlPool(config.mysql);
const redis = createRedisConnection(config.redis);
const repository = new MySqlVideoRepository(pool);
const files = new LocalVideoFileStore();
let rabbitConnection: ChannelModel | undefined;
let publisherChannel: ConfirmChannel | undefined;
let consumerChannel: Channel | undefined;
let app: FastifyInstance | undefined;
let shuttingDown = false;

const noOpCache: VideoCacheClient = {
  get: async () => null,
  setEx: async () => undefined,
  del: async () => undefined,
};

async function closeResources(): Promise<void> {
  await Promise.allSettled([
    app?.close(),
    consumerChannel?.close(),
    publisherChannel?.close(),
    rabbitConnection?.close(),
    pool.end(),
  ]);
  if (redis.isOpen) {
    redis.destroy();
  }
}

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  logger.info({ event: 'shutdown_started', signal }, 'Shutdown started');
  await closeResources();
  logger.info({ event: 'shutdown_completed', signal }, 'Shutdown completed');
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void shutdown(signal);
  });
}

try {
  let cache: VideoCacheClient = noOpCache;
  redis.on('error', (error) => {
    logger.warn({ err: error, event: 'redis_error' }, 'Redis unavailable');
  });
  try {
    await redis.connect();
    cache = redis;
  } catch (error) {
    logger.warn({ err: error, event: 'redis_startup_unavailable' }, 'Starting without Redis cache');
    if (redis.isOpen) {
      redis.destroy();
    }
  }

  rabbitConnection = await connectRabbitMq(config.rabbitMq);
  publisherChannel = await rabbitConnection.createConfirmChannel();
  consumerChannel = await rabbitConnection.createChannel();
  await assertVideoEventTopology(publisherChannel);
  const publisher = new RabbitMqProcessingRequestPublisher(publisherChannel);
  const service = new VideoApplicationService({
    repository,
    cache,
    files,
    publisher,
    storageRoot: config.storageRoot,
    createId: randomUUID,
    now: () => new Date(),
  });
  const statusEventHandler = new ProcessingStatusEventHandler({ service, metrics, logger });
  await consumeProcessingStatusEvents(
    consumerChannel,
    async (event) => statusEventHandler.handle(event),
    {
      requeueOnHandlerError: false,
      onInvalidMessage: () => {
        metrics.statusEvents.inc({ event_type: 'invalid', outcome: 'invalid' });
        logger.warn(
          { event: 'invalid_video_status_event', outcome: 'invalid' },
          'Invalid video status event dead-lettered',
        );
      },
    },
  );
  app = await buildVideoService({
    service,
    repository,
    publisher,
    verifyToken: createAuthTokenVerifier(config.jwt),
    maxUploadBytes: MAX_VIDEO_UPLOAD_BYTES,
    logger,
    registry,
    metrics,
  });
  await app.listen({ host: config.host, port: config.port });
  logger.info(
    { event: 'startup_completed', host: config.host, port: config.port },
    'Service started',
  );
} catch (error) {
  logger.fatal({ err: error, event: 'startup_failed' }, 'Startup failed');
  await closeResources();
  process.exitCode = 1;
}
