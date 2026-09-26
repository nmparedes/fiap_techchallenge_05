import { describe, expect, it, jest } from '@jest/globals';

import {
  createNotificationServiceRuntime,
  type ClosableResource,
  type HttpServer,
} from './runtime.js';
import type { NotificationWorker } from './worker.js';

function createFixture() {
  const order: string[] = [];
  const app = {
    listen: jest.fn<HttpServer['listen']>(async () => {
      order.push('listen');
    }),
    close: jest.fn<HttpServer['close']>(async () => {
      order.push('http');
    }),
  } satisfies HttpServer;
  const worker: NotificationWorker = {
    stopAccepting: jest.fn(async () => {
      order.push('cancel');
    }),
    waitForIdle: jest.fn(async () => {
      order.push('idle');
    }),
  };
  const resource = (name: string): ClosableResource => ({
    close: jest.fn(async () => {
      order.push(name);
    }),
  });
  const consumerChannel = resource('channel');
  const connection = resource('connection');
  const database = resource('database');
  const logger = { info: jest.fn(), error: jest.fn() };
  const runtime = createNotificationServiceRuntime({
    app,
    worker,
    consumerChannel,
    connection,
    database,
    logger,
    port: 3004,
  });

  return { runtime, app, worker, consumerChannel, connection, database, logger, order };
}

describe('Notification Service runtime', () => {
  it('starts the HTTP server on the configured port', async () => {
    const fixture = createFixture();

    await fixture.runtime.start();

    expect(fixture.app.listen).toHaveBeenCalledWith({ host: '0.0.0.0', port: 3004 });
  });

  it('cancels and drains the consumer before closing all resources', async () => {
    const fixture = createFixture();

    await fixture.runtime.shutdown('SIGTERM');

    expect(fixture.order).toEqual(['cancel', 'idle', 'channel', 'connection', 'http', 'database']);
    expect(fixture.logger.info).toHaveBeenLastCalledWith(
      { event: 'shutdown_completed', signal: 'SIGTERM' },
      'Shutdown completed',
    );
  });

  it('runs shutdown once and continues when cancellation or resource close fails', async () => {
    const fixture = createFixture();
    jest.mocked(fixture.worker.stopAccepting).mockRejectedValueOnce(new Error('cancel failed'));
    jest.mocked(fixture.consumerChannel.close).mockRejectedValueOnce(new Error('close failed'));

    await Promise.all([fixture.runtime.shutdown('SIGINT'), fixture.runtime.shutdown('SIGTERM')]);

    expect(fixture.worker.stopAccepting).toHaveBeenCalledTimes(1);
    expect(fixture.connection.close).toHaveBeenCalledTimes(1);
    expect(fixture.database.close).toHaveBeenCalledTimes(1);
    expect(fixture.logger.error).toHaveBeenCalledTimes(2);
  });
});
