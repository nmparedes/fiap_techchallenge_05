import {
  EnvironmentValidationError,
  readEnvironmentInteger,
  readEnvironmentString,
  type EnvironmentSource,
} from '@fiap-x/config';
import {
  readMySqlServerConfig,
  readRabbitMqConfig,
  type AuthTokenVerificationConfig,
  type MySqlConfig,
  type RabbitMqConfig,
} from '@fiap-x/infrastructure';

export interface NotificationServiceConfig {
  port: number;
  mysql: MySqlConfig;
  rabbitMq: RabbitMqConfig;
  jwt: AuthTokenVerificationConfig;
  pagination: {
    defaultPageSize: number;
    maximumPageSize: number;
  };
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

export function readNotificationServiceConfig(
  environment: EnvironmentSource = process.env,
): NotificationServiceConfig {
  const secret = readEnvironmentString('AUTH_JWT_SECRET', environment);
  if (Buffer.byteLength(secret, 'utf8') < 32) {
    throw new EnvironmentValidationError(
      'AUTH_JWT_SECRET',
      'must contain at least 32 bytes for HS256',
    );
  }

  const maximumPageSize = optionalInteger(
    'NOTIFICATION_MAXIMUM_PAGE_SIZE',
    100,
    1,
    100,
    environment,
  );
  const defaultPageSize = optionalInteger(
    'NOTIFICATION_DEFAULT_PAGE_SIZE',
    20,
    1,
    maximumPageSize,
    environment,
  );

  return {
    port: optionalInteger('NOTIFICATION_PORT', 3004, 1, 65_535, environment),
    mysql: { ...readMySqlServerConfig(environment), database: 'notification_db' },
    rabbitMq: readRabbitMqConfig(environment),
    jwt: {
      secret,
      issuer: optionalString('AUTH_JWT_ISSUER', 'fiap-x-auth-service', environment),
      audience: optionalString('AUTH_JWT_AUDIENCE', 'fiap-x-api', environment),
    },
    pagination: { defaultPageSize, maximumPageSize },
  };
}
