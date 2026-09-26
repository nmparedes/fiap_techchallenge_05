import type { AuthTokenClaims } from '@fiap-x/contracts';
import { createVerifier } from 'fast-jwt';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface AuthTokenVerificationConfig {
  secret: string;
  issuer: string;
  audience: string;
}

export class InvalidAuthTokenError extends Error {
  public constructor() {
    super('Invalid authentication token');
    this.name = 'InvalidAuthTokenError';
  }
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === 'string' && item.length > 0)
  );
}

function isAuthTokenClaims(value: unknown): value is AuthTokenClaims {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const claims = value as Readonly<Record<string, unknown>>;

  return (
    typeof claims['sub'] === 'string' &&
    UUID_PATTERN.test(claims['sub']) &&
    typeof claims['username'] === 'string' &&
    claims['username'].length >= 3 &&
    claims['username'].length <= 64 &&
    typeof claims['iss'] === 'string' &&
    claims['iss'].length > 0 &&
    (typeof claims['aud'] === 'string' ? claims['aud'].length > 0 : isStringArray(claims['aud'])) &&
    typeof claims['iat'] === 'number' &&
    Number.isInteger(claims['iat']) &&
    claims['iat'] >= 0 &&
    typeof claims['exp'] === 'number' &&
    Number.isInteger(claims['exp']) &&
    claims['exp'] >= 0
  );
}

export type AuthTokenVerifier = (token: string) => AuthTokenClaims;

export function createAuthTokenVerifier(config: AuthTokenVerificationConfig): AuthTokenVerifier {
  if (
    Buffer.byteLength(config.secret, 'utf8') < 32 ||
    config.issuer.trim().length === 0 ||
    config.audience.trim().length === 0
  ) {
    throw new TypeError('Invalid authentication token verifier configuration');
  }

  const verify = createVerifier({
    key: config.secret,
    algorithms: ['HS256'],
    allowedIss: config.issuer,
    allowedAud: config.audience,
    requiredClaims: ['sub', 'username', 'iss', 'aud', 'iat', 'exp'],
    checkTyp: 'JWT',
  });

  return (token) => {
    try {
      const claims: unknown = verify(token);

      if (!isAuthTokenClaims(claims)) {
        throw new InvalidAuthTokenError();
      }

      return claims;
    } catch {
      throw new InvalidAuthTokenError();
    }
  };
}
