import { afterEach, describe, expect, jest, test } from '@jest/globals';

import { Application, createLoginPanel, createUploadPanel } from './app.js';
import {
  LoginError,
  type AuthGateway,
  type LoginCredentials,
  type LoginData,
} from './auth-client.js';
import type { DashboardGateway } from './dashboard.js';
import { SessionStore } from './session.js';

const loginData: LoginData = {
  accessToken: 'private-access-token',
  tokenType: 'Bearer',
  expiresIn: 3600,
  user: {
    id: '4f4af01b-571c-4a63-bbf0-19d4d33deaa8',
    username: 'authenticated.user',
    displayName: 'Pessoa Autenticada',
  },
};

function createGateway(result: LoginData | LoginError): AuthGateway {
  return {
    login: jest.fn<(credentials: LoginCredentials) => Promise<LoginData>>(() =>
      result instanceof LoginError ? Promise.reject(result) : Promise.resolve(result),
    ),
  };
}

function submitCredentials(root: HTMLElement): void {
  const username = root.querySelector<HTMLInputElement>('input[name="username"]');
  const password = root.querySelector<HTMLInputElement>('input[name="password"]');
  const form = root.querySelector<HTMLFormElement>('.login-form');

  if (username === null || password === null || form === null) {
    throw new Error('Login form was not rendered');
  }

  username.value = 'authenticated.user';
  password.value = 'correct-password';
  const button = form.querySelector<HTMLButtonElement>('.login-submit');

  if (button === null) {
    throw new Error('Login button was not rendered');
  }

  button.click();
}

async function flushPromises(): Promise<void> {
  await new Promise((resolve) => window.setTimeout(resolve, 0));
}

describe('FIAP X application', () => {
  test('handles login validation itself instead of allowing the browser to silently block submit', () => {
    const root = document.createElement('div');
    const gateway = createGateway(loginData);
    const application = new Application(root, gateway, new SessionStore(sessionStorage));

    application.mount();
    const form = root.querySelector<HTMLFormElement>('.login-form');

    expect(form?.noValidate).toBe(true);
    form?.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));

    expect(gateway.login).not.toHaveBeenCalled();
    expect(root.textContent).toContain('Informe um usuário com pelo menos 3 caracteres.');
    expect(root.querySelector<HTMLInputElement>('input[name="username"]')?.ariaInvalid).toBe(
      'true',
    );
  });

  test('logs in successfully and renders the authenticated state', async () => {
    const root = document.createElement('div');
    const gateway = createGateway(loginData);
    const application = new Application(root, gateway, new SessionStore(sessionStorage));

    application.mount();
    submitCredentials(root);
    expect(root.textContent).toContain('ENTRANDO...');
    await flushPromises();

    expect(gateway.login).toHaveBeenCalledWith({
      username: 'authenticated.user',
      password: 'correct-password',
    });
    expect(root.textContent).toContain('Pessoa Autenticada');
    expect(root.textContent).toContain('SESSÃO ATIVA');
    expect(root.innerHTML).not.toContain(loginData.accessToken);
  });

  test('shows a short message for rejected credentials', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    const application = new Application(
      root,
      createGateway(new LoginError('credentials')),
      new SessionStore(sessionStorage),
    );

    application.mount();
    submitCredentials(root);
    await flushPromises();

    expect(root.textContent).toContain('Usuário ou senha inválidos.');
    expect(root.textContent).toContain('ACESSO RESTRITO');
    expect(root.querySelector<HTMLInputElement>('input[name="username"]')?.ariaInvalid).toBe(
      'true',
    );
    expect(root.querySelector<HTMLInputElement>('input[name="password"]')?.ariaInvalid).toBe(
      'true',
    );
    expect(document.activeElement).toBe(
      root.querySelector<HTMLInputElement>('input[name="username"]'),
    );
    root
      .querySelector<HTMLInputElement>('input[name="username"]')
      ?.dispatchEvent(new Event('input', { bubbles: true }));
    expect(root.querySelector<HTMLInputElement>('input[name="username"]')?.ariaInvalid).toBeNull();
    expect(root.querySelector('.login-message')?.textContent).toBe('');
    application.unmount();
    root.remove();
  });

  test('shows a safe message for a network failure', async () => {
    const root = document.createElement('div');
    const application = new Application(
      root,
      createGateway(new LoginError('unavailable')),
      new SessionStore(sessionStorage),
    );

    application.mount();
    submitCredentials(root);
    await flushPromises();

    expect(root.textContent).toContain('Não foi possível entrar agora. Tente novamente.');
  });

  test('restores a stored session and logs out', () => {
    sessionStorage.setItem('fiap-x.access-token', loginData.accessToken);
    const root = document.createElement('div');
    const application = new Application(
      root,
      createGateway(loginData),
      new SessionStore(sessionStorage),
    );

    application.mount();
    expect(root.textContent).toContain('Sessão restaurada');

    root.querySelector<HTMLButtonElement>('.logout-button')?.click();

    expect(sessionStorage.getItem('fiap-x.access-token')).toBeNull();
    expect(root.textContent).toContain('Sessão encerrada.');
  });

  test('returns to login and clears storage after an unauthorized response', () => {
    const root = document.createElement('div');
    const sessionStore = new SessionStore(sessionStorage);
    sessionStore.start(loginData);
    const application = new Application(root, createGateway(loginData), sessionStore);

    application.mount();
    sessionStore.clear('unauthorized');

    expect(sessionStore.current).toBeNull();
    expect(sessionStorage.getItem('fiap-x.access-token')).toBeNull();
    expect(root.textContent).toContain('Sua sessão expirou. Entre novamente.');
    expect(root.textContent).toContain('ACESSO RESTRITO');
  });

  test('stops dashboard polling on logout', async () => {
    jest.useFakeTimers();
    sessionStorage.setItem('fiap-x.access-token', loginData.accessToken);
    const dashboardGateway: DashboardGateway = {
      load: jest.fn<DashboardGateway['load']>().mockResolvedValue({
        videos: [],
        notifications: [],
      }),
      upload: jest.fn<DashboardGateway['upload']>().mockResolvedValue(undefined),
      retry: jest.fn<DashboardGateway['retry']>().mockResolvedValue(undefined),
      removeFromQueue: jest.fn<DashboardGateway['removeFromQueue']>().mockResolvedValue(undefined),
      download: jest.fn<DashboardGateway['download']>(),
    };
    const root = document.createElement('div');
    const application = new Application(
      root,
      createGateway(loginData),
      new SessionStore(sessionStorage),
      dashboardGateway,
    );

    application.mount();
    await Promise.resolve();
    await Promise.resolve();
    expect(dashboardGateway.load).toHaveBeenCalledTimes(1);

    root.querySelector<HTMLButtonElement>('.logout-button')?.click();
    jest.advanceTimersByTime(6_000);
    await Promise.resolve();

    expect(dashboardGateway.load).toHaveBeenCalledTimes(1);
    expect(root.textContent).toContain('Sessão encerrada.');
    application.unmount();
  });

  test('renders the upload fields with the established constraints', () => {
    const panel = createUploadPanel();
    const file = panel.querySelector<HTMLInputElement>('input[name="video"]');
    const fps = panel.querySelector<HTMLInputElement>('input[name="fps"]');
    const usernamePanel = createLoginPanel();
    const username = usernamePanel.querySelector<HTMLInputElement>('input[name="username"]');
    const password = usernamePanel.querySelector<HTMLInputElement>('input[name="password"]');

    expect(file?.accept).toBe('.mp4,.avi,.mov,.mkv,.wmv,.flv,.webm');
    expect(fps).toMatchObject({ value: '1', min: '1', max: '10', step: '1' });
    expect(panel.querySelector(`label[for="${file?.id}"]`)).not.toBeNull();
    expect(panel.querySelector(`label[for="${fps?.id}"]`)).not.toBeNull();
    expect(usernamePanel.querySelector(`label[for="${username?.id}"]`)).not.toBeNull();
    expect(usernamePanel.querySelector(`label[for="${password?.id}"]`)).not.toBeNull();
    expect(file?.getAttribute('aria-describedby')).toContain('upload-status');
    expect(fps?.getAttribute('aria-describedby')).toContain('fps-tooltip');
    expect(panel.querySelector('.upload-status')?.getAttribute('aria-live')).toBe('polite');
  });
});

afterEach(() => {
  jest.useRealTimers();
  document.body.replaceChildren();
  sessionStorage.clear();
});
