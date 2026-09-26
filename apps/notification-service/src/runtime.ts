import type { JsonLogger } from '@fiap-x/observability';

import type { NotificationWorker } from './worker.js';

export interface HttpServer {
  listen(options: { host: string; port: number }): Promise<unknown>;
  close(): Promise<unknown>;
}

export interface ClosableResource {
  close(): Promise<unknown>;
}

export interface NotificationServiceRuntimeOptions {
  app: HttpServer;
  worker: NotificationWorker;
  consumerChannel: ClosableResource;
  connection: ClosableResource;
  database: ClosableResource;
  logger: Pick<JsonLogger, 'info' | 'error'>;
  port: number;
}

export interface NotificationServiceRuntime {
  start(): Promise<void>;
  shutdown(signal: NodeJS.Signals): Promise<void>;
}

export function createNotificationServiceRuntime(
  options: NotificationServiceRuntimeOptions,
): NotificationServiceRuntime {
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

    await options.worker.waitForIdle();
    await closeResource('consumer_channel', options.consumerChannel);
    await closeResource('rabbitmq_connection', options.connection);
    await closeResource('http_server', options.app);
    await closeResource('mysql_pool', options.database);
    options.logger.info({ event: 'shutdown_completed', signal }, 'Shutdown completed');
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
