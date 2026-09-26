import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { createAuthTokenVerifier, type UserRecord } from '@fiap-x/infrastructure';
import { createJsonLogger, createPrometheusRegistry } from '@fiap-x/observability';
import type { FastifyInstance } from 'fastify';
import { Writable } from 'node:stream';

import { buildAuthService } from './app.js';
import type { PasswordVerifier } from './authenticate-user.js';
import { UserRepositoryUnavailableError, type UserRepository } from './user-repository.js';

const testUser: UserRecord = {
  id: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
  username: 'john.doe',
  displayName: 'John Doe',
  passwordHash: '$2b$12$stored',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

const jwtConfig = {
  secret: 'a-secure-test-secret-that-is-32-bytes-minimum',
  expiresInSeconds: 3600,
  issuer: 'fiap-x-auth-service',
  audience: 'fiap-x-api',
};

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

function createRepository(user: UserRecord | null = testUser): UserRepository {
  return {
    findByUsername: jest.fn(async () => user),
    ping: jest.fn(async () => undefined),
  };
}

async function createTestApp(
  userRepository: UserRepository = createRepository(),
  verifyPassword: PasswordVerifier = jest.fn(async () => true),
) {
  app = await buildAuthService({ userRepository, verifyPassword, jwt: jwtConfig });
  await app.ready();
  return app;
}

describe('auth service HTTP API', () => {
  it('reports process health and database readiness', async () => {
    const repository = createRepository();
    const server = await createTestApp(repository);

    const health = await server.inject({ method: 'GET', url: '/health/live' });
    const ready = await server.inject({ method: 'GET', url: '/health/ready' });

    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({
      success: true,
      data: { service: 'auth-service', status: 'ok' },
    });
    expect(ready.statusCode).toBe(200);
    expect(repository.ping).toHaveBeenCalledTimes(1);
  });

  it('reports failed database readiness without exposing its error', async () => {
    const repository = createRepository();
    jest.mocked(repository.ping).mockRejectedValueOnce(new Error('connection details'));
    const server = await createTestApp(repository);

    const response = await server.inject({ method: 'GET', url: '/health/ready' });
    const metrics = await server.inject({ method: 'GET', url: '/metrics' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      success: false,
      error: { code: 'SERVICE_UNAVAILABLE', message: 'The database is unavailable' },
    });
    expect(response.body).not.toContain('connection details');
    expect(metrics.body).toContain('fiap_x_readiness{service="auth-service",dependency="mysql"} 0');
  });

  it('issues a signed short-lived JWT for valid credentials', async () => {
    const verifyPassword = jest.fn<PasswordVerifier>(async () => true);
    const server = await createTestApp(createRepository(), verifyPassword);

    const response = await server.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: 'john.doe', password: 'JohnDoe123!' },
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body).toMatchObject({
      success: true,
      data: {
        tokenType: 'Bearer',
        expiresIn: 3600,
        user: {
          id: testUser.id,
          username: 'john.doe',
          displayName: 'John Doe',
        },
      },
    });
    expect(typeof body.data.accessToken).toBe('string');
    const token = createAuthTokenVerifier(jwtConfig)(body.data.accessToken);
    expect(token).toMatchObject({
      sub: testUser.id,
      username: 'john.doe',
      iss: jwtConfig.issuer,
      aud: jwtConfig.audience,
    });
    expect(token.exp - token.iat).toBe(3600);
    expect(token).not.toHaveProperty('displayName');
    expect(verifyPassword).toHaveBeenCalledWith('JohnDoe123!', testUser.passwordHash);
    expect(response.body).not.toContain('JohnDoe123!');
    expect(response.body).not.toContain(testUser.passwordHash);
  });

  it('returns the same response for an unknown user and an incorrect password', async () => {
    const incorrectPasswordServer = await createTestApp(
      createRepository(),
      jest.fn(async () => false),
    );
    const incorrectPassword = await incorrectPasswordServer.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: 'john.doe', password: 'wrong' },
    });
    await incorrectPasswordServer.close();

    app = await buildAuthService({
      userRepository: createRepository(null),
      verifyPassword: jest.fn(async () => false),
      jwt: jwtConfig,
    });
    await app.ready();
    const unknownUser = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: 'unknown', password: 'wrong' },
    });

    expect(incorrectPassword.statusCode).toBe(401);
    expect(unknownUser.statusCode).toBe(401);
    expect(unknownUser.json()).toEqual(incorrectPassword.json());
  });

  it('rejects malformed login requests before querying MySQL', async () => {
    const repository = createRepository();
    const server = await createTestApp(repository);

    const response = await server.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: 'ab', password: '' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      success: false,
      error: { code: 'INVALID_REQUEST', message: 'Request validation failed' },
    });
    expect(repository.findByUsername).not.toHaveBeenCalled();
  });

  it('sanitizes unexpected authentication failures', async () => {
    const repository = createRepository();
    jest.mocked(repository.findByUsername).mockRejectedValueOnce(new Error('sensitive SQL error'));
    const server = await createTestApp(repository);

    const response = await server.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: 'john.doe', password: 'password' },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
    });
    expect(response.body).not.toContain('sensitive SQL error');
  });

  it('reports MySQL unavailability consistently during login', async () => {
    const repository = createRepository();
    jest
      .mocked(repository.findByUsername)
      .mockRejectedValueOnce(new UserRepositoryUnavailableError());
    const server = await createTestApp(repository);

    const response = await server.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: 'john.doe', password: 'password' },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      success: false,
      error: { code: 'SERVICE_UNAVAILABLE', message: 'The database is unavailable' },
    });
  });

  it('publishes Prometheus authentication and HTTP metrics', async () => {
    const registry = createPrometheusRegistry();
    const verifyPassword = jest
      .fn<PasswordVerifier>()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    app = await buildAuthService({
      userRepository: createRepository(),
      verifyPassword,
      jwt: jwtConfig,
      registry,
    });
    await app.ready();
    await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: 'john.doe', password: 'password' },
    });
    await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username: 'john.doe', password: 'wrong-password' },
    });
    await app.inject({ method: 'GET', url: '/health/ready' });

    const response = await app.inject({
      method: 'GET',
      url: '/metrics',
      headers: { authorization: 'Bearer malformed-token' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/plain');
    expect(response.body).toContain('fiap_x_auth_login_attempts_total{outcome="success"} 1');
    expect(response.body).toContain('fiap_x_auth_login_attempts_total{outcome="failure"} 1');
    expect(response.body).toContain(
      'fiap_x_http_requests_total{service="auth-service",method="POST",route="/auth/login",status_code="200"} 1',
    );
    expect(response.body).toContain('fiap_x_http_request_duration_seconds');
    expect(response.body).toContain(
      'fiap_x_readiness{service="auth-service",dependency="mysql"} 1',
    );
    expect(response.body).not.toContain('wrong-password');
  });

  it('documents every public route and leaves operations routes unauthenticated', async () => {
    const server = await createTestApp();
    const document = server.swagger();

    expect(document).toMatchObject({
      openapi: '3.1.0',
      info: { title: 'FIAP X Auth Service' },
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
      },
    });
    expect(document.paths).toHaveProperty('/auth/login');
    expect(document.paths).toHaveProperty('/health/live');
    expect(document.paths).toHaveProperty('/health/ready');
    expect(document.paths).toHaveProperty('/metrics');
    expect(document).toMatchObject({
      paths: {
        '/auth/login': {
          post: {
            security: [],
            requestBody: expect.any(Object),
            responses: {
              '200': expect.any(Object),
              '400': expect.any(Object),
              '401': expect.any(Object),
              '500': expect.any(Object),
              '503': expect.any(Object),
            },
          },
        },
        '/health/live': { get: { security: [] } },
        '/health/ready': { get: { security: [] } },
        '/metrics': { get: { security: [], responses: { '200': expect.any(Object) } } },
      },
    });

    const docsAtCanonicalPath = await server.inject({ method: 'GET', url: '/docs' });
    const docs = await server.inject({ method: 'GET', url: '/docs/' });
    expect(docsAtCanonicalPath.statusCode).toBe(200);
    expect(docsAtCanonicalPath.headers['content-type']).toContain('text/html');
    expect(docs.statusCode).toBe(200);
    expect(docs.headers['content-type']).toContain('text/html');
  });

  it('emits JSON authentication logs without the password, hash, or token', async () => {
    let output = '';
    const destination = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        output += chunk.toString('utf8');
        callback();
      },
    });
    app = await buildAuthService({
      userRepository: createRepository(),
      verifyPassword: jest.fn(async () => true),
      jwt: jwtConfig,
      logger: createJsonLogger({ name: 'auth-service-test', destination }),
    });
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      headers: { 'x-request-id': 'auth-request-correlation' },
      payload: { username: 'john.doe', password: 'never-log-this-password' },
    });
    const accessToken = String(response.json().data.accessToken);

    const records = output
      .trim()
      .split('\n')
      .map(
        (line) =>
          JSON.parse(line) as {
            event?: string;
            correlationId?: string;
            method?: string;
            route?: string;
            status?: number;
            durationMs?: number;
          },
      );
    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'authentication_succeeded',
          correlationId: response.headers['x-request-id'],
        }),
        expect.objectContaining({
          event: 'http_request_completed',
          correlationId: response.headers['x-request-id'],
          method: 'POST',
          route: '/auth/login',
          status: 200,
          durationMs: expect.any(Number),
        }),
      ]),
    );
    expect(response.headers['x-request-id']).toBe('auth-request-correlation');
    expect(output).not.toContain('never-log-this-password');
    expect(output).not.toContain(testUser.passwordHash);
    expect(output).not.toContain(accessToken);
  });
});
