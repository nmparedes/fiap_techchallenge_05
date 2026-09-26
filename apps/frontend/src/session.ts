import type { AuthenticatedUser, LoginData } from './auth-client.js';

const ACCESS_TOKEN_KEY = 'fiap-x.access-token';

export type SessionChangeReason = 'login' | 'restore' | 'logout' | 'unauthorized';

export interface UserSession {
  accessToken: string;
  user: AuthenticatedUser | null;
}

export type SessionListener = (session: UserSession | null, reason: SessionChangeReason) => void;

export class SessionStore {
  private session: UserSession | null = null;
  private readonly listeners = new Set<SessionListener>();

  public constructor(private readonly storage: Storage) {}

  public get current(): UserSession | null {
    return this.session;
  }

  public start(loginData: LoginData): void {
    this.storage.setItem(ACCESS_TOKEN_KEY, loginData.accessToken);
    this.session = { accessToken: loginData.accessToken, user: loginData.user };
    this.notify('login');
  }

  public restore(): UserSession | null {
    const accessToken = this.storage.getItem(ACCESS_TOKEN_KEY)?.trim();

    if (accessToken === undefined || accessToken === '') {
      this.storage.removeItem(ACCESS_TOKEN_KEY);
      this.session = null;
      return null;
    }

    this.session = { accessToken, user: null };
    this.notify('restore');
    return this.session;
  }

  public clear(reason: 'logout' | 'unauthorized'): void {
    this.storage.removeItem(ACCESS_TOKEN_KEY);
    this.session = null;
    this.notify(reason);
  }

  public subscribe(listener: SessionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(reason: SessionChangeReason): void {
    this.listeners.forEach((listener) => listener(this.session, reason));
  }
}
