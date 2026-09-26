export interface FrontendConfig {
  authApiBaseUrl: string;
  videoApiBaseUrl: string;
  notificationApiBaseUrl: string;
  requestTimeoutMs: number;
}

export const DEFAULT_AUTH_API_BASE_URL = 'http://localhost:3001';
export const DEFAULT_VIDEO_API_BASE_URL = 'http://localhost:3002';
export const DEFAULT_NOTIFICATION_API_BASE_URL = 'http://localhost:3004';
export const DEFAULT_REQUEST_TIMEOUT_MS = 8_000;

function readPublicUrl(
  environment: Record<string, unknown>,
  variableName: string,
  fallback: string,
): string {
  const configuredValue = environment[variableName];
  const candidate =
    typeof configuredValue === 'string' && configuredValue.trim() !== ''
      ? configuredValue.trim()
      : fallback;

  let url: URL;

  try {
    url = new URL(candidate);
  } catch {
    throw new Error(`${variableName} must be a valid absolute URL`);
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`${variableName} must use HTTP or HTTPS`);
  }

  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') {
    throw new Error(`${variableName} cannot contain credentials, query, or fragment`);
  }

  return url.toString().replace(/\/$/, '');
}

export function loadFrontendConfig(environment: Record<string, unknown>): FrontendConfig {
  return {
    authApiBaseUrl: readPublicUrl(environment, 'VITE_AUTH_API_BASE_URL', DEFAULT_AUTH_API_BASE_URL),
    videoApiBaseUrl: readPublicUrl(
      environment,
      'VITE_VIDEO_API_BASE_URL',
      DEFAULT_VIDEO_API_BASE_URL,
    ),
    notificationApiBaseUrl: readPublicUrl(
      environment,
      'VITE_NOTIFICATION_API_BASE_URL',
      DEFAULT_NOTIFICATION_API_BASE_URL,
    ),
    requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
  };
}
