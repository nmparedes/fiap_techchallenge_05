import { describe, expect, it } from '@jest/globals';
import { createSigner } from 'fast-jwt';

import { createAuthTokenVerifier, InvalidAuthTokenError } from './jwt.js';

const config = {
  secret: 'a-secure-test-secret-that-is-32-bytes-minimum',
  issuer: 'fiap-x-auth-service',
  audience: 'fiap-x-api',
};

const validClaims = {
  sub: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
  username: 'john.doe',
};

function createTestSigner(options: { expiresIn: number; clockTimestamp?: number }) {
  return createSigner({
    key: config.secret,
    algorithm: 'HS256',
    iss: config.issuer,
    aud: config.audience,
    expiresIn: options.expiresIn,
    ...(options.clockTimestamp === undefined ? {} : { clockTimestamp: options.clockTimestamp }),
  });
}

describe('createAuthTokenVerifier', () => {
  it('returns the trusted identity from a valid Auth Service token', () => {
    const token = createTestSigner({ expiresIn: 3600 })(validClaims);

    expect(createAuthTokenVerifier(config)(token)).toMatchObject({
      ...validClaims,
      iss: config.issuer,
      aud: config.audience,
    });
  });

  it('accepts the configured audience inside a JWT audience array', () => {
    const token = createSigner({
      key: config.secret,
      algorithm: 'HS256',
      iss: config.issuer,
      aud: [config.audience, 'fiap-x-secondary'],
      expiresIn: 3600,
    })(validClaims);

    expect(createAuthTokenVerifier(config)(token).aud).toEqual([
      config.audience,
      'fiap-x-secondary',
    ]);
  });

  it('rejects malformed tokens without exposing parser details', () => {
    expect(() => createAuthTokenVerifier(config)('not-a-jwt')).toThrow(new InvalidAuthTokenError());
  });

  it('rejects expired tokens', () => {
    const token = createTestSigner({ expiresIn: 1, clockTimestamp: Date.now() - 10_000 })(
      validClaims,
    );

    expect(() => createAuthTokenVerifier(config)(token)).toThrow(InvalidAuthTokenError);
  });

  it('rejects signed tokens with an invalid authentication payload', () => {
    const token = createTestSigner({ expiresIn: 3600 })({
      sub: 'not-a-uuid',
      username: 'john.doe',
    });

    expect(() => createAuthTokenVerifier(config)(token)).toThrow(InvalidAuthTokenError);
  });

  it('rejects unsafe verifier configuration at startup', () => {
    expect(() => createAuthTokenVerifier({ ...config, secret: 'short' })).toThrow(TypeError);
    expect(() => createAuthTokenVerifier({ ...config, issuer: ' ' })).toThrow(TypeError);
    expect(() => createAuthTokenVerifier({ ...config, audience: '' })).toThrow(TypeError);
  });
});
