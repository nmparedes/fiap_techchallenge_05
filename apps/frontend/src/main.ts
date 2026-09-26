import { Application } from './app.js';
import {
  AuthClient,
  LoginError,
  type AuthGateway,
  type LoginCredentials,
  type LoginData,
} from './auth-client.js';
import { createBrowserDashboardGateway } from './browser-dashboard.js';
import { loadFrontendConfig } from './config.js';
import { DashboardService, type DashboardGateway } from './dashboard.js';
import { HttpClient } from './http-client.js';
import { NotificationClient } from './notification-client.js';
import { SessionStore } from './session.js';
import { VideoClient } from './video-client.js';
import './styles.css';

const root = document.querySelector<HTMLElement>('#app');

if (root === null) {
  throw new Error('The application root element was not found');
}

const config = loadFrontendConfig(import.meta.env);
const sessionStore = new SessionStore(window.sessionStorage);
const httpClient = new HttpClient({
  baseUrl: config.authApiBaseUrl,
  timeoutMs: config.requestTimeoutMs,
  onUnauthorized: () => sessionStore.clear('unauthorized'),
});
const authClient: AuthGateway = import.meta.env.PROD
  ? createBrowserAuthGateway()
  : new AuthClient(httpClient);
const videoHttpClient = new HttpClient({
  baseUrl: config.videoApiBaseUrl,
  timeoutMs: config.requestTimeoutMs,
  onUnauthorized: () => sessionStore.clear('unauthorized'),
});
const notificationHttpClient = new HttpClient({
  baseUrl: config.notificationApiBaseUrl,
  timeoutMs: config.requestTimeoutMs,
  onUnauthorized: () => sessionStore.clear('unauthorized'),
});
const dashboardService: DashboardGateway = import.meta.env.PROD
  ? createBrowserDashboardGateway()
  : new DashboardService(
      new VideoClient(videoHttpClient),
      new NotificationClient(notificationHttpClient),
    );

new Application(root, authClient, sessionStore, dashboardService).mount();

function createBrowserAuthGateway(): AuthGateway {
  return {
    async login(credentials: LoginCredentials): Promise<LoginData> {
      let response: Response;

      try {
        response = await window.fetch(new URL('/auth/login', window.location.origin), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(credentials),
        });
      } catch {
        throw new LoginError('unavailable');
      }

      if (response.status === 401) {
        throw new LoginError('credentials');
      }

      if (!response.ok) {
        throw new LoginError('unavailable');
      }

      let payload: unknown;

      try {
        payload = await response.json();
      } catch {
        throw new LoginError('unavailable');
      }

      if (!isLoginPayload(payload)) {
        throw new LoginError('unavailable');
      }

      return payload.data;
    },
  };
}

function isLoginPayload(value: unknown): value is { success: true; data: LoginData } {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const payload = value as Record<string, unknown>;
  const data = payload['data'];

  if (payload['success'] !== true || typeof data !== 'object' || data === null) {
    return false;
  }

  const loginData = data as Record<string, unknown>;
  const user = loginData['user'];

  return (
    typeof loginData['accessToken'] === 'string' &&
    loginData['accessToken'] !== '' &&
    loginData['tokenType'] === 'Bearer' &&
    typeof loginData['expiresIn'] === 'number' &&
    loginData['expiresIn'] > 0 &&
    typeof user === 'object' &&
    user !== null &&
    typeof (user as Record<string, unknown>)['id'] === 'string' &&
    typeof (user as Record<string, unknown>)['username'] === 'string' &&
    typeof (user as Record<string, unknown>)['displayName'] === 'string'
  );
}
