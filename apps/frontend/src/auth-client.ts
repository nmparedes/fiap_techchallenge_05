import { HttpClient, HttpClientError } from './http-client.js';

export interface LoginCredentials {
  username: string;
  password: string;
}

export interface AuthenticatedUser {
  id: string;
  username: string;
  displayName: string;
}

export interface LoginData {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  user: AuthenticatedUser;
}

interface LoginResponse {
  success: true;
  data: LoginData;
}

export type LoginErrorKind = 'credentials' | 'unavailable';

export class LoginError extends Error {
  public constructor(public readonly kind: LoginErrorKind) {
    super(kind);
    this.name = 'LoginError';
  }
}

export interface AuthGateway {
  login(credentials: LoginCredentials): Promise<LoginData>;
}

function isAuthenticatedUser(value: unknown): value is AuthenticatedUser {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const user = value as Record<string, unknown>;
  return (
    typeof user['id'] === 'string' &&
    typeof user['username'] === 'string' &&
    typeof user['displayName'] === 'string'
  );
}

function isLoginResponse(value: unknown): value is LoginResponse {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const response = value as Record<string, unknown>;
  const data = response['data'];

  if (response['success'] !== true || typeof data !== 'object' || data === null) {
    return false;
  }

  const loginData = data as Record<string, unknown>;
  return (
    typeof loginData['accessToken'] === 'string' &&
    loginData['accessToken'] !== '' &&
    loginData['tokenType'] === 'Bearer' &&
    typeof loginData['expiresIn'] === 'number' &&
    loginData['expiresIn'] > 0 &&
    isAuthenticatedUser(loginData['user'])
  );
}

export class AuthClient implements AuthGateway {
  public constructor(private readonly httpClient: HttpClient) {}

  public async login(credentials: LoginCredentials): Promise<LoginData> {
    try {
      const result = await this.httpClient.request<LoginResponse>('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(credentials),
      });

      if (!isLoginResponse(result.data)) {
        throw new LoginError('unavailable');
      }

      return result.data.data;
    } catch (error) {
      if (error instanceof LoginError) {
        throw error;
      }

      if (error instanceof HttpClientError && error.status === 401) {
        throw new LoginError('credentials');
      }

      throw new LoginError('unavailable');
    }
  }
}
