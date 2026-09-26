import { randomUUID } from 'node:crypto';

import pino, { type DestinationStream, type Logger, type LoggerOptions } from 'pino';

export type JsonLogger = Logger;

export interface JsonLoggerOptions extends Pick<LoggerOptions, 'level' | 'base'> {
  service?: string;
  /** @deprecated Use service. Kept for compatibility with existing callers. */
  name?: string;
  destination?: DestinationStream;
}

const REDACTED = '[REDACTED]';
const MAX_ERROR_MESSAGE_LENGTH = 2_048;

const SENSITIVE_PATHS = [
  'authorization',
  'Authorization',
  'password',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
  'jwt',
  'secret',
  'clientSecret',
  'apiKey',
  'cookie',
  'cookies',
  '*.authorization',
  '*.Authorization',
  '*.password',
  '*.passwordHash',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.jwt',
  '*.secret',
  '*.clientSecret',
  '*.apiKey',
  '*.cookie',
  '*.cookies',
  '*.*.password',
  '*.*.passwordHash',
  '*.*.token',
  '*.*.accessToken',
  '*.*.refreshToken',
  '*.*.jwt',
  '*.*.secret',
  '*.*.clientSecret',
  '*.*.apiKey',
  '*.*.authorization',
  '*.*.cookie',
  'req.headers.authorization',
  'req.headers.cookie',
  'request.headers.authorization',
  'request.headers.cookie',
] as const;

function sanitizeErrorMessage(message: string): string {
  return message
    .replace(/\bBearer\s+[^\s]+/giu, `Bearer ${REDACTED}`)
    .replace(/:\/\/[^\s/@:]+:[^\s/@]+@/gu, `://${REDACTED}@`)
    .replace(/\b(?:password|token|secret|apiKey)\s*[=:]\s*[^\s,;]+/giu, REDACTED)
    .replace(
      /\b(?:SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE)\b[\s\S]*/iu,
      '[SQL REDACTED]',
    )
    .slice(0, MAX_ERROR_MESSAGE_LENGTH);
}

function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      type: error.name,
      message: sanitizeErrorMessage(error.message),
    };
  }

  return { type: 'UnknownError', message: sanitizeErrorMessage(String(error)) };
}

export function createJsonLogger(options: JsonLoggerOptions = {}): JsonLogger {
  const { destination, service, name, base, ...loggerOptions } = options;
  const baseService =
    base !== null && typeof base?.['service'] === 'string' ? base['service'] : undefined;
  const normalizedOptions: LoggerOptions = {
    ...loggerOptions,
    base: {
      ...(base ?? {}),
      service: service ?? name ?? baseService ?? 'unknown-service',
      correlationId: randomUUID(),
    },
    messageKey: 'message',
    formatters: {
      level: (label) => ({ level: label }),
    },
    timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
    redact: { paths: [...SENSITIVE_PATHS], censor: REDACTED },
    serializers: {
      err: serializeError,
      error: serializeError,
    },
  };

  if (destination === undefined) {
    return pino(normalizedOptions);
  }

  return pino(normalizedOptions, destination);
}
