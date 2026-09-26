import { afterEach, describe, expect, jest, test } from '@jest/globals';

import type { LoginData } from './auth-client.js';
import { SessionStore } from './session.js';

const loginData: LoginData = {
  accessToken: 'session-token',
  tokenType: 'Bearer',
  expiresIn: 3600,
  user: {
    id: '262721d9-c958-4405-99ea-c7d3e6ec21d5',
    username: 'session.user',
    displayName: 'Pessoa da Sessão',
  },
};

describe('session store', () => {
  test('persists only the token in sessionStorage and restores it without decoding JWT', () => {
    const firstStore = new SessionStore(sessionStorage);
    firstStore.start(loginData);

    expect(sessionStorage).toHaveLength(1);
    expect(sessionStorage.getItem('fiap-x.access-token')).toBe(loginData.accessToken);
    expect(localStorage).toHaveLength(0);

    const restoredStore = new SessionStore(sessionStorage);
    expect(restoredStore.restore()).toEqual({ accessToken: loginData.accessToken, user: null });
  });

  test('clears invalid stored values and supports logout notifications', () => {
    sessionStorage.setItem('fiap-x.access-token', '   ');
    const store = new SessionStore(sessionStorage);
    const listener = jest.fn();
    const unsubscribe = store.subscribe(listener);

    expect(store.restore()).toBeNull();
    store.start(loginData);
    store.clear('logout');
    unsubscribe();
    store.start(loginData);

    expect(listener).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ user: loginData.user }),
      'login',
    );
    expect(listener).toHaveBeenNthCalledWith(2, null, 'logout');
    expect(listener).toHaveBeenCalledTimes(2);
    expect(sessionStorage.getItem('fiap-x.access-token')).toBe(loginData.accessToken);
  });
});

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
