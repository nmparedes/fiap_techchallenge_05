import { describe, expect, it } from '@jest/globals';

import { readNotificationServiceConfig } from './config.js';

const environment = {
  AUTH_JWT_SECRET: 'a-secure-test-secret-that-is-32-bytes-minimum',
  MYSQL_HOST: '127.0.0.1',
  MYSQL_PORT: '3306',
  MYSQL_USERNAME: 'notification_service',
  MYSQL_PASSWORD: 'secret',
  MYSQL_CONNECTION_LIMIT: '10',
  MYSQL_SSL: 'false',
  RABBITMQ_URL: 'amqp://localhost:5672',
};

describe('readNotificationServiceConfig', () => {
  it('uses bounded defaults and fixes database ownership to notification_db', () => {
    expect(readNotificationServiceConfig(environment)).toEqual({
      port: 3004,
      mysql: {
        host: '127.0.0.1',
        port: 3306,
        username: 'notification_service',
        password: 'secret',
        connectionLimit: 10,
        ssl: false,
        database: 'notification_db',
      },
      rabbitMq: { url: 'amqp://localhost:5672' },
      jwt: {
        secret: environment.AUTH_JWT_SECRET,
        issuer: 'fiap-x-auth-service',
        audience: 'fiap-x-api',
      },
      pagination: { defaultPageSize: 20, maximumPageSize: 100 },
    });
  });

  it('reads explicit service, JWT, and pagination values', () => {
    expect(
      readNotificationServiceConfig({
        ...environment,
        NOTIFICATION_PORT: '4300',
        NOTIFICATION_DEFAULT_PAGE_SIZE: '25',
        NOTIFICATION_MAXIMUM_PAGE_SIZE: '50',
        AUTH_JWT_ISSUER: 'issuer',
        AUTH_JWT_AUDIENCE: 'audience',
      }),
    ).toMatchObject({
      port: 4300,
      jwt: { issuer: 'issuer', audience: 'audience' },
      pagination: { defaultPageSize: 25, maximumPageSize: 50 },
    });
  });

  it.each([
    [{ ...environment, AUTH_JWT_SECRET: 'short' }, 'AUTH_JWT_SECRET'],
    [{ ...environment, RABBITMQ_URL: undefined }, 'RABBITMQ_URL'],
    [{ ...environment, NOTIFICATION_PORT: '0' }, 'NOTIFICATION_PORT'],
    [{ ...environment, NOTIFICATION_MAXIMUM_PAGE_SIZE: '101' }, 'NOTIFICATION_MAXIMUM_PAGE_SIZE'],
    [
      {
        ...environment,
        NOTIFICATION_DEFAULT_PAGE_SIZE: '51',
        NOTIFICATION_MAXIMUM_PAGE_SIZE: '50',
      },
      'NOTIFICATION_DEFAULT_PAGE_SIZE',
    ],
  ] as const)('rejects invalid required or bounded configuration', (input, variableName) => {
    expect(() => readNotificationServiceConfig(input)).toThrow(variableName);
  });
});
