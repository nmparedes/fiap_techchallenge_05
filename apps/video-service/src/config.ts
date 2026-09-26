import {
  EnvironmentValidationError,
  readEnvironmentInteger,
  readEnvironmentString,
  type EnvironmentSource,
} from '@fiap-x/config';
import {
  readMySqlServerConfig,
  readRabbitMqConfig,
  readRedisConfig,
  type MySqlConfig,
  type RabbitMqConfig,
  type RedisConfig,
} from '@fiap-x/infrastructure';

export interface VideoServiceConfig {
  host: string;
  port: number;
  storageRoot: string;
  jwt: {
    secret: string;
    issuer: string;
    audience: string;
  };
  mysql: MySqlConfig;
  redis: RedisConfig;
  rabbitMq: RabbitMqConfig;
}

function optionalString(name: string, fallback: string, environment: EnvironmentSource): string {
  return environment[name] === undefined ? fallback : readEnvironmentString(name, environment);
}

function optionalInteger(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
  environment: EnvironmentSource,
): number {
  return environment[name] === undefined
    ? fallback
    : readEnvironmentInteger(name, environment, { minimum, maximum });
}

export function readVideoServiceConfig(
  environment: EnvironmentSource = process.env,
): VideoServiceConfig {
  const secret = readEnvironmentString('AUTH_JWT_SECRET', environment);
  if (Buffer.byteLength(secret, 'utf8') < 32) {
    throw new EnvironmentValidationError(
      'AUTH_JWT_SECRET',
      'must contain at least 32 bytes for HS256',
    );
  }

  return {
    host: optionalString('VIDEO_HOST', '0.0.0.0', environment),
    port: optionalInteger('VIDEO_PORT', 3002, 1, 65_535, environment),
    storageRoot: readEnvironmentString('VIDEO_STORAGE_ROOT', environment),
    jwt: {
      secret,
      issuer: optionalString('AUTH_JWT_ISSUER', 'fiap-x-auth-service', environment),
      audience: optionalString('AUTH_JWT_AUDIENCE', 'fiap-x-api', environment),
    },
    mysql: { ...readMySqlServerConfig(environment), database: 'video_db' },
    redis: readRedisConfig(environment),
    rabbitMq: readRabbitMqConfig(environment),
  };
}
