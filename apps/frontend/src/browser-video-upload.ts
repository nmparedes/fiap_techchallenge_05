import { DashboardRequestError } from './video-client.js';

export interface BrowserVideoUploadGateway {
  upload(file: File, fps: number, accessToken: string): Promise<void>;
}

export interface BrowserVideoUploadOptions {
  fetchImplementation?: typeof fetch;
  origin?: string;
}

interface AcceptedVideoPayload {
  success: true;
  data: {
    id: string;
    status: 'QUEUED';
    attempt: number;
  };
}

export function createBrowserVideoUploadGateway(
  options: BrowserVideoUploadOptions = {},
): BrowserVideoUploadGateway {
  const fetchImplementation = options.fetchImplementation ?? window.fetch.bind(window);
  const origin = options.origin ?? window.location.origin;

  return {
    async upload(file: File, fps: number, accessToken: string): Promise<void> {
      const body = new FormData();
      body.append('video', file);
      body.append('fps', String(fps));

      let response: Response;

      try {
        response = await fetchImplementation(new URL('/videos', origin), {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}` },
          body,
        });
      } catch {
        throw new DashboardRequestError(null, 'O serviço de vídeos está indisponível.');
      }

      if (!response.ok) {
        throw new DashboardRequestError(response.status, uploadErrorMessage(response.status));
      }

      let payload: unknown;

      try {
        payload = await response.json();
      } catch {
        throw new DashboardRequestError(null, 'O serviço retornou uma resposta inválida.');
      }

      if (!isAcceptedVideoPayload(payload)) {
        throw new DashboardRequestError(null, 'O serviço retornou uma resposta inválida.');
      }
    },
  };
}

function uploadErrorMessage(status: number): string {
  if (status === 400) {
    return 'Verifique os dados enviados.';
  }

  return 'O serviço de vídeos está indisponível.';
}

function isAcceptedVideoPayload(value: unknown): value is AcceptedVideoPayload {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const payload = value as Record<string, unknown>;
  const data = payload['data'];

  return (
    payload['success'] === true &&
    typeof data === 'object' &&
    data !== null &&
    typeof (data as Record<string, unknown>)['id'] === 'string' &&
    (data as Record<string, unknown>)['status'] === 'QUEUED' &&
    typeof (data as Record<string, unknown>)['attempt'] === 'number'
  );
}
