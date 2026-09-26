import { mapUserRow, type MySqlPool, type UserRecord, type UserRow } from '@fiap-x/infrastructure';
import type { RowDataPacket } from 'mysql2';

export interface UserRepository {
  findByUsername(username: string): Promise<UserRecord | null>;
  ping(): Promise<void>;
}

export class UserRepositoryUnavailableError extends Error {
  public constructor() {
    super('The user repository is unavailable');
    this.name = 'UserRepositoryUnavailableError';
  }
}

type UserDatabaseRow = UserRow & RowDataPacket;

export class MySqlUserRepository implements UserRepository {
  public constructor(private readonly pool: MySqlPool) {}

  public async findByUsername(username: string): Promise<UserRecord | null> {
    try {
      const [rows] = await this.pool.execute<UserDatabaseRow[]>(
        `SELECT id, username, display_name, password_hash, created_at, updated_at
         FROM users
         WHERE username = ?
         LIMIT 1`,
        [username],
      );
      const row = rows[0];

      return row === undefined ? null : mapUserRow(row);
    } catch {
      throw new UserRepositoryUnavailableError();
    }
  }

  public async ping(): Promise<void> {
    try {
      await this.pool.query('SELECT 1');
    } catch {
      throw new UserRepositoryUnavailableError();
    }
  }
}
