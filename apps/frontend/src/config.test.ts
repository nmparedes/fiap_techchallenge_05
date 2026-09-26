import { describe, expect, test } from '@jest/globals';

import {
  DEFAULT_AUTH_API_BASE_URL,
  DEFAULT_NOTIFICATION_API_BASE_URL,
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_VIDEO_API_BASE_URL,
  loadFrontendConfig,
} from './config.js';

describe('frontend configuration', () => {
  test('uses the documented local Auth Service URL by default', () => {
    expect(loadFrontendConfig({})).toEqual({
      authApiBaseUrl: DEFAULT_AUTH_API_BASE_URL,
      videoApiBaseUrl: DEFAULT_VIDEO_API_BASE_URL,
      notificationApiBaseUrl: DEFAULT_NOTIFICATION_API_BASE_URL,
      requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
    });
  });

  test('normalizes a configured public URL', () => {
    expect(
      loadFrontendConfig({
        VITE_AUTH_API_BASE_URL: ' https://auth.example.test/ ',
        VITE_VIDEO_API_BASE_URL: 'https://video.example.test/',
        VITE_NOTIFICATION_API_BASE_URL: 'https://notification.example.test/',
      }),
    ).toEqual({
      authApiBaseUrl: 'https://auth.example.test',
      videoApiBaseUrl: 'https://video.example.test',
      notificationApiBaseUrl: 'https://notification.example.test',
      requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
    });
  });

  test.each([
    'not-a-url',
    'ftp://auth.example.test',
    'https://user:secret@auth.example.test',
    'https://auth.example.test?debug=true',
    'https://auth.example.test#token',
  ])('rejects unsafe or invalid URL %s', (value) => {
    expect(() => loadFrontendConfig({ VITE_AUTH_API_BASE_URL: value })).toThrow(
      'VITE_AUTH_API_BASE_URL',
    );
  });
});
