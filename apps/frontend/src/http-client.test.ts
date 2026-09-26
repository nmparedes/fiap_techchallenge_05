import { describe, expect, jest, test } from '@jest/globals';

import { HttpClient, HttpClientError } from './http-client.js';

function createResponse(status: number, body = ''): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: jest.fn<() => Promise<string>>().mockResolvedValue(body),
  } as unknown as Response;
}

describe('HTTP client', () => {
  test('reads JSON and responses without a body', async () => {
    const fetchImplementation = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(createResponse(200, '{"ready":true}'))
      .mockResolvedValueOnce(createResponse(204))
      .mockResolvedValueOnce(createResponse(200, '   '));
    const client = new HttpClient({
      baseUrl: 'http://localhost:3001',
      timeoutMs: 100,
      fetchImplementation,
    });

    await expect(client.request<{ ready: boolean }>('/health')).resolves.toEqual({
      status: 200,
      data: { ready: true },
    });
    await expect(client.request('/empty')).resolves.toEqual({ status: 204, data: undefined });
    await expect(client.request('/blank')).resolves.toEqual({ status: 200, data: undefined });
  });

  test('reports invalid JSON and unsuccessful responses', async () => {
    const fetchImplementation = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(createResponse(200, 'not-json'))
      .mockResolvedValueOnce(createResponse(500, '{"success":false}'));
    const client = new HttpClient({
      baseUrl: 'http://localhost:3001',
      timeoutMs: 100,
      fetchImplementation,
    });

    await expect(client.request('/invalid')).rejects.toMatchObject({ kind: 'invalid-response' });
    await expect(client.request('/failure')).rejects.toMatchObject({
      kind: 'response',
      status: 500,
    });
  });

  test('reports a network failure', async () => {
    const client = new HttpClient({
      baseUrl: 'http://localhost:3001',
      timeoutMs: 100,
      fetchImplementation: jest.fn<typeof fetch>().mockRejectedValue(new Error('private detail')),
    });

    await expect(client.request('/auth/login')).rejects.toEqual(new HttpClientError('network'));
  });

  test('reports a failure while reading the response body', async () => {
    const response = createResponse(200);
    jest.mocked(response.text).mockRejectedValue(new Error('stream failure'));
    const client = new HttpClient({
      baseUrl: 'http://localhost:3001',
      timeoutMs: 100,
      fetchImplementation: jest.fn<typeof fetch>().mockResolvedValue(response),
    });

    await expect(client.request('/broken-body')).rejects.toEqual(new HttpClientError('network'));
  });

  test('aborts requests after the configured timeout', async () => {
    const fetchImplementation = jest.fn<typeof fetch>((_input, init) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    });
    const client = new HttpClient({
      baseUrl: 'http://localhost:3001',
      timeoutMs: 0,
      fetchImplementation,
    });

    await expect(client.request('/slow')).rejects.toEqual(new HttpClientError('timeout'));
  });

  test('centralizes the Bearer header and clears the session after 401 without logging', async () => {
    const onUnauthorized = jest.fn();
    const fetchImplementation = jest
      .fn<typeof fetch>()
      .mockResolvedValue(createResponse(401, '{"success":false}'));
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const client = new HttpClient({
      baseUrl: 'http://localhost:3001',
      timeoutMs: 100,
      fetchImplementation,
      onUnauthorized,
    });

    await expect(client.requestAuthenticated('/future', 'secret-token')).rejects.toMatchObject({
      status: 401,
    });

    const requestInit = fetchImplementation.mock.calls[0]?.[1];
    const headers = new Headers(requestInit?.headers);
    expect(headers.get('Authorization')).toBe('Bearer secret-token');
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
