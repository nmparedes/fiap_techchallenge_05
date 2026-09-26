import { HttpClient, HttpClientError } from './http-client.js';
import { DashboardRequestError, type ProcessingErrorCode } from './video-client.js';

export interface NotificationView {
  id: string;
  videoId: string;
  attempt: number;
  errorCode: ProcessingErrorCode;
  message: string;
  createdAt: string;
}

interface NotificationPage {
  items: NotificationView[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

interface NotificationListResponse {
  success: true;
  data: NotificationPage;
}

export class NotificationClient {
  public constructor(private readonly httpClient: HttpClient) {}

  public async list(accessToken: string): Promise<NotificationView[]> {
    try {
      const response = await this.httpClient.requestAuthenticated<NotificationListResponse>(
        '/notifications?page=1&pageSize=20',
        accessToken,
      );

      if (response.data?.success !== true) {
        throw new DashboardRequestError(null, 'O serviço retornou uma resposta inválida.');
      }

      return response.data.data.items;
    } catch (error) {
      if (error instanceof DashboardRequestError) {
        throw error;
      }

      throw new DashboardRequestError(
        error instanceof HttpClientError ? error.status : null,
        'O serviço de notificações está indisponível.',
      );
    }
  }
}
