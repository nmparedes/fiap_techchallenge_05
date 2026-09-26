import { describe, expect, it } from '@jest/globals';

import { readProcessorServiceConfig } from './config.js';

const environment = {
  RABBITMQ_URL: 'amqp://localhost:5672',
  VIDEO_STORAGE_ROOT: '/srv/fiap-x/storage',
};

describe('readProcessorServiceConfig', () => {
  it('uses bounded defaults', () => {
    expect(readProcessorServiceConfig(environment)).toEqual({
      port: 3003,
      rabbitMq: { url: 'amqp://localhost:5672' },
      storageRoot: '/srv/fiap-x/storage',
      prefetch: 1,
      shutdownTimeoutMs: 10_000,
    });
  });

  it('reads explicit values', () => {
    expect(
      readProcessorServiceConfig({
        ...environment,
        PROCESSOR_PORT: '4300',
        PROCESSOR_PREFETCH: '1',
        PROCESSOR_SHUTDOWN_TIMEOUT_MS: '2500',
      }),
    ).toMatchObject({ port: 4300, prefetch: 1, shutdownTimeoutMs: 2500 });
  });

  it('rejects missing required values and out-of-range integers', () => {
    expect(() => readProcessorServiceConfig({ ...environment, RABBITMQ_URL: undefined })).toThrow(
      'RABBITMQ_URL',
    );
    expect(() =>
      readProcessorServiceConfig({ ...environment, VIDEO_STORAGE_ROOT: undefined }),
    ).toThrow('VIDEO_STORAGE_ROOT');
    expect(() => readProcessorServiceConfig({ ...environment, PROCESSOR_PREFETCH: '0' })).toThrow(
      'PROCESSOR_PREFETCH',
    );
    expect(() => readProcessorServiceConfig({ ...environment, PROCESSOR_PREFETCH: '2' })).toThrow(
      'PROCESSOR_PREFETCH',
    );
  });
});
