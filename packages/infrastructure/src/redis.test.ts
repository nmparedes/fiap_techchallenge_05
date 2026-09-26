import { describe, expect, it } from '@jest/globals';

import { createRedisConnection } from './redis.js';

describe('Redis infrastructure', () => {
  it('creates a disconnected client for an explicit URL', () => {
    const client = createRedisConnection({ url: 'redis://localhost:6379' });

    expect(client.isOpen).toBe(false);
  });
});
