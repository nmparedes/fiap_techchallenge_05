import { HttpClient, HttpClientError } from './http-client.js';

export type VideoStatus = 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
export type ProcessingErrorCode = 'FFMPEG_ERROR' | 'ZIP_ERROR';

export interface VideoView {
  id: string;
  originalName: string;
  extension: string;
  sizeBytes: string;
  fps: number;
  status: VideoStatus;
  attempt: number;
  errorCode: ProcessingErrorCode | null;
  errorMessage: string | null;
  downloadAvailable: boolean;
  processingStartedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VideoPage {
  items: VideoView[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface AcceptedVideo {
  id: string;
  status: 'QUEUED';
  attempt: number;
}

export interface VideoStatusResult {
  video: VideoView;
  processingFailure: string | null;
}

export interface DownloadedArchive {
  data: Blob;
  filename: string;
}

interface SuccessResponse<T> {
  success: true;
  data: T;
}

interface FailedStatusResponse {
  success: false;
  data: VideoView;
  error: { code: string; message: string };
}

export class DashboardRequestError extends Error {
  public constructor(
    public readonly status: number | null,
    message: string,
  ) {
    super(message);
    this.name = 'DashboardRequestError';
  }
}

function requestMessage(error: unknown): string {
  if (!(error instanceof HttpClientError)) {
    return 'Não foi possível concluir a operação.';
  }

  if (error.status === 400) {
    return 'Verifique os dados enviados.';
  }

  if (error.status === 404) {
    return 'O vídeo não foi encontrado.';
  }

  if (error.status === 409) {
    return 'A ação não está disponível para este vídeo.';
  }

  return 'O serviço de vídeos está indisponível.';
}

function unwrapSuccess<T>(data: SuccessResponse<T> | undefined): T {
  if (data?.success !== true) {
    throw new DashboardRequestError(null, 'O serviço retornou uma resposta inválida.');
  }

  return data.data;
}

function downloadFilename(contentDisposition: string | null, videoId: string): string {
  const match = contentDisposition?.match(/filename="?([^";]+)"?/i);
  return match?.[1] ?? `frames-${videoId}.zip`;
}

export class VideoClient {
  public constructor(private readonly httpClient: HttpClient) {}

  public async list(accessToken: string): Promise<VideoPage> {
    try {
      const response = await this.httpClient.requestAuthenticated<SuccessResponse<VideoPage>>(
        '/videos?page=1&pageSize=20',
        accessToken,
      );
      return unwrapSuccess(response.data);
    } catch (error) {
      throw new DashboardRequestError(
        error instanceof HttpClientError ? error.status : null,
        requestMessage(error),
      );
    }
  }

  public async status(videoId: string, accessToken: string): Promise<VideoStatusResult> {
    try {
      const response = await this.httpClient.requestAuthenticated<
        SuccessResponse<VideoView> | FailedStatusResponse
      >(`/videos/${encodeURIComponent(videoId)}`, accessToken);
      const data = response.data;

      if (data === undefined) {
        throw new DashboardRequestError(null, 'O serviço retornou uma resposta inválida.');
      }

      if (data.success === false) {
        return { video: data.data, processingFailure: data.error.message };
      }

      return { video: data.data, processingFailure: null };
    } catch (error) {
      if (error instanceof DashboardRequestError) {
        throw error;
      }

      throw new DashboardRequestError(
        error instanceof HttpClientError ? error.status : null,
        requestMessage(error),
      );
    }
  }

  public async upload(file: File, fps: number, accessToken: string): Promise<AcceptedVideo> {
    const body = new FormData();
    body.append('video', file);
    body.append('fps', String(fps));

    try {
      const response = await this.httpClient.requestAuthenticated<SuccessResponse<AcceptedVideo>>(
        '/videos',
        accessToken,
        { method: 'POST', body },
      );
      return unwrapSuccess(response.data);
    } catch (error) {
      throw new DashboardRequestError(
        error instanceof HttpClientError ? error.status : null,
        requestMessage(error),
      );
    }
  }

  public async retry(videoId: string, accessToken: string): Promise<AcceptedVideo> {
    try {
      const response = await this.httpClient.requestAuthenticated<SuccessResponse<AcceptedVideo>>(
        `/videos/${encodeURIComponent(videoId)}/retry`,
        accessToken,
        { method: 'POST' },
      );
      return unwrapSuccess(response.data);
    } catch (error) {
      throw new DashboardRequestError(
        error instanceof HttpClientError ? error.status : null,
        requestMessage(error),
      );
    }
  }

  public async removeFromQueue(videoId: string, accessToken: string): Promise<void> {
    try {
      await this.httpClient.requestAuthenticated(
        `/videos/${encodeURIComponent(videoId)}`,
        accessToken,
        { method: 'DELETE' },
      );
    } catch (error) {
      throw new DashboardRequestError(
        error instanceof HttpClientError ? error.status : null,
        requestMessage(error),
      );
    }
  }

  public async download(videoId: string, accessToken: string): Promise<DownloadedArchive> {
    try {
      const response = await this.httpClient.requestBinaryAuthenticated(
        `/videos/${encodeURIComponent(videoId)}/download`,
        accessToken,
      );
      return {
        data: response.data,
        filename: downloadFilename(response.contentDisposition, videoId),
      };
    } catch (error) {
      throw new DashboardRequestError(
        error instanceof HttpClientError ? error.status : null,
        requestMessage(error),
      );
    }
  }
}
