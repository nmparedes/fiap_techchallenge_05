import { describe, expect, it } from '@jest/globals';

import { readAuthServiceConfig } from './config.js';

const requiredEnvironment = {
  AUTH_JWT_SECRET: 'a-secure-test-secret-that-is-32-bytes-minimum',
  MYSQL_HOST: '127.0.0.1',
  MYSQL_PORT: '3306',
  MYSQL_USERNAME: 'auth_service',
  MYSQL_PASSWORD: 'secret',
  MYSQL_CONNECTION_LIMIT: '10',
  MYSQL_SSL: 'false',
};

describe('readAuthServiceConfig', () => {
  it('uses safe service defaults and fixes database ownership to auth_db', () => {
    expect(readAuthServiceConfig(requiredEnvironment)).toEqual({
      host: '0.0.0.0',
      port: 3001,
      jwt: {
        secret: requiredEnvironment.AUTH_JWT_SECRET,
        expiresInSeconds: 3600,
        issuer: 'fiap-x-auth-service',
        audience: 'fiap-x-api',
      },
      mysql: {
        host: '127.0.0.1',
        port: 3306,
        username: 'auth_service',
        password: 'secret',
        connectionLimit: 10,
        ssl: false,
        database: 'auth_db',
      },
    });
  });

  it('reads explicit HTTP and JWT settings', () => {
    const config = readAuthServiceConfig({
      ...requiredEnvironment,
      AUTH_HOST: '127.0.0.1',
      AUTH_PORT: '4100',
      AUTH_JWT_EXPIRES_IN_SECONDS: '3600',
      AUTH_JWT_ISSUER: 'custom-issuer',
      AUTH_JWT_AUDIENCE: 'custom-audience',
    });

    expect(config.host).toBe('127.0.0.1');
    expect(config.port).toBe(4100);
    expect(config.jwt).toMatchObject({
      expiresInSeconds: 3600,
      issuer: 'custom-issuer',
      audience: 'custom-audience',
    });
  });

  it('rejects missing or short JWT secrets', () => {
    expect(() =>
      readAuthServiceConfig({ ...requiredEnvironment, AUTH_JWT_SECRET: undefined }),
    ).toThrow('Invalid environment variable AUTH_JWT_SECRET');
    expect(() =>
      readAuthServiceConfig({ ...requiredEnvironment, AUTH_JWT_SECRET: 'too-short' }),
    ).toThrow('must contain at least 32 bytes');
  });

  it('rejects token lifetimes outside the configured bounds', () => {
    expect(() =>
      readAuthServiceConfig({ ...requiredEnvironment, AUTH_JWT_EXPIRES_IN_SECONDS: '59' }),
    ).toThrow('must be at least 60');
    expect(() =>
      readAuthServiceConfig({ ...requiredEnvironment, AUTH_JWT_EXPIRES_IN_SECONDS: '86401' }),
    ).toThrow('must be at most 86400');
  });
});
