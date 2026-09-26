import {
  readEnvironmentInteger,
  readEnvironmentString,
  type EnvironmentSource,
} from '@fiap-x/config';
import { readRabbitMqConfig, type RabbitMqConfig } from '@fiap-x/infrastructure';

export interface ProcessorServiceConfig {
  port: number;
  rabbitMq: RabbitMqConfig;
  storageRoot: string;
  prefetch: number;
  shutdownTimeoutMs: number;
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

export function readProcessorServiceConfig(
  environment: EnvironmentSource = process.env,
): ProcessorServiceConfig {
  return {
    port: optionalInteger('PROCESSOR_PORT', 3003, 1, 65_535, environment),
    rabbitMq: readRabbitMqConfig(environment),
    storageRoot: readEnvironmentString('VIDEO_STORAGE_ROOT', environment),
    prefetch: optionalInteger('PROCESSOR_PREFETCH', 1, 1, 1, environment),
    shutdownTimeoutMs: optionalInteger(
      'PROCESSOR_SHUTDOWN_TIMEOUT_MS',
      10_000,
      1,
      300_000,
      environment,
    ),
  };
}
