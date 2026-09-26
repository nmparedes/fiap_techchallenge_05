import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import type { Channel, ChannelModel, ConfirmChannel } from 'amqplib';
import type { FastifyInstance } from 'fastify';
import { assertVideoEventTopology, connectRabbitMq } from '@fiap-x/infrastructure';
import { createJsonLogger, createPrometheusRegistry } from '@fiap-x/observability';

import { buildProcessorService } from './app.js';
import { LocalCompletedArchiveLookup } from './completed-archive.js';
import { readProcessorServiceConfig } from './config.js';
import { NodeFfmpegRunner } from './ffmpeg.js';
import { createProcessorServiceMetrics } from './metrics.js';
import { VideoProcessingAttempt } from './processing-attempt.js';
import { ProcessingEventHandler } from './processing-event-handler.js';
import { RabbitMqProcessingStatusPublisher } from './processing-event-publisher.js';
import {
  createFfmpegReadinessCheck,
  createRabbitMqReadinessCheck,
  createStorageReadinessCheck,
} from './readiness.js';
import { createProcessorServiceRuntime, type ProcessorServiceRuntime } from './runtime.js';
import { startProcessorWorker } from './worker.js';
import { StoredZipCreator } from './zip.js';

const config = readProcessorServiceConfig();
const logger = createJsonLogger({ service: 'processor-service' });

async function bootstrap(): Promise<ProcessorServiceRuntime> {
  let connection: ChannelModel | undefined;
  let publisherChannel: ConfirmChannel | undefined;
  let consumerChannel: Channel | undefined;
  let app: FastifyInstance | undefined;

  try {
    connection = await connectRabbitMq(config.rabbitMq);
    publisherChannel = await connection.createConfirmChannel();
    consumerChannel = await connection.createChannel();
    await assertVideoEventTopology(publisherChannel);

    const registry = createPrometheusRegistry();
    const metrics = createProcessorServiceMetrics(registry);
    app = await buildProcessorService({
      readiness: {
        rabbitMq: createRabbitMqReadinessCheck(connection),
        storage: createStorageReadinessCheck(config.storageRoot),
        ffmpeg: createFfmpegReadinessCheck(),
      },
      logger,
      registry,
      metrics,
    });
    const processor = new VideoProcessingAttempt({
      ffmpeg: new NodeFfmpegRunner(),
      zip: new StoredZipCreator(),
    });
    const handler = new ProcessingEventHandler({
      processor,
      publisher: new RabbitMqProcessingStatusPublisher(publisherChannel),
      completedArchives: new LocalCompletedArchiveLookup(),
      metrics,
      logger,
      storageRoot: config.storageRoot,
      createId: randomUUID,
      now: () => new Date(),
      clock: () => performance.now(),
    });
    const worker = await startProcessorWorker({
      channel: consumerChannel,
      handler,
      prefetch: config.prefetch,
      onInvalidMessage: () => {
        logger.warn(
          { event: 'invalid_processing_request', outcome: 'dead_lettered' },
          'Invalid processing request dead-lettered',
        );
      },
    });

    return createProcessorServiceRuntime({
      app,
      worker,
      consumerChannel,
      publisherChannel,
      connection,
      logger,
      port: config.port,
      shutdownTimeoutMs: config.shutdownTimeoutMs,
    });
  } catch (error) {
    await Promise.allSettled([
      app?.close(),
      consumerChannel?.close(),
      publisherChannel?.close(),
      connection?.close(),
    ]);
    throw error;
  }
}

let runtime: ProcessorServiceRuntime | undefined;

try {
  runtime = await bootstrap();

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void runtime?.shutdown(signal);
    });
  }

  await runtime.start();
  logger.info({ event: 'startup_completed', port: config.port }, 'Service started');
} catch (error) {
  logger.fatal({ err: error, event: 'startup_failed' }, 'Startup failed');
  await runtime?.shutdown('SIGTERM');
  process.exitCode = 1;
}
