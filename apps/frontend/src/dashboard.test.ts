import { afterEach, describe, expect, jest, test } from '@jest/globals';

import { createAuthenticatedPanel } from './app.js';
import {
  DashboardController,
  PollingController,
  renderNotifications,
  renderVideos,
  type DashboardGateway,
} from './dashboard.js';
import type { NotificationView } from './notification-client.js';
import type { VideoStatus, VideoView } from './video-client.js';

function video(status: VideoStatus, downloadAvailable = status === 'COMPLETED'): VideoView {
  return {
    id: `${status.toLowerCase()}-video-id`,
    originalName: `${status.toLowerCase()}.mp4`,
    extension: 'mp4',
    sizeBytes: '1024',
    fps: 1,
    status,
    attempt: status === 'FAILED' ? 2 : 1,
    errorCode: status === 'FAILED' ? 'ZIP_ERROR' : null,
    errorMessage: status === 'FAILED' ? 'Não foi possível criar o ZIP' : null,
    downloadAvailable,
    processingStartedAt: null,
    completedAt: null,
    createdAt: '2026-09-13T12:00:00.000Z',
    updatedAt: '2026-09-13T12:01:00.000Z',
  };
}

function gateway(): DashboardGateway {
  return {
    load: jest.fn<DashboardGateway['load']>().mockResolvedValue({ videos: [], notifications: [] }),
    upload: jest.fn<DashboardGateway['upload']>().mockResolvedValue(undefined),
    retry: jest.fn<DashboardGateway['retry']>().mockResolvedValue(undefined),
    removeFromQueue: jest.fn<DashboardGateway['removeFromQueue']>().mockResolvedValue(undefined),
    download: jest.fn<DashboardGateway['download']>().mockResolvedValue({
      data: new Blob(['zip']),
      filename: 'frames.zip',
    }),
  };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('dashboard rendering', () => {
  test('shows download only for completed and retry only for failed videos', () => {
    const container = document.createElement('div');
    renderVideos(container, [
      video('QUEUED'),
      video('PROCESSING'),
      video('COMPLETED'),
      video('FAILED'),
    ]);

    expect(container.querySelectorAll('[data-action="download"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-action="retry"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-action="remove"]')).toHaveLength(1);
    expect(
      container.querySelector('[data-action="download"]')?.closest('tr')?.textContent,
    ).toContain('CONCLUÍDO');
    expect(container.querySelector('[data-action="retry"]')?.closest('tr')?.textContent).toContain(
      'FALHOU',
    );
    expect(container.textContent).toContain('Não foi possível criar o ZIP');
  });

  test('renders empty states and internal notifications', () => {
    const videos = document.createElement('div');
    const notifications = document.createElement('div');
    const item: NotificationView = {
      id: 'notification-id',
      videoId: 'video-id',
      attempt: 2,
      errorCode: 'FFMPEG_ERROR',
      message: 'Falha funcional',
      createdAt: '2026-09-13T12:00:00.000Z',
    };

    renderVideos(videos, []);
    renderNotifications(notifications, [item]);

    expect(videos.textContent).toContain('Nenhum vídeo');
    expect(notifications.textContent).toContain('Falha no FFmpeg');
    expect(notifications.textContent).toContain('tentativa 2');
  });

  test('renders service content as text instead of executable markup', () => {
    const videos = document.createElement('div');
    const notifications = document.createElement('div');
    const unsafeVideo = {
      ...video('FAILED'),
      originalName: '<img src=x onerror=alert(1)>',
      errorMessage: '<script>alert(1)</script>',
    };
    const unsafeNotification: NotificationView = {
      id: 'notification-id',
      videoId: unsafeVideo.id,
      attempt: 1,
      errorCode: 'ZIP_ERROR',
      message: '<img src=x onerror=alert(1)>',
      createdAt: '2026-09-13T12:00:00.000Z',
    };

    renderVideos(videos, [unsafeVideo]);
    renderNotifications(notifications, [unsafeNotification]);

    expect(videos.querySelector('img')).toBeNull();
    expect(videos.querySelector('script')).toBeNull();
    expect(notifications.querySelector('img')).toBeNull();
    expect(videos.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(videos.textContent).toContain('<script>alert(1)</script>');
    expect(notifications.textContent).toContain('<img src=x onerror=alert(1)>');
  });
});

describe('dashboard polling', () => {
  test('runs every three seconds without overlapping and stops cleanly', async () => {
    jest.useFakeTimers();
    let finishFirst: (() => void) | undefined;
    const firstRun = new Promise<void>((resolve) => {
      finishFirst = resolve;
    });
    const task = jest
      .fn<() => Promise<void>>()
      .mockReturnValueOnce(firstRun)
      .mockResolvedValue(undefined);
    const poller = new PollingController(task);

    poller.start();
    expect(task).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(9_000);
    expect(task).toHaveBeenCalledTimes(1);

    poller.refreshNow();
    finishFirst?.();
    await flushPromises();
    expect(task).toHaveBeenCalledTimes(2);

    await flushPromises();
    jest.advanceTimersByTime(2_999);
    expect(task).toHaveBeenCalledTimes(2);
    jest.advanceTimersByTime(1);
    expect(task).toHaveBeenCalledTimes(3);

    poller.stop();
    await flushPromises();
    jest.advanceTimersByTime(6_000);
    expect(task).toHaveBeenCalledTimes(3);
  });

  test('does not poll while the page is hidden', async () => {
    jest.useFakeTimers();
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    const task = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const poller = new PollingController(task);

    poller.start();
    jest.advanceTimersByTime(6_000);
    expect(task).not.toHaveBeenCalled();

    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(task).toHaveBeenCalledTimes(1);
    await flushPromises();

    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
    jest.advanceTimersByTime(6_000);
    expect(task).toHaveBeenCalledTimes(1);
    poller.stop();
  });
});

describe('dashboard controller', () => {
  test('shows selected, sending, and response-received upload states', async () => {
    const root = createAuthenticatedPanel({ accessToken: 'token', user: null });
    const service = gateway();
    let finishUpload: (() => void) | undefined;
    jest.mocked(service.upload).mockReturnValue(
      new Promise<void>((resolve) => {
        finishUpload = resolve;
      }),
    );
    const controller = new DashboardController(root, service, 'token', jest.fn());
    controller.mount();
    await flushPromises();
    const fileInput = root.querySelector<HTMLInputElement>('input[name="video"]');
    const fpsInput = root.querySelector<HTMLInputElement>('input[name="fps"]');
    const form = root.querySelector<HTMLFormElement>('.upload-form');
    const selectedFile = new File(['video'], 'aula.mp4');
    Object.defineProperty(fileInput, 'files', { configurable: true, value: [selectedFile] });

    fileInput?.dispatchEvent(new Event('change'));
    expect(root.textContent).toContain('Selecionado: aula.mp4');
    expect(form?.noValidate).toBe(true);
    root.querySelector<HTMLButtonElement>('.upload-submit')?.click();
    expect(root.textContent).toContain('Enviando vídeo...');
    expect(service.upload).toHaveBeenCalledWith(selectedFile, 1, 'token');

    finishUpload?.();
    await flushPromises();
    expect(root.textContent).toContain('Resposta recebida: vídeo enviado para a fila.');
    expect(fpsInput?.value).toBe('1');
    expect(service.load).toHaveBeenCalledTimes(2);
    controller.destroy();
  });

  test('associates validation errors with the invalid field and moves focus', async () => {
    const root = createAuthenticatedPanel({ accessToken: 'token', user: null });
    document.body.append(root);
    const service = gateway();
    const controller = new DashboardController(root, service, 'token', jest.fn());
    controller.mount();
    await flushPromises();
    const fileInput = root.querySelector<HTMLInputElement>('input[name="video"]');
    const fpsInput = root.querySelector<HTMLInputElement>('input[name="fps"]');
    const form = root.querySelector<HTMLFormElement>('.upload-form');
    Object.defineProperty(fileInput, 'files', {
      configurable: true,
      value: [new File(['video'], 'aula.mp4')],
    });

    if (fpsInput !== null) {
      fpsInput.value = '1.5';
    }
    form?.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));

    expect(fpsInput?.ariaInvalid).toBe('true');
    expect(fpsInput?.getAttribute('aria-describedby')).toContain('upload-status');
    expect(document.activeElement).toBe(fpsInput);
    expect(root.textContent).toContain('FPS deve ser um número inteiro de 1 a 10.');
    controller.destroy();
    root.remove();
  });

  test('removes a queued video and refreshes the catalog immediately', async () => {
    const root = createAuthenticatedPanel({ accessToken: 'token', user: null });
    const service = gateway();
    jest.mocked(service.load).mockResolvedValue({ videos: [video('QUEUED')], notifications: [] });
    const controller = new DashboardController(root, service, 'token', jest.fn());
    controller.mount();
    await flushPromises();

    root.querySelector<HTMLButtonElement>('[data-action="remove"]')?.click();
    await flushPromises();

    expect(service.removeFromQueue).toHaveBeenCalledWith('queued-video-id', 'token');
    expect(root.textContent).toContain('Vídeo removido da fila.');
    expect(service.load).toHaveBeenCalledTimes(2);
    controller.destroy();
  });

  test('does not replace content or announce when polling data is unchanged', async () => {
    jest.useFakeTimers();
    const root = createAuthenticatedPanel({ accessToken: 'token', user: null });
    const service = gateway();
    jest.mocked(service.load).mockResolvedValue({ videos: [video('QUEUED')], notifications: [] });
    const controller = new DashboardController(root, service, 'token', jest.fn());
    controller.mount();
    await flushPromises();
    const firstTable = root.querySelector('table');
    const firstMessage = root.querySelector('.dashboard-status')?.textContent;

    jest.advanceTimersByTime(3_000);
    await flushPromises();

    expect(service.load).toHaveBeenCalledTimes(2);
    expect(root.querySelector('table')).toBe(firstTable);
    expect(root.querySelector('.dashboard-status')?.textContent).toBe(firstMessage);
    controller.destroy();
  });

  test('counts down to the next refresh and resets after refreshing', async () => {
    jest.useFakeTimers();
    const root = createAuthenticatedPanel({ accessToken: 'token', user: null });
    const service = gateway();
    const controller = new DashboardController(root, service, 'token', jest.fn());

    controller.mount();
    await flushPromises();
    const countdown = root.querySelector('.refresh-countdown');
    expect(countdown?.textContent).toBe('ATUALIZAÇÃO 3s');

    jest.advanceTimersByTime(1_000);
    expect(countdown?.textContent).toBe('ATUALIZAÇÃO 2s');
    jest.advanceTimersByTime(1_000);
    expect(countdown?.textContent).toBe('ATUALIZAÇÃO 1s');
    jest.advanceTimersByTime(1_000);
    await flushPromises();

    expect(service.load).toHaveBeenCalledTimes(2);
    expect(countdown?.textContent).toBe('ATUALIZAÇÃO 3s');
    controller.destroy();
  });
});

afterEach(() => {
  jest.useRealTimers();
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
});
