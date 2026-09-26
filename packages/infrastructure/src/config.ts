import {
  readEnvironmentBoolean,
  readEnvironmentInteger,
  readEnvironmentString,
  type EnvironmentSource,
} from '@fiap-x/config';

export interface MySqlServerConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  connectionLimit: number;
  ssl: boolean;
}

export interface MySqlConfig extends MySqlServerConfig {
  database: string;
}

export interface RedisConfig {
  url: string;
}

export interface RabbitMqConfig {
  url: string;
}

export function readMySqlServerConfig(
  environment: EnvironmentSource = process.env,
): MySqlServerConfig {
  return {
    host: readEnvironmentString('MYSQL_HOST', environment),
    port: readEnvironmentInteger('MYSQL_PORT', environment, { minimum: 1, maximum: 65_535 }),
    username: readEnvironmentString('MYSQL_USERNAME', environment),
    password: readEnvironmentString('MYSQL_PASSWORD', environment),
    connectionLimit: readEnvironmentInteger('MYSQL_CONNECTION_LIMIT', environment, {
      minimum: 1,
      maximum: 100,
    }),
    ssl: readEnvironmentBoolean('MYSQL_SSL', environment),
  };
}

export function readMySqlConfig(environment: EnvironmentSource = process.env): MySqlConfig {
  return {
    ...readMySqlServerConfig(environment),
    database: readEnvironmentString('MYSQL_DATABASE', environment),
  };
}

export function readRedisConfig(environment: EnvironmentSource = process.env): RedisConfig {
  return { url: readEnvironmentString('REDIS_URL', environment) };
}

export function readRabbitMqConfig(environment: EnvironmentSource = process.env): RabbitMqConfig {
  return { url: readEnvironmentString('RABBITMQ_URL', environment) };
}
