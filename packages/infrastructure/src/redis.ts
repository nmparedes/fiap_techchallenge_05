import { createClient } from 'redis';

import type { RedisConfig } from './config.js';

export type RedisClient = ReturnType<typeof createClient>;

export function createRedisConnection(config: RedisConfig): RedisClient {
  return createClient({ url: config.url });
}
