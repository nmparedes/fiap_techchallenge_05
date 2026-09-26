import { hash } from 'bcryptjs';

export interface LocalDemoUser {
  id: string;
  username: string;
  displayName: string;
  password: string;
}

export const LOCAL_DEMO_USERS: readonly LocalDemoUser[] = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    username: 'john.doe',
    displayName: 'John Doe',
    password: 'JohnDoe123!',
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    username: 'mary.doe',
    displayName: 'Mary Doe',
    password: 'MaryDoe123!',
  },
] as const;

export interface SeedConnection {
  query(sql: string, parameters?: readonly unknown[]): Promise<readonly [unknown, unknown]>;
}

export type PasswordHasher = (password: string, rounds: number) => Promise<string>;

export interface SeedRunResult {
  inserted: readonly string[];
  skipped: readonly string[];
}

interface ExistingUserRow {
  id: string;
}

export async function seedLocalDemoUsers(
  connection: SeedConnection,
  passwordHasher: PasswordHasher = hash,
): Promise<SeedRunResult> {
  const result: { inserted: string[]; skipped: string[] } = { inserted: [], skipped: [] };

  for (const user of LOCAL_DEMO_USERS) {
    const [existingResult] = await connection.query(
      'SELECT id FROM users WHERE username = ? LIMIT 1',
      [user.username],
    );
    const existingUsers = Array.isArray(existingResult)
      ? (existingResult as readonly ExistingUserRow[])
      : [];

    if (existingUsers.length > 0) {
      result.skipped.push(user.username);
      continue;
    }

    const passwordHash = await passwordHasher(user.password, 12);
    await connection.query(
      `INSERT IGNORE INTO users (id, username, display_name, password_hash)
       VALUES (?, ?, ?, ?)`,
      [user.id, user.username, user.displayName, passwordHash],
    );
    result.inserted.push(user.username);
  }

  return result;
}
