import type { UserRecord } from '@fiap-x/infrastructure';

import type { UserRepository } from './user-repository.js';

const DUMMY_PASSWORD_HASH = '$2b$12$QOChdECMD.2W7v/iZXdOMun4b/IZVjH5vmCXgNpiim7CsaSOoBSGq';

export type PasswordVerifier = (password: string, passwordHash: string) => Promise<boolean>;

export class InvalidCredentialsError extends Error {
  public constructor() {
    super('Invalid username or password');
    this.name = 'InvalidCredentialsError';
  }
}

export class AuthenticateUser {
  public constructor(
    private readonly userRepository: UserRepository,
    private readonly verifyPassword: PasswordVerifier,
  ) {}

  public async execute(username: string, password: string): Promise<UserRecord> {
    const user = await this.userRepository.findByUsername(username);
    const passwordMatches = await this.verifyPassword(
      password,
      user?.passwordHash ?? DUMMY_PASSWORD_HASH,
    );

    if (user === null || !passwordMatches) {
      throw new InvalidCredentialsError();
    }

    return user;
  }
}
