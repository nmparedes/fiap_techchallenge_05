import { describe, expect, it } from '@jest/globals';

import { readVideoServiceConfig } from './config.js';

const environment = {
  AUTH_JWT_SECRET: 'a-secure-test-secret-that-is-32-bytes-minimum',
  MYSQL_HOST: '127.0.0.1',
  MYSQL_PORT: '3306',
  MYSQL_USERNAME: 'video_service',
  MYSQL_PASSWORD: 'secret',
  MYSQL_CONNECTION_LIMIT: '10',
  MYSQL_SSL: 'false',
  REDIS_URL: 'redis://localhost:6379',
  RABBITMQ_URL: 'amqp://localhost:5672',
  VIDEO_STORAGE_ROOT: '/srv/fiap-x/storage',
};

describe('readVideoServiceConfig', () => {
  it('uses bounded defaults and fixes database ownership to video_db', () => {
    expect(readVideoServiceConfig(environment)).toEqual({
      host: '0.0.0.0',
      port: 3002,
      storageRoot: '/srv/fiap-x/storage',
      jwt: {
        secret: environment.AUTH_JWT_SECRET,
        issuer: 'fiap-x-auth-service',
        audience: 'fiap-x-api',
      },
      mysql: {
        host: '127.0.0.1',
        port: 3306,
        username: 'video_service',
        password: 'secret',
        connectionLimit: 10,
        ssl: false,
        database: 'video_db',
      },
      redis: { url: 'redis://localhost:6379' },
      rabbitMq: { url: 'amqp://localhost:5672' },
    });
  });

  it('reads explicit HTTP and JWT values', () => {
    const config = readVideoServiceConfig({
      ...environment,
      VIDEO_HOST: '127.0.0.1',
      VIDEO_PORT: '4200',
      AUTH_JWT_ISSUER: 'issuer',
      AUTH_JWT_AUDIENCE: 'audience',
    });

    expect(config).toMatchObject({
      host: '127.0.0.1',
      port: 4200,
      jwt: { issuer: 'issuer', audience: 'audience' },
    });
  });

  it('rejects missing paths and weak secrets', () => {
    expect(() => readVideoServiceConfig({ ...environment, VIDEO_STORAGE_ROOT: undefined })).toThrow(
      'VIDEO_STORAGE_ROOT',
    );
    expect(() => readVideoServiceConfig({ ...environment, AUTH_JWT_SECRET: 'short' })).toThrow(
      'at least 32 bytes',
    );
  });
});
