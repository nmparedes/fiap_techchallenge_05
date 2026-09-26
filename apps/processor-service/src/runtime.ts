import type { JsonLogger } from '@fiap-x/observability';

import type { ProcessorWorker } from './worker.js';

export interface HttpServer {
  listen(options: { host: string; port: number }): Promise<unknown>;
  close(): Promise<unknown>;
}

export interface ClosableResource {
  close(): Promise<unknown>;
}

export interface ProcessorServiceRuntimeOptions {
  app: HttpServer;
  worker: ProcessorWorker;
  consumerChannel: ClosableResource;
  publisherChannel: ClosableResource;
  connection: ClosableResource;
  logger: Pick<JsonLogger, 'info' | 'warn' | 'error'>;
  port: number;
  shutdownTimeoutMs: number;
}

export interface ProcessorServiceRuntime {
  start(): Promise<void>;
  shutdown(signal: NodeJS.Signals): Promise<void>;
}

export function createProcessorServiceRuntime(
  options: ProcessorServiceRuntimeOptions,
): ProcessorServiceRuntime {
  let shutdownPromise: Promise<void> | undefined;

  async function closeResource(name: string, resource: ClosableResource): Promise<void> {
    try {
      await resource.close();
    } catch (error) {
      options.logger.error(
        {
          event: 'shutdown_resource_failed',
          resource: name,
          errorName: error instanceof Error ? error.name : 'UnknownError',
        },
        'Shutdown resource close failed',
      );
    }
  }

  async function waitForIdle(): Promise<boolean> {
    let timeout: NodeJS.Timeout | undefined;
    const deadline = new Promise<false>((resolve) => {
      timeout = setTimeout(() => resolve(false), options.shutdownTimeoutMs);
      timeout.unref();
    });

    try {
      return await Promise.race([options.worker.waitForIdle().then(() => true as const), deadline]);
    } finally {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
    }
  }

  async function performShutdown(signal: NodeJS.Signals): Promise<void> {
    options.logger.info({ event: 'shutdown_started', signal }, 'Shutdown started');
    try {
      await options.worker.stopAccepting();
    } catch (error) {
      options.logger.error(
        {
          event: 'consumer_cancel_failed',
          errorName: error instanceof Error ? error.name : 'UnknownError',
        },
        'Consumer cancellation failed',
      );
    }

    const drained = await waitForIdle();
    if (!drained) {
      options.logger.warn(
        { event: 'shutdown_drain_timed_out', timeoutMs: options.shutdownTimeoutMs },
        'Shutdown job drain timed out',
      );
    }

    await closeResource('consumer_channel', options.consumerChannel);
    await closeResource('publisher_channel', options.publisherChannel);
    await closeResource('rabbitmq_connection', options.connection);
    await closeResource('http_server', options.app);
    options.logger.info(
      { event: 'shutdown_completed', signal, outcome: drained ? 'drained' : 'timed_out' },
      'Shutdown completed',
    );
  }

  return {
    start: async () => {
      await options.app.listen({ host: '0.0.0.0', port: options.port });
    },
    shutdown: async (signal) => {
      if (shutdownPromise === undefined) {
        shutdownPromise = performShutdown(signal);
      }
      await shutdownPromise;
    },
  };
}
