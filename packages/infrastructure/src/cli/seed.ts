import { readMySqlServerConfig } from '../config.js';
import { seedLocalDemoUsers } from '../mysql/seeds.js';
import { createManagedMigrationConnection } from './mysql-connection.js';

async function seed(): Promise<void> {
  const connection = await createManagedMigrationConnection(readMySqlServerConfig(), 'auth_db');

  try {
    const result = await seedLocalDemoUsers(connection);
    console.info(
      `auth_db users: ${result.inserted.length} inserted, ${result.skipped.length} already present`,
    );
  } finally {
    await connection.end();
  }
}

await seed();
