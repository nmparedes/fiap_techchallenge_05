import { normalizeUuid } from './identifiers.js';

export const VIDEO_CACHE_TTL_SECONDS = 30;

export interface VideoCacheClient {
  get(key: string): Promise<string | null>;
  setEx(key: string, seconds: number, value: string): Promise<unknown>;
  del(keys: string[]): Promise<unknown>;
}

export type MySqlFallback<TValue> = () => Promise<TValue>;

export function videoDetailsCacheKey(userId: string, videoId: string): string {
  return `video:${normalizeUuid(userId, 'userId')}:${normalizeUuid(videoId, 'videoId')}`;
}

export function userVideosCacheKey(userId: string): string {
  return `videos:${normalizeUuid(userId, 'userId')}`;
}

async function readThroughMySql<TValue>(
  client: VideoCacheClient,
  key: string,
  loadFromMySql: MySqlFallback<TValue>,
): Promise<TValue> {
  try {
    const cached = await client.get(key);
    if (cached !== null) {
      return JSON.parse(cached) as TValue;
    }
  } catch {
    // Redis is an optimization. Corrupt data and outages both fall through to MySQL.
  }

  const value = await loadFromMySql();

  try {
    await client.setEx(key, VIDEO_CACHE_TTL_SECONDS, JSON.stringify(value));
  } catch {
    // A cache write failure must not turn a successful MySQL read into a request failure.
  }

  return value;
}

export function getCachedVideoDetails<TValue>(
  client: VideoCacheClient,
  userId: string,
  videoId: string,
  loadFromMySql: MySqlFallback<TValue>,
): Promise<TValue> {
  return readThroughMySql(client, videoDetailsCacheKey(userId, videoId), loadFromMySql);
}

export function getCachedUserVideos<TValue>(
  client: VideoCacheClient,
  userId: string,
  loadFromMySql: MySqlFallback<TValue>,
): Promise<TValue> {
  return readThroughMySql(client, userVideosCacheKey(userId), loadFromMySql);
}

export async function invalidateVideoCache(
  client: VideoCacheClient,
  userId: string,
  videoId: string,
): Promise<boolean> {
  const keys = [videoDetailsCacheKey(userId, videoId), userVideosCacheKey(userId)];

  try {
    await client.del(keys);
    return true;
  } catch {
    return false;
  }
}
