import { describe, expect, it, jest } from '@jest/globals';

import {
  createProcessorServiceRuntime,
  type ClosableResource,
  type HttpServer,
} from './runtime.js';
import type { ProcessorWorker } from './worker.js';

function createFixture(overrides: { worker?: ProcessorWorker; timeout?: number } = {}) {
  const order: string[] = [];
  const app = {
    listen: jest.fn<HttpServer['listen']>(async () => {
      order.push('listen');
    }),
    close: jest.fn<HttpServer['close']>(async () => {
      order.push('http');
    }),
  } satisfies HttpServer;
  const worker =
    overrides.worker ??
    ({
      stopAccepting: jest.fn(async () => {
        order.push('cancel');
      }),
      waitForIdle: jest.fn(async () => {
        order.push('idle');
      }),
    } satisfies ProcessorWorker);
  const resource = (name: string): ClosableResource => ({
    close: jest.fn<ClosableResource['close']>(async () => {
      order.push(name);
    }),
  });
  const consumerChannel = resource('consumer');
  const publisherChannel = resource('publisher');
  const connection = resource('connection');
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const runtime = createProcessorServiceRuntime({
    app,
    worker,
    consumerChannel,
    publisherChannel,
    connection,
    logger,
    port: 3003,
    shutdownTimeoutMs: overrides.timeout ?? 1_000,
  });

  return {
    runtime,
    app,
    worker,
    consumerChannel,
    publisherChannel,
    connection,
    logger,
    order,
  };
}

describe('Processor Service runtime', () => {
  it('starts the internal HTTP server', async () => {
    const fixture = createFixture();

    await fixture.runtime.start();

    expect(fixture.app.listen).toHaveBeenCalledWith({ host: '0.0.0.0', port: 3003 });
  });

  it('stops deliveries, waits for the active job, and closes every resource in order', async () => {
    let finishJob: (() => void) | undefined;
    const order: string[] = [];
    const worker: ProcessorWorker = {
      stopAccepting: jest.fn(async () => {
        order.push('cancel');
      }),
      waitForIdle: jest.fn(
        async () =>
          new Promise<void>((resolve) => {
            order.push('wait');
            finishJob = resolve;
          }),
      ),
    };
    const fixture = createFixture({ worker });
    const closeOrder = fixture.order;

    const shutdown = fixture.runtime.shutdown('SIGTERM');
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });

    expect(order).toEqual(['cancel', 'wait']);
    expect(closeOrder).toEqual([]);
    finishJob?.();
    await shutdown;

    expect(closeOrder).toEqual(['consumer', 'publisher', 'connection', 'http']);
    expect(fixture.logger.info).toHaveBeenLastCalledWith(
      { event: 'shutdown_completed', signal: 'SIGTERM', outcome: 'drained' },
      'Shutdown completed',
    );
  });

  it('respects the drain timeout and still closes every resource', async () => {
    jest.useFakeTimers();
    try {
      const worker: ProcessorWorker = {
        stopAccepting: jest.fn(async () => undefined),
        waitForIdle: jest.fn(async () => new Promise<void>(() => undefined)),
      };
      const fixture = createFixture({ worker, timeout: 25 });

      const shutdown = fixture.runtime.shutdown('SIGINT');
      await jest.advanceTimersByTimeAsync(25);
      await shutdown;

      expect(fixture.order).toEqual(['consumer', 'publisher', 'connection', 'http']);
      expect(fixture.logger.warn).toHaveBeenCalledWith(
        { event: 'shutdown_drain_timed_out', timeoutMs: 25 },
        'Shutdown job drain timed out',
      );
      expect(fixture.logger.info).toHaveBeenLastCalledWith(
        { event: 'shutdown_completed', signal: 'SIGINT', outcome: 'timed_out' },
        'Shutdown completed',
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('runs shutdown once and continues closing after cancellation or close failures', async () => {
    const fixture = createFixture();
    jest.mocked(fixture.worker.stopAccepting).mockRejectedValueOnce(new Error('cancel failed'));
    jest.mocked(fixture.consumerChannel.close).mockRejectedValueOnce(new Error('close failed'));

    await Promise.all([fixture.runtime.shutdown('SIGTERM'), fixture.runtime.shutdown('SIGINT')]);

    expect(fixture.worker.stopAccepting).toHaveBeenCalledTimes(1);
    expect(fixture.connection.close).toHaveBeenCalledTimes(1);
    expect(fixture.app.close).toHaveBeenCalledTimes(1);
    expect(fixture.logger.error).toHaveBeenCalledTimes(2);
  });
});
