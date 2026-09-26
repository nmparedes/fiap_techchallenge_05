import type { NotificationView } from './notification-client.js';
import { NotificationClient } from './notification-client.js';
import { createTooltipControl } from './tooltip.js';
import {
  DashboardRequestError,
  VideoClient,
  type DownloadedArchive,
  type VideoView,
} from './video-client.js';
import { validateUpload } from './upload-validation.js';

interface VideoUploadGateway {
  upload(file: File, fps: number, accessToken: string): Promise<unknown>;
}

export const POLLING_INTERVAL_MS = 3_000;
type NextRefreshListener = (nextRefreshAt: number | null) => void;

export interface DashboardSnapshot {
  videos: VideoView[];
  notifications: NotificationView[];
}

export interface DashboardGateway {
  load(accessToken: string): Promise<DashboardSnapshot>;
  upload(file: File, fps: number, accessToken: string): Promise<void>;
  retry(videoId: string, accessToken: string): Promise<void>;
  removeFromQueue(videoId: string, accessToken: string): Promise<void>;
  download(videoId: string, accessToken: string): Promise<DownloadedArchive>;
}

export class DashboardService implements DashboardGateway {
  public constructor(
    private readonly videoClient: VideoClient,
    private readonly notificationClient: NotificationClient,
    private readonly uploadGateway: VideoUploadGateway = videoClient,
  ) {}

  public async load(accessToken: string): Promise<DashboardSnapshot> {
    const [videoPage, notifications] = await Promise.all([
      this.videoClient.list(accessToken),
      this.notificationClient.list(accessToken),
    ]);
    const videos = await Promise.all(
      videoPage.items.map(async (video) => {
        if (video.status !== 'FAILED') {
          return video;
        }

        try {
          const status = await this.videoClient.status(video.id, accessToken);
          return {
            ...status.video,
            errorMessage: status.processingFailure ?? status.video.errorMessage,
          };
        } catch {
          return video;
        }
      }),
    );

    return { videos, notifications };
  }

  public async upload(file: File, fps: number, accessToken: string): Promise<void> {
    await this.uploadGateway.upload(file, fps, accessToken);
  }

  public async retry(videoId: string, accessToken: string): Promise<void> {
    await this.videoClient.retry(videoId, accessToken);
  }

  public async removeFromQueue(videoId: string, accessToken: string): Promise<void> {
    await this.videoClient.removeFromQueue(videoId, accessToken);
  }

  public download(videoId: string, accessToken: string): Promise<DownloadedArchive> {
    return this.videoClient.download(videoId, accessToken);
  }
}

export class PollingController {
  private timer: number | null = null;
  private running = false;
  private stopped = true;
  private rerunRequested = false;

  public constructor(
    private readonly task: () => Promise<void>,
    private readonly pageDocument: Document = document,
    private readonly intervalMs = POLLING_INTERVAL_MS,
    private readonly onNextRefreshChange: NextRefreshListener = () => undefined,
    private readonly now: () => number = () => Date.now(),
  ) {}

  public start(): void {
    if (!this.stopped) {
      return;
    }

    this.stopped = false;
    this.pageDocument.addEventListener('visibilitychange', this.handleVisibilityChange);

    if (!this.pageDocument.hidden) {
      this.onNextRefreshChange(null);
      this.refreshNow();
    }
  }

  public stop(): void {
    this.stopped = true;
    this.rerunRequested = false;
    this.clearTimer();
    this.onNextRefreshChange(null);
    this.pageDocument.removeEventListener('visibilitychange', this.handleVisibilityChange);
  }

  public refreshNow(): void {
    if (this.stopped || this.pageDocument.hidden) {
      return;
    }

    if (this.running) {
      this.rerunRequested = true;
      return;
    }

    this.clearTimer();
    void this.execute();
  }

  private readonly handleVisibilityChange = (): void => {
    if (this.pageDocument.hidden) {
      this.clearTimer();
      return;
    }

    this.refreshNow();
  };

  private async execute(): Promise<void> {
    this.running = true;
    this.onNextRefreshChange(null);

    try {
      await this.task();
    } catch {
      // The dashboard task renders its own user-facing error state.
    } finally {
      this.running = false;

      if (this.rerunRequested) {
        this.rerunRequested = false;
        this.refreshNow();
      } else {
        this.schedule();
      }
    }
  }

  private schedule(): void {
    if (this.stopped || this.pageDocument.hidden) {
      return;
    }

    const nextRefreshAt = this.now() + this.intervalMs;
    this.onNextRefreshChange(nextRefreshAt);
    this.timer = window.setTimeout(() => {
      this.timer = null;
      this.refreshNow();
    }, this.intervalMs);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
      this.onNextRefreshChange(null);
    }
  }
}

export type DownloadHandler = (archive: DownloadedArchive) => void;

function saveArchive(archive: DownloadedArchive): void {
  const url = URL.createObjectURL(archive.data);
  const link = document.createElement('a');
  link.href = url;
  link.download = archive.filename;
  link.click();
  URL.revokeObjectURL(url);
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('pt-BR', {
        dateStyle: 'short',
        timeStyle: 'short',
      }).format(date);
}

const statusLabels = {
  QUEUED: 'NA FILA',
  PROCESSING: 'PROCESSANDO',
  COMPLETED: 'CONCLUÍDO',
  FAILED: 'FALHOU',
} as const;

export function renderVideos(container: HTMLElement, videos: readonly VideoView[]): void {
  container.replaceChildren();

  if (videos.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'Nenhum vídeo enviado até agora.';
    container.append(empty);
    return;
  }

  const table = document.createElement('table');
  table.innerHTML = `
    <thead>
      <tr>
        <th>Arquivo</th>
        <th>FPS</th>
        <th>Status</th>
        <th>Tentativa</th>
        <th>Atualizado</th>
        <th>Ação</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;
  const body = table.querySelector('tbody') as HTMLTableSectionElement;

  videos.forEach((video) => {
    const row = document.createElement('tr');
    const nameCell = document.createElement('td');
    nameCell.dataset['label'] = 'Arquivo';
    nameCell.textContent = video.originalName;

    if (video.status === 'FAILED' && video.errorMessage !== null) {
      const error = document.createElement('small');
      error.className = 'video-error';
      error.textContent = video.errorMessage;
      nameCell.append(error);
    }

    const fpsCell = createCell('FPS', String(video.fps));
    const statusCell = createCell('Status', '');
    const badge = document.createElement('span');
    badge.className = `badge badge-${video.status.toLowerCase()}`;
    badge.textContent = statusLabels[video.status];
    statusCell.append(badge);
    const attemptCell = createCell('Tentativa', String(video.attempt));
    const updatedCell = createCell('Atualizado', formatTimestamp(video.updatedAt));
    const actionCell = createCell('Ação', '---');

    if (video.status === 'QUEUED') {
      actionCell.replaceChildren(createActionButton('remove', video.id, '[ REMOVER DA FILA ]'));
    } else if (video.status === 'COMPLETED' && video.downloadAvailable) {
      actionCell.replaceChildren(createActionButton('download', video.id, '[ BAIXAR ]'));
    } else if (video.status === 'FAILED') {
      const actionGroup = document.createElement('span');
      actionGroup.className = 'action-group';
      const retryButton = createActionButton('retry', video.id, '[ TENTAR NOVAMENTE ]');
      const tooltipId = `retry-tooltip-${video.id}`;
      retryButton.setAttribute('aria-describedby', tooltipId);
      actionGroup.append(
        retryButton,
        createTooltipControl(
          tooltipId,
          `nova tentativa de ${video.originalName}`,
          'Disponível porque o processamento falhou. Envia o mesmo vídeo para uma nova tentativa.',
        ),
      );
      actionCell.replaceChildren(actionGroup);
    }

    row.append(nameCell, fpsCell, statusCell, attemptCell, updatedCell, actionCell);
    body.append(row);
  });

  container.append(table);
}

function createCell(label: string, value: string): HTMLTableCellElement {
  const cell = document.createElement('td');
  cell.dataset['label'] = label;
  cell.textContent = value;
  return cell;
}

function createActionButton(
  action: 'download' | 'retry' | 'remove',
  videoId: string,
  label: string,
): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = `button button-compact video-action ${action === 'retry' || action === 'remove' ? 'button-danger' : ''}`;
  button.type = 'button';
  button.dataset['action'] = action;
  button.dataset['videoId'] = videoId;
  button.textContent = label;
  return button;
}

export function renderNotifications(
  container: HTMLElement,
  notifications: readonly NotificationView[],
): void {
  container.replaceChildren();

  if (notifications.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'Nenhuma notificação interna.';
    container.append(empty);
    return;
  }

  const list = document.createElement('ol');
  list.className = 'notification-list';

  notifications.forEach((notification) => {
    const item = document.createElement('li');
    const mark = document.createElement('span');
    mark.className = 'notification-mark notification-mark-error';
    mark.textContent = '!';
    const content = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent =
      notification.errorCode === 'FFMPEG_ERROR' ? 'Falha no FFmpeg' : 'Falha no ZIP';
    const message = document.createElement('p');
    message.textContent = `${notification.message} · tentativa ${notification.attempt}`;
    content.append(title, message);
    const time = document.createElement('time');
    time.dateTime = notification.createdAt;
    time.textContent = formatTimestamp(notification.createdAt);
    item.append(mark, content, time);
    list.append(item);
  });

  container.append(list);
}

export class DashboardController {
  private readonly poller: PollingController;
  private readonly uploadForm: HTMLFormElement;
  private readonly fileInput: HTMLInputElement;
  private readonly fpsInput: HTMLInputElement;
  private readonly uploadButton: HTMLButtonElement;
  private readonly uploadStatus: HTMLElement;
  private readonly dashboardStatus: HTMLElement;
  private readonly videosContainer: HTMLElement;
  private readonly notificationsContainer: HTMLElement;
  private readonly refreshCountdown: HTMLElement;
  private lastSnapshotSignature: string | null = null;
  private countdownTimer: number | null = null;

  public constructor(
    private readonly root: HTMLElement,
    private readonly gateway: DashboardGateway,
    private readonly accessToken: string,
    private readonly downloadHandler: DownloadHandler = saveArchive,
  ) {
    this.uploadForm = root.querySelector('.upload-form') as HTMLFormElement;
    this.fileInput = root.querySelector('input[name="video"]') as HTMLInputElement;
    this.fpsInput = root.querySelector('input[name="fps"]') as HTMLInputElement;
    this.uploadButton = root.querySelector('.upload-submit') as HTMLButtonElement;
    this.uploadStatus = root.querySelector('.upload-status') as HTMLElement;
    this.dashboardStatus = root.querySelector('.dashboard-status') as HTMLElement;
    this.videosContainer = root.querySelector('.videos-content') as HTMLElement;
    this.notificationsContainer = root.querySelector('.notifications-content') as HTMLElement;
    this.refreshCountdown = root.querySelector('.refresh-countdown') as HTMLElement;
    this.poller = new PollingController(
      () => this.refresh(),
      document,
      POLLING_INTERVAL_MS,
      (nextRefreshAt) => this.setNextRefresh(nextRefreshAt),
    );
  }

  public mount(): void {
    this.uploadForm.addEventListener('submit', this.handleUpload);
    this.uploadButton.addEventListener('click', this.handleUpload);
    this.fileInput.addEventListener('change', this.handleFileSelection);
    this.fpsInput.addEventListener('input', this.handleFpsInput);
    this.root.addEventListener('click', this.handleAction);
    this.poller.start();
  }

  public destroy(): void {
    this.poller.stop();
    this.clearCountdownTimer();
    this.uploadForm.removeEventListener('submit', this.handleUpload);
    this.uploadButton.removeEventListener('click', this.handleUpload);
    this.fileInput.removeEventListener('change', this.handleFileSelection);
    this.fpsInput.removeEventListener('input', this.handleFpsInput);
    this.root.removeEventListener('click', this.handleAction);
  }

  private readonly handleFileSelection = (): void => {
    const file = this.fileInput.files?.[0];
    this.fileInput.removeAttribute('aria-invalid');
    this.uploadStatus.textContent =
      file === undefined ? 'Aguardando seleção.' : `Selecionado: ${file.name}`;
  };

  private setNextRefresh(nextRefreshAt: number | null): void {
    this.clearCountdownTimer();

    if (nextRefreshAt === null) {
      this.refreshCountdown.textContent = document.hidden ? 'ATUALIZAÇÃO PAUSADA' : 'ATUALIZANDO...';
      return;
    }

    const renderRemainingSeconds = (): void => {
      const seconds = Math.max(0, Math.ceil((nextRefreshAt - Date.now()) / 1_000));
      this.refreshCountdown.textContent = `ATUALIZAÇÃO ${seconds}s`;
    };

    renderRemainingSeconds();
    this.countdownTimer = window.setInterval(renderRemainingSeconds, 1_000);
  }

  private clearCountdownTimer(): void {
    if (this.countdownTimer !== null) {
      window.clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
  }

  private readonly handleFpsInput = (): void => {
    this.fpsInput.removeAttribute('aria-invalid');
  };

  private readonly handleUpload = (event: Event): void => {
    event.preventDefault();
    const validation = validateUpload(this.fileInput.files?.[0], this.fpsInput.value);

    if (!validation.valid) {
      this.uploadStatus.textContent = validation.error.message;
      const invalidInput = validation.error.field === 'video' ? this.fileInput : this.fpsInput;
      invalidInput.setAttribute('aria-invalid', 'true');
      invalidInput.focus();
      return;
    }

    void this.submitUpload(validation.value.file, validation.value.fps);
  };

  private readonly handleAction = (event: MouseEvent): void => {
    const target = event.target;

    if (!(target instanceof Element)) {
      return;
    }

    const button = target.closest<HTMLButtonElement>('.video-action');
    const action = button?.dataset['action'];
    const videoId = button?.dataset['videoId'];

    if (button === null || button === undefined || videoId === undefined) {
      return;
    }

    if (action === 'retry') {
      void this.retry(videoId, button);
    } else if (action === 'download') {
      void this.download(videoId, button);
    } else if (action === 'remove') {
      void this.removeFromQueue(videoId, button);
    }
  };

  private async submitUpload(file: File, fps: number): Promise<void> {
    this.setUploadPending(true);
    this.uploadStatus.textContent = 'Enviando vídeo...';

    try {
      await this.gateway.upload(file, fps, this.accessToken);
      this.uploadForm.reset();
      this.fpsInput.value = '1';
      this.uploadStatus.textContent = 'Resposta recebida: vídeo enviado para a fila.';
      this.poller.refreshNow();
    } catch (error) {
      this.uploadStatus.textContent = this.errorMessage(error);
    } finally {
      this.setUploadPending(false);
    }
  }

  private async retry(videoId: string, button: HTMLButtonElement): Promise<void> {
    button.disabled = true;
    this.dashboardStatus.textContent = 'Solicitando nova tentativa...';

    try {
      await this.gateway.retry(videoId, this.accessToken);
      this.dashboardStatus.textContent = 'Nova tentativa solicitada.';
      this.poller.refreshNow();
    } catch (error) {
      this.dashboardStatus.textContent = this.errorMessage(error);
      button.disabled = false;
    }
  }

  private async removeFromQueue(videoId: string, button: HTMLButtonElement): Promise<void> {
    button.disabled = true;
    this.dashboardStatus.textContent = 'Removendo vídeo da fila...';

    try {
      await this.gateway.removeFromQueue(videoId, this.accessToken);
      this.dashboardStatus.textContent = 'Vídeo removido da fila.';
      this.poller.refreshNow();
    } catch (error) {
      this.dashboardStatus.textContent = this.errorMessage(error);
      button.disabled = false;
    }
  }

  private async download(videoId: string, button: HTMLButtonElement): Promise<void> {
    button.disabled = true;
    this.dashboardStatus.textContent = 'Preparando arquivo...';

    try {
      const archive = await this.gateway.download(videoId, this.accessToken);
      this.downloadHandler(archive);
      this.dashboardStatus.textContent = 'Download iniciado.';
    } catch (error) {
      this.dashboardStatus.textContent = this.errorMessage(error);
    } finally {
      button.disabled = false;
    }
  }

  private async refresh(): Promise<void> {
    try {
      const snapshot = await this.gateway.load(this.accessToken);
      const signature = JSON.stringify(snapshot);

      if (signature === this.lastSnapshotSignature) {
        return;
      }

      this.lastSnapshotSignature = signature;
      renderVideos(this.videosContainer, snapshot.videos);
      renderNotifications(this.notificationsContainer, snapshot.notifications);
      this.dashboardStatus.textContent = 'Painel atualizado com novas informações.';
    } catch (error) {
      this.dashboardStatus.textContent = this.errorMessage(error);
    }
  }

  private setUploadPending(pending: boolean): void {
    this.fileInput.disabled = pending;
    this.fpsInput.disabled = pending;
    this.uploadButton.disabled = pending;
  }

  private errorMessage(error: unknown): string {
    return error instanceof DashboardRequestError
      ? error.message
      : 'Não foi possível concluir a operação.';
  }
}
