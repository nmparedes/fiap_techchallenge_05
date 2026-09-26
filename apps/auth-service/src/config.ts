import {
  EnvironmentValidationError,
  readEnvironmentInteger,
  readEnvironmentString,
  type EnvironmentSource,
} from '@fiap-x/config';
import { readMySqlServerConfig, type MySqlConfig } from '@fiap-x/infrastructure';

export interface AuthServiceConfig {
  host: string;
  port: number;
  jwt: {
    secret: string;
    expiresInSeconds: number;
    issuer: string;
    audience: string;
  };
  mysql: MySqlConfig;
}

function readOptionalString(
  variableName: string,
  defaultValue: string,
  environment: EnvironmentSource,
): string {
  return environment[variableName] === undefined
    ? defaultValue
    : readEnvironmentString(variableName, environment);
}

function readOptionalInteger(
  variableName: string,
  defaultValue: number,
  environment: EnvironmentSource,
  minimum: number,
  maximum: number,
): number {
  return environment[variableName] === undefined
    ? defaultValue
    : readEnvironmentInteger(variableName, environment, { minimum, maximum });
}

export function readAuthServiceConfig(
  environment: EnvironmentSource = process.env,
): AuthServiceConfig {
  const secret = readEnvironmentString('AUTH_JWT_SECRET', environment);

  if (Buffer.byteLength(secret, 'utf8') < 32) {
    throw new EnvironmentValidationError(
      'AUTH_JWT_SECRET',
      'must contain at least 32 bytes for HS256',
    );
  }

  return {
    host: readOptionalString('AUTH_HOST', '0.0.0.0', environment),
    port: readOptionalInteger('AUTH_PORT', 3001, environment, 1, 65_535),
    jwt: {
      secret,
      expiresInSeconds: readOptionalInteger(
        'AUTH_JWT_EXPIRES_IN_SECONDS',
        3600,
        environment,
        60,
        86_400,
      ),
      issuer: readOptionalString('AUTH_JWT_ISSUER', 'fiap-x-auth-service', environment),
      audience: readOptionalString('AUTH_JWT_AUDIENCE', 'fiap-x-api', environment),
    },
    mysql: {
      ...readMySqlServerConfig(environment),
      database: 'auth_db',
    },
  };
}
