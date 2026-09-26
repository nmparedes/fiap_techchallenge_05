import { type MySqlPool } from '@fiap-x/infrastructure';

export type ReadinessCheck = () => Promise<void>;

export interface NotificationReadinessChecks {
  mysql: ReadinessCheck;
  rabbitMq: ReadinessCheck;
}

export function createMySqlReadinessCheck(pool: MySqlPool): ReadinessCheck {
  return async () => {
    await pool.query('SELECT 1');
  };
}

export interface RabbitMqConnectionEvents {
  on(event: 'error' | 'close', listener: () => void): unknown;
}

export function createRabbitMqReadinessCheck(connection: RabbitMqConnectionEvents): ReadinessCheck {
  let connected = true;
  const markDisconnected = () => {
    connected = false;
  };
  connection.on('error', markDisconnected);
  connection.on('close', markDisconnected);

  return async () => {
    if (!connected) {
      throw new Error('RabbitMQ connection is unavailable');
    }
  };
}
