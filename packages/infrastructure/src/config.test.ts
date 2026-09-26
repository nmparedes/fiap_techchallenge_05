import { describe, expect, it } from '@jest/globals';

import {
  readMySqlConfig,
  readMySqlServerConfig,
  readRabbitMqConfig,
  readRedisConfig,
} from './config.js';

describe('infrastructure configuration', () => {
  it('reads the complete MySQL configuration', () => {
    expect(
      readMySqlConfig({
        MYSQL_HOST: 'mysql.internal',
        MYSQL_PORT: '3306',
        MYSQL_USERNAME: 'video_service',
        MYSQL_PASSWORD: 'secret',
        MYSQL_DATABASE: 'video_db',
        MYSQL_CONNECTION_LIMIT: '12',
        MYSQL_SSL: 'true',
      }),
    ).toEqual({
      host: 'mysql.internal',
      port: 3306,
      username: 'video_service',
      password: 'secret',
      database: 'video_db',
      connectionLimit: 12,
      ssl: true,
    });
  });

  it('reads server configuration without requiring a selected database', () => {
    expect(
      readMySqlServerConfig({
        MYSQL_HOST: 'mysql.internal',
        MYSQL_PORT: '3306',
        MYSQL_USERNAME: 'migration_user',
        MYSQL_PASSWORD: 'secret',
        MYSQL_CONNECTION_LIMIT: '4',
        MYSQL_SSL: 'false',
      }),
    ).toEqual({
      host: 'mysql.internal',
      port: 3306,
      username: 'migration_user',
      password: 'secret',
      connectionLimit: 4,
      ssl: false,
    });
  });

  it('reads Redis and RabbitMQ URLs without exposing defaults', () => {
    expect(readRedisConfig({ REDIS_URL: 'redis://cache.internal:6379' })).toEqual({
      url: 'redis://cache.internal:6379',
    });
    expect(readRabbitMqConfig({ RABBITMQ_URL: 'amqp://broker.internal:5672' })).toEqual({
      url: 'amqp://broker.internal:5672',
    });
  });
});
