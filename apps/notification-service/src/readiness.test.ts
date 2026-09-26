import { EventEmitter } from 'node:events';

import { describe, expect, it, jest } from '@jest/globals';
import type { MySqlPool } from '@fiap-x/infrastructure';

import {
  createMySqlReadinessCheck,
  createRabbitMqReadinessCheck,
  type RabbitMqConnectionEvents,
} from './readiness.js';

describe('Notification Service readiness checks', () => {
  it('queries MySQL through the existing pool', async () => {
    const query = jest.fn<MySqlPool['query']>().mockResolvedValue([[], []]);
    const check = createMySqlReadinessCheck({ query } as unknown as MySqlPool);

    await expect(check()).resolves.toBeUndefined();
    expect(query).toHaveBeenCalledWith('SELECT 1');
  });

  it('reports the shared RabbitMQ connection as unavailable after it closes', async () => {
    const connection = new EventEmitter() as RabbitMqConnectionEvents & EventEmitter;
    const check = createRabbitMqReadinessCheck(connection);

    await expect(check()).resolves.toBeUndefined();
    connection.emit('close');
    await expect(check()).rejects.toThrow('RabbitMQ connection is unavailable');
  });
});
