import { describe, expect, it, jest } from '@jest/globals';

import {
  VIDEO_CACHE_TTL_SECONDS,
  getCachedUserVideos,
  getCachedVideoDetails,
  invalidateVideoCache,
  userVideosCacheKey,
  videoDetailsCacheKey,
  type VideoCacheClient,
} from './video-cache.js';

const userId = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA';
const normalizedUserId = userId.toLowerCase();
const videoId = 'BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB';
const normalizedVideoId = videoId.toLowerCase();

function createClient() {
  return {
    get: jest.fn<VideoCacheClient['get']>(),
    setEx: jest.fn<VideoCacheClient['setEx']>(),
    del: jest.fn<VideoCacheClient['del']>(),
  };
}

describe('video Redis cache', () => {
  it('builds only the normalized detail and listing keys', () => {
    expect(videoDetailsCacheKey(userId, videoId)).toBe(
      `video:${normalizedUserId}:${normalizedVideoId}`,
    );
    expect(userVideosCacheKey(userId)).toBe(`videos:${normalizedUserId}`);
    expect(VIDEO_CACHE_TTL_SECONDS).toBe(30);
  });

  it.each([
    ['userId', '../../etc', videoId],
    ['videoId', userId, '../video'],
  ])('rejects a malicious %s in cache keys', (_field, candidateUserId, candidateVideoId) => {
    expect(() => videoDetailsCacheKey(candidateUserId, candidateVideoId)).toThrow(
      'must be a valid UUID',
    );
  });

  it('returns cached details without querying MySQL', async () => {
    const client = createClient();
    const cached = { id: normalizedVideoId, status: 'QUEUED' };
    client.get.mockResolvedValue(JSON.stringify(cached));
    const loadFromMySql = jest.fn<() => Promise<typeof cached>>();

    await expect(getCachedVideoDetails(client, userId, videoId, loadFromMySql)).resolves.toEqual(
      cached,
    );
    expect(client.get).toHaveBeenCalledWith(`video:${normalizedUserId}:${normalizedVideoId}`);
    expect(loadFromMySql).not.toHaveBeenCalled();
    expect(client.setEx).not.toHaveBeenCalled();
  });

  it('loads listing misses from MySQL and caches them for exactly 30 seconds', async () => {
    const client = createClient();
    const videos = [{ id: normalizedVideoId }];
    client.get.mockResolvedValue(null);
    client.setEx.mockResolvedValue('OK');
    const loadFromMySql = jest.fn<() => Promise<typeof videos>>().mockResolvedValue(videos);

    await expect(getCachedUserVideos(client, userId, loadFromMySql)).resolves.toEqual(videos);
    expect(loadFromMySql).toHaveBeenCalledTimes(1);
    expect(client.setEx).toHaveBeenCalledWith(
      `videos:${normalizedUserId}`,
      30,
      JSON.stringify(videos),
    );
  });

  it('falls back to MySQL when Redis reads and writes are unavailable', async () => {
    const client = createClient();
    const video = { id: normalizedVideoId, status: 'PROCESSING' };
    client.get.mockRejectedValue(new Error('Redis unavailable'));
    client.setEx.mockRejectedValue(new Error('Redis unavailable'));
    const loadFromMySql = jest.fn<() => Promise<typeof video>>().mockResolvedValue(video);

    await expect(getCachedVideoDetails(client, userId, videoId, loadFromMySql)).resolves.toEqual(
      video,
    );
    expect(loadFromMySql).toHaveBeenCalledTimes(1);
  });

  it('treats corrupt cached JSON as a miss', async () => {
    const client = createClient();
    client.get.mockResolvedValue('{broken');
    client.setEx.mockResolvedValue('OK');
    const loadFromMySql = jest.fn<() => Promise<null>>().mockResolvedValue(null);

    await expect(getCachedVideoDetails(client, userId, videoId, loadFromMySql)).resolves.toBeNull();
    expect(client.setEx).toHaveBeenCalledWith(
      `video:${normalizedUserId}:${normalizedVideoId}`,
      30,
      'null',
    );
  });

  it('invalidates details and listings after a status or retry mutation', async () => {
    const client = createClient();
    client.del.mockResolvedValue(2);

    await expect(invalidateVideoCache(client, userId, videoId)).resolves.toBe(true);
    expect(client.del).toHaveBeenCalledWith([
      `video:${normalizedUserId}:${normalizedVideoId}`,
      `videos:${normalizedUserId}`,
    ]);
  });

  it('does not fail the mutation flow when Redis invalidation is unavailable', async () => {
    const client = createClient();
    client.del.mockRejectedValue(new Error('Redis unavailable'));

    await expect(invalidateVideoCache(client, userId, videoId)).resolves.toBe(false);
  });
});
