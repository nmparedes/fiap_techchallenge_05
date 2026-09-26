import { afterEach, describe, expect, jest, test } from '@jest/globals';

import { Application } from './app.js';
import { AuthClient } from './auth-client.js';
import { DashboardService } from './dashboard.js';
import { HttpClient } from './http-client.js';
import { NotificationClient } from './notification-client.js';
import { SessionStore } from './session.js';
import { VideoClient, type VideoView } from './video-client.js';

function jsonResponse(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: jest.fn<() => Promise<string>>().mockResolvedValue(JSON.stringify(body)),
    headers: new Headers(),
  } as unknown as Response;
}

async function flushUi(): Promise<void> {
  await new Promise((resolve) => window.setTimeout(resolve, 0));
  await Promise.resolve();
}

describe('authenticated end-to-end frontend flow', () => {
  test('logs in, uploads, follows the completed video, downloads, and logs out', async () => {
    let uploaded = false;
    const completedVideo: VideoView = {
      id: 'ea96e9e8-dc42-4439-9ff1-e1951cab91dc',
      originalName: 'resultado-final.mp4',
      extension: 'mp4',
      sizeBytes: '1024',
      fps: 1,
      status: 'COMPLETED',
      attempt: 1,
      errorCode: null,
      errorMessage: null,
      downloadAvailable: true,
      processingStartedAt: '2026-09-13T12:00:00.000Z',
      completedAt: '2026-09-13T12:01:00.000Z',
      createdAt: '2026-09-13T12:00:00.000Z',
      updatedAt: '2026-09-13T12:01:00.000Z',
    };
    const archive = new Blob(['zip'], { type: 'application/zip' });
    const fetchImplementation = jest.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';

      if (url === 'http://localhost:3001/auth/login' && method === 'POST') {
        return jsonResponse(200, {
          success: true,
          data: {
            accessToken: 'flow-token',
            tokenType: 'Bearer',
            expiresIn: 3600,
            user: {
              id: 'b77951e8-c2e1-48bd-8393-68b13f59943c',
              username: 'flow.user',
              displayName: 'Pessoa do Fluxo',
            },
          },
        });
      }

      if (url === 'http://localhost:3002/videos?page=1&pageSize=20') {
        const items = uploaded ? [completedVideo] : [];
        return jsonResponse(200, {
          success: true,
          data: { items, page: 1, pageSize: 20, total: items.length, totalPages: items.length },
        });
      }

      if (url === 'http://localhost:3004/notifications?page=1&pageSize=20') {
        return jsonResponse(200, {
          success: true,
          data: { items: [], page: 1, pageSize: 20, total: 0, totalPages: 0 },
        });
      }

      if (url === 'http://localhost:3002/videos' && method === 'POST') {
        uploaded = true;
        return jsonResponse(202, {
          success: true,
          data: { id: completedVideo.id, status: 'QUEUED', attempt: 1 },
        });
      }

      if (url === `http://localhost:3002/videos/${completedVideo.id}/download`) {
        return {
          status: 200,
          ok: true,
          blob: jest.fn<() => Promise<Blob>>().mockResolvedValue(archive),
          headers: new Headers({
            'content-disposition': `attachment; filename="frames-${completedVideo.id}.zip"`,
          }),
        } as unknown as Response;
      }

      return jsonResponse(404, { success: false });
    });
    const sessionStore = new SessionStore(sessionStorage);
    const createClient = (baseUrl: string): HttpClient =>
      new HttpClient({
        baseUrl,
        timeoutMs: 100,
        fetchImplementation,
        onUnauthorized: () => sessionStore.clear('unauthorized'),
      });
    const application = new Application(
      document.body,
      new AuthClient(createClient('http://localhost:3001')),
      sessionStore,
      new DashboardService(
        new VideoClient(createClient('http://localhost:3002')),
        new NotificationClient(createClient('http://localhost:3004')),
      ),
    );
    const createObjectUrl = jest.fn<(blob: Blob) => string>().mockReturnValue('blob:archive');
    const revokeObjectUrl = jest.fn<(url: string) => void>();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectUrl });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectUrl });
    const clickSpy = jest
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);

    application.mount();
    const username = document.querySelector<HTMLInputElement>('input[name="username"]');
    const password = document.querySelector<HTMLInputElement>('input[name="password"]');
    const loginForm = document.querySelector<HTMLFormElement>('.login-form');

    if (username !== null && password !== null) {
      username.value = 'flow.user';
      password.value = 'password';
    }
    loginForm?.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));
    await flushUi();
    await flushUi();
    expect(document.body.textContent).toContain('Pessoa do Fluxo');

    const fileInput = document.querySelector<HTMLInputElement>('input[name="video"]');
    const uploadForm = document.querySelector<HTMLFormElement>('.upload-form');
    Object.defineProperty(fileInput, 'files', {
      configurable: true,
      value: [new File(['video'], 'resultado-final.mp4')],
    });
    uploadForm?.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));
    await flushUi();
    await flushUi();
    expect(document.body.textContent).toContain('resultado-final.mp4');
    expect(document.body.textContent).toContain('CONCLUÍDO');

    document.querySelector<HTMLButtonElement>('[data-action="download"]')?.click();
    await flushUi();
    expect(createObjectUrl).toHaveBeenCalledWith(archive);
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:archive');
    expect(clickSpy).toHaveBeenCalledTimes(1);

    document.querySelector<HTMLButtonElement>('.logout-button')?.click();
    expect(sessionStorage.getItem('fiap-x.access-token')).toBeNull();
    expect(document.body.textContent).not.toContain('resultado-final.mp4');
    expect(document.body.textContent).toContain('ACESSO RESTRITO');
    application.unmount();
  });
});

afterEach(() => {
  document.body.replaceChildren();
  sessionStorage.clear();
  jest.restoreAllMocks();
});
