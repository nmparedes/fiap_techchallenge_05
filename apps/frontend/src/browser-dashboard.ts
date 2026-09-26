import type { DashboardGateway, DashboardSnapshot } from './dashboard.js';
import type { NotificationView } from './notification-client.js';
import {
  DashboardRequestError,
  type DownloadedArchive,
  type VideoPage,
  type VideoStatusResult,
} from './video-client.js';
import { createBrowserVideoUploadGateway } from './browser-video-upload.js';

interface SuccessResponse<T> {
  success: true;
  data: T;
}

interface FailedVideoStatusResponse {
  success: false;
  data: VideoStatusResult['video'];
  error: { code: string; message: string };
}

interface NotificationPage {
  items: NotificationView[];
}

export interface BrowserDashboardOptions {
  fetchImplementation?: typeof fetch;
  origin?: string;
}

export function createBrowserDashboardGateway(
  options: BrowserDashboardOptions = {},
): DashboardGateway {
  const fetchImplementation = options.fetchImplementation ?? window.fetch.bind(window);
  const origin = options.origin ?? window.location.origin;
  const uploadGateway = createBrowserVideoUploadGateway({ fetchImplementation, origin });

  return {
    async load(accessToken: string): Promise<DashboardSnapshot> {
      const [videoResult, notificationResult] = await Promise.allSettled([
        requestSuccess<VideoPage>(
          fetchImplementation,
          origin,
          '/videos?page=1&pageSize=20',
          accessToken,
          'O serviço de vídeos está indisponível.',
        ),
        requestSuccess<NotificationPage>(
          fetchImplementation,
          origin,
          '/notifications?page=1&pageSize=20',
          accessToken,
          'O serviço de notificações está indisponível.',
        ),
      ]);
      if (videoResult.status === 'rejected') {
        throw videoResult.reason;
      }

      const videoPage = videoResult.value;
      const notifications =
        notificationResult.status === 'fulfilled' ? notificationResult.value.items : [];

      const videos = await Promise.all(
        videoPage.items.map(async (video) => {
          if (video.status !== 'FAILED') {
            return video;
          }

          try {
            const status = await requestVideoStatus(fetchImplementation, origin, video.id, accessToken);
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
    },

    upload: uploadGateway.upload,

    async retry(videoId: string, accessToken: string): Promise<void> {
      await requestSuccess<unknown>(
        fetchImplementation,
        origin,
        `/videos/${encodeURIComponent(videoId)}/retry`,
        accessToken,
        'O serviço de vídeos está indisponível.',
        { method: 'POST' },
      );
    },

    async removeFromQueue(videoId: string, accessToken: string): Promise<void> {
      await requestNoContent(
        fetchImplementation,
        origin,
        `/videos/${encodeURIComponent(videoId)}`,
        accessToken,
        'O serviço de vídeos está indisponível.',
        { method: 'DELETE' },
      );
    },

    async download(videoId: string, accessToken: string): Promise<DownloadedArchive> {
      let response: Response;

      try {
        response = await fetchImplementation(
          new URL(`/videos/${encodeURIComponent(videoId)}/download`, origin),
          { headers: { Authorization: `Bearer ${accessToken}`, Accept: '*/*' } },
        );
      } catch {
        throw new DashboardRequestError(null, 'O serviço de vídeos está indisponível.');
      }

      if (!response.ok) {
        throw new DashboardRequestError(response.status, videoErrorMessage(response.status));
      }

      try {
        return {
          data: await response.blob(),
          filename: downloadFilename(response.headers.get('content-disposition'), videoId),
        };
      } catch {
        throw new DashboardRequestError(null, 'O serviço de vídeos está indisponível.');
      }
    },
  };
}

async function requestVideoStatus(
  fetchImplementation: typeof fetch,
  origin: string,
  videoId: string,
  accessToken: string,
): Promise<VideoStatusResult> {
  const payload = await requestJson(
    fetchImplementation,
    origin,
    `/videos/${encodeURIComponent(videoId)}`,
    accessToken,
    'O serviço de vídeos está indisponível.',
  );

  if (isFailedVideoStatusResponse(payload)) {
    return { video: payload.data, processingFailure: payload.error.message };
  }

  return { video: unwrapSuccess(payload) as VideoStatusResult['video'], processingFailure: null };
}

async function requestSuccess<T>(
  fetchImplementation: typeof fetch,
  origin: string,
  path: string,
  accessToken: string,
  unavailableMessage: string,
  init: RequestInit = {},
): Promise<T> {
  return unwrapSuccess(
    await requestJson(fetchImplementation, origin, path, accessToken, unavailableMessage, init),
  ) as T;
}

async function requestJson(
  fetchImplementation: typeof fetch,
  origin: string,
  path: string,
  accessToken: string,
  unavailableMessage: string,
  init: RequestInit = {},
): Promise<unknown> {
  let response: Response;

  try {
    response = await fetchImplementation(new URL(path, origin), {
      ...init,
      headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}`, ...init.headers },
    });
  } catch {
    throw new DashboardRequestError(null, unavailableMessage);
  }

  if (!response.ok) {
    throw new DashboardRequestError(response.status, videoErrorMessage(response.status, unavailableMessage));
  }

  try {
    return await response.json();
  } catch {
    throw new DashboardRequestError(null, 'O serviço retornou uma resposta inválida.');
  }
}

async function requestNoContent(
  fetchImplementation: typeof fetch,
  origin: string,
  path: string,
  accessToken: string,
  unavailableMessage: string,
  init: RequestInit,
): Promise<void> {
  let response: Response;

  try {
    response = await fetchImplementation(new URL(path, origin), {
      ...init,
      headers: { Authorization: `Bearer ${accessToken}`, ...init.headers },
    });
  } catch {
    throw new DashboardRequestError(null, unavailableMessage);
  }

  if (!response.ok) {
    throw new DashboardRequestError(response.status, videoErrorMessage(response.status, unavailableMessage));
  }
}

function unwrapSuccess(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || (value as Record<string, unknown>)['success'] !== true) {
    throw new DashboardRequestError(null, 'O serviço retornou uma resposta inválida.');
  }

  return (value as SuccessResponse<unknown>).data;
}

function isFailedVideoStatusResponse(value: unknown): value is FailedVideoStatusResponse {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const payload = value as Record<string, unknown>;
  const error = payload['error'];

  return (
    payload['success'] === false &&
    typeof payload['data'] === 'object' &&
    payload['data'] !== null &&
    typeof error === 'object' &&
    error !== null &&
    typeof (error as Record<string, unknown>)['message'] === 'string'
  );
}

function videoErrorMessage(status: number, fallback = 'O serviço de vídeos está indisponível.'): string {
  if (status === 400) {
    return 'Verifique os dados enviados.';
  }

  if (status === 404) {
    return 'O vídeo não foi encontrado.';
  }

  if (status === 409) {
    return 'A ação não está disponível para este vídeo.';
  }

  return fallback;
}

function downloadFilename(contentDisposition: string | null, videoId: string): string {
  const match = contentDisposition?.match(/filename="?([^";]+)"?/i);
  return match?.[1] ?? `frames-${videoId}.zip`;
}
