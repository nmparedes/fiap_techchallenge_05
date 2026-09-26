import { compare } from 'bcryptjs';
import { createMySqlPool } from '@fiap-x/infrastructure';
import { createJsonLogger } from '@fiap-x/observability';

import { buildAuthService } from './app.js';
import { readAuthServiceConfig } from './config.js';
import { MySqlUserRepository } from './user-repository.js';

const config = readAuthServiceConfig();
const logger = createJsonLogger({ service: 'auth-service' });
const pool = createMySqlPool(config.mysql);
const userRepository = new MySqlUserRepository(pool);
const app = await buildAuthService({
  userRepository,
  verifyPassword: compare,
  jwt: config.jwt,
  logger,
});

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  logger.info({ event: 'shutdown_started', signal }, 'Shutdown started');

  try {
    await app.close();
    await pool.end();
    logger.info({ event: 'shutdown_completed', signal }, 'Shutdown completed');
    process.exitCode = 0;
  } catch (error) {
    logger.error({ err: error, event: 'shutdown_failed', signal }, 'Shutdown failed');
    process.exitCode = 1;
  }
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void shutdown(signal);
  });
}

try {
  await app.listen({ host: config.host, port: config.port });
  logger.info(
    { event: 'startup_completed', host: config.host, port: config.port },
    'Service started',
  );
} catch (error) {
  logger.fatal({ err: error, event: 'startup_failed' }, 'Startup failed');
  await pool.end();
  process.exitCode = 1;
}
