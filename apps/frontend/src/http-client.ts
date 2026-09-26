export type HttpErrorKind = 'network' | 'timeout' | 'response' | 'invalid-response';

export class HttpClientError extends Error {
  public constructor(
    public readonly kind: HttpErrorKind,
    public readonly status: number | null = null,
  ) {
    super(kind);
    this.name = 'HttpClientError';
  }
}

export interface HttpClientOptions {
  baseUrl: string;
  timeoutMs: number;
  fetchImplementation?: typeof fetch;
  onUnauthorized?: () => void;
}

export interface HttpResult<T> {
  status: number;
  data: T | undefined;
}

export interface BinaryHttpResult {
  status: number;
  data: Blob;
  contentDisposition: string | null;
}

export class HttpClient {
  private readonly fetchImplementation: typeof fetch;

  public constructor(private readonly options: HttpClientOptions) {
    this.fetchImplementation = options.fetchImplementation ?? fetch;
  }

  public request<T>(path: string, init: RequestInit = {}): Promise<HttpResult<T>> {
    return this.performRequest<T>(path, init);
  }

  public requestAuthenticated<T>(
    path: string,
    accessToken: string,
    init: RequestInit = {},
  ): Promise<HttpResult<T>> {
    return this.performRequest<T>(path, init, accessToken);
  }

  public async requestBinaryAuthenticated(
    path: string,
    accessToken: string,
    init: RequestInit = {},
  ): Promise<BinaryHttpResult> {
    const response = await this.fetchResponse(path, init, accessToken, '*/*');

    if (!response.ok) {
      await this.readBody<unknown>(response);
      throw new HttpClientError('response', response.status);
    }

    try {
      return {
        status: response.status,
        data: await response.blob(),
        contentDisposition: response.headers.get('content-disposition'),
      };
    } catch {
      throw new HttpClientError('network');
    }
  }

  private async performRequest<T>(
    path: string,
    init: RequestInit,
    accessToken?: string,
  ): Promise<HttpResult<T>> {
    const response = await this.fetchResponse(path, init, accessToken, 'application/json');
    const data = await this.readBody<T>(response);

    if (!response.ok) {
      throw new HttpClientError('response', response.status);
    }

    return { status: response.status, data };
  }

  private async fetchResponse(
    path: string,
    init: RequestInit,
    accessToken: string | undefined,
    accept: string,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), this.options.timeoutMs);
    const headers = new Headers(init.headers);
    headers.set('Accept', accept);

    if (accessToken !== undefined) {
      headers.set('Authorization', `Bearer ${accessToken}`);
    }

    let response: Response;

    try {
      response = await this.fetchImplementation(
        new URL(path, `${this.options.baseUrl}/`).toString(),
        {
          ...init,
          headers,
          signal: controller.signal,
        },
      );
    } catch {
      if (controller.signal.aborted) {
        throw new HttpClientError('timeout');
      }

      throw new HttpClientError('network');
    } finally {
      window.clearTimeout(timeout);
    }

    if (response.status === 401 && accessToken !== undefined) {
      this.options.onUnauthorized?.();
    }

    return response;
  }

  private async readBody<T>(response: Response): Promise<T | undefined> {
    if (response.status === 204) {
      return undefined;
    }

    let text: string;

    try {
      text = await response.text();
    } catch {
      throw new HttpClientError('network');
    }

    if (text.trim() === '') {
      return undefined;
    }

    try {
      return JSON.parse(text) as T;
    } catch {
      throw new HttpClientError('invalid-response', response.status);
    }
  }
}
