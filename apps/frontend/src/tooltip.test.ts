import { afterEach, describe, expect, test } from '@jest/globals';

import { createLoginPanel, createUploadPanel } from './app.js';
import { renderVideos } from './dashboard.js';
import { TooltipController } from './tooltip.js';
import type { VideoView } from './video-client.js';

function failedVideo(): VideoView {
  return {
    id: '83402742-e221-4670-97eb-8eb51d123ddb',
    originalName: 'falha.mp4',
    extension: 'mp4',
    sizeBytes: '1024',
    fps: 1,
    status: 'FAILED',
    attempt: 1,
    errorCode: 'FFMPEG_ERROR',
    errorMessage: 'Falha ao processar',
    downloadAvailable: false,
    processingStartedAt: null,
    completedAt: null,
    createdAt: '2026-09-13T12:00:00.000Z',
    updatedAt: '2026-09-13T12:01:00.000Z',
  };
}

function buildTooltipSurface(): { root: HTMLElement; controller: TooltipController } {
  const root = document.createElement('div');
  const videos = document.createElement('div');
  renderVideos(videos, [failedVideo()]);
  root.append(createLoginPanel(), createUploadPanel(), videos);
  document.body.append(root);
  const controller = new TooltipController(root);
  controller.start();
  return { root, controller };
}

describe('accessible tooltips', () => {
  test.each([
    'Ajuda sobre usuário',
    'Ajuda sobre senha',
    'Ajuda sobre arquivo de vídeo',
    'Ajuda sobre imagens por segundo',
    'Ajuda sobre nova tentativa de falha.mp4',
  ])('opens and closes %s with pointer, focus, and keyboard', (accessibleName) => {
    const { root, controller } = buildTooltipSurface();
    const trigger = Array.from(root.querySelectorAll<HTMLButtonElement>('.tooltip-trigger')).find(
      (button) => button.getAttribute('aria-label') === accessibleName,
    );
    const tooltipId = trigger?.getAttribute('aria-controls');
    const tooltip = tooltipId === null ? null : root.querySelector<HTMLElement>(`#${tooltipId}`);

    expect(trigger).toBeDefined();
    expect(tooltip?.hidden).toBe(true);

    trigger?.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
    expect(tooltip?.hidden).toBe(false);
    trigger?.dispatchEvent(
      new MouseEvent('pointerout', { bubbles: true, relatedTarget: document.body }),
    );
    expect(tooltip?.hidden).toBe(true);

    trigger?.focus();
    expect(tooltip?.hidden).toBe(false);
    trigger?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(tooltip?.hidden).toBe(true);

    trigger?.focus();
    document.body.focus();
    trigger?.dispatchEvent(
      new FocusEvent('focusout', { bubbles: true, relatedTarget: document.body }),
    );
    expect(tooltip?.hidden).toBe(true);
    controller.destroy();
    root.remove();
  });

  test('explains FPS completely', () => {
    const panel = createUploadPanel();
    const tooltip = panel.querySelector<HTMLElement>('#fps-tooltip');

    expect(tooltip?.textContent).toBe(
      'Define quantas imagens são extraídas por segundo. Use um número inteiro de 1 a 10; o padrão é 1.',
    );
    expect(tooltip?.role).toBe('tooltip');
  });
});

afterEach(() => {
  document.body.replaceChildren();
});
