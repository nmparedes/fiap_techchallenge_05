import { describe, expect, it, jest } from '@jest/globals';
import type { ProcessingFailedEventV1, ProcessingStartedEventV1 } from '@fiap-x/contracts';
import type { VideoCacheClient, VideoRecord } from '@fiap-x/infrastructure';
import type { ReadStream } from 'node:fs';

import type { ProcessingRequestPublisher } from './processing-publisher.js';
import { VideoFileStoreError, type VideoFileStore } from './video-files.js';
import type { VideoRepository } from './video-repository.js';
import { MAX_VIDEO_UPLOAD_BYTES } from './upload-policy.js';
import {
  InvalidVideoUploadError,
  VideoApplicationService,
  VideoConflictError,
  VideoNotFoundError,
  VideoOperationError,
} from './video-service.js';

const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const videoId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const eventId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const validMp4 = Buffer.from('000000186674797069736f6d0000000069736f6d', 'hex');

function video(overrides: Partial<VideoRecord> = {}): VideoRecord {
  return {
    id: videoId,
    userId,
    originalName: 'movie.mp4',
    extension: 'mp4',
    sizeBytes: 5n,
    fps: 1,
    status: 'FAILED',
    inputPath: `/storage/${userId}/${videoId}/input.mp4`,
    outputPath: null,
    errorCode: 'FFMPEG_ERROR',
    errorMessage: 'FFmpeg failed',
    attempt: 1,
    processingStartedAt: new Date('2026-01-01T00:01:00.000Z'),
    completedAt: new Date('2026-01-01T00:02:00.000Z'),
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:02:00.000Z'),
    ...overrides,
  };
}

function dependencies(records: VideoRecord[] = []) {
  const repository: VideoRepository = {
    create: jest.fn(async () => undefined),
    delete: jest.fn(async () => undefined),
    deleteQueued: jest.fn(async () => true),
    listByUser: jest.fn(async () => records),
    findByUser: jest.fn(async () => records[0] ?? null),
    retryFailed: jest.fn(async () => true),
    restoreFailed: jest.fn(async () => undefined),
    applyStatusEvent: jest.fn(async () => true),
    ping: jest.fn(async () => undefined),
  };
  const cache: VideoCacheClient = {
    get: jest.fn(async () => null),
    setEx: jest.fn(async () => 'OK'),
    del: jest.fn(async () => 2),
  };
  const files: VideoFileStore = {
    saveUpload: jest.fn(async () => undefined),
    deleteVideo: jest.fn(async () => undefined),
    assertInputAvailable: jest.fn(async () => undefined),
    openArchive: jest.fn(async () => ({}) as ReadStream),
  };
  const publisher: ProcessingRequestPublisher = {
    publish: jest.fn(async () => undefined),
    ping: jest.fn(async () => undefined),
  };
  const ids = [videoId, eventId];
  const service = new VideoApplicationService({
    repository,
    cache,
    files,
    publisher,
    storageRoot: '/storage',
    createId: () => {
      const id = ids.shift();
      if (id === undefined) throw new Error('No test UUID available');
      return id;
    },
    now: () => new Date('2026-01-01T00:00:00.000Z'),
  });

  return { service, repository, cache, files, publisher };
}

describe('VideoApplicationService', () => {
  it('stores, persists, and durably publishes a valid upload before accepting it', async () => {
    const fixture = dependencies();

    await expect(
      fixture.service.upload({
        userId,
        originalName: '../movie.MP4',
        content: validMp4,
        fps: 2,
      }),
    ).resolves.toEqual({ id: videoId, status: 'QUEUED', attempt: 1 });
    expect(fixture.repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        id: videoId,
        userId,
        originalName: 'movie.MP4',
        extension: 'mp4',
        sizeBytes: validMp4.length,
        fps: 2,
      }),
    );
    expect(fixture.publisher.publish).toHaveBeenCalledWith({
      eventId,
      eventType: 'video.processing.requested',
      version: 1,
      occurredAt: '2026-01-01T00:00:00.000Z',
      payload: {
        videoId,
        userId,
        sourceObjectKey: `/storage/${userId}/${videoId}/input.mp4`,
        fps: 2,
        attempt: 1,
      },
    });
    expect(fixture.cache.del).toHaveBeenCalledWith([
      `video:${userId}:${videoId}`,
      `videos:${userId}`,
    ]);
  });

  it.each([
    ['an empty file', { originalName: 'movie.mp4', content: Buffer.alloc(0), fps: 1 }],
    ['an unsupported extension', { originalName: 'movie.txt', content: Buffer.from('x'), fps: 1 }],
    ['an invalid signature', { originalName: 'movie.mp4', content: Buffer.from('x'), fps: 1 }],
    ['an FPS below the limit', { originalName: 'movie.mp4', content: validMp4, fps: 0 }],
    ['an FPS above the limit', { originalName: 'movie.mp4', content: validMp4, fps: 11 }],
    ['a fractional FPS', { originalName: 'movie.mp4', content: validMp4, fps: 1.5 }],
  ])('rejects %s before persistence', async (_case, input) => {
    const fixture = dependencies();

    await expect(fixture.service.upload({ userId, ...input })).rejects.toBeInstanceOf(
      InvalidVideoUploadError,
    );
    expect(fixture.repository.create).not.toHaveBeenCalled();
  });

  it('rejects a file above the fixed service limit before persistence', async () => {
    const fixture = dependencies();
    const oversizedContent = { length: MAX_VIDEO_UPLOAD_BYTES + 1 } as Buffer;

    await expect(
      fixture.service.upload({
        userId,
        originalName: 'movie.mp4',
        content: oversizedContent,
        fps: 1,
      }),
    ).rejects.toBeInstanceOf(InvalidVideoUploadError);
    expect(fixture.files.saveUpload).not.toHaveBeenCalled();
  });

  it('returns a recoverable operation error when filesystem or MySQL persistence fails', async () => {
    const filesystemFixture = dependencies();
    jest
      .mocked(filesystemFixture.files.saveUpload)
      .mockRejectedValueOnce(new Error('filesystem unavailable'));

    await expect(
      filesystemFixture.service.upload({
        userId,
        originalName: 'movie.mp4',
        content: validMp4,
        fps: 1,
      }),
    ).rejects.toBeInstanceOf(VideoOperationError);
    expect(filesystemFixture.repository.create).not.toHaveBeenCalled();
    expect(filesystemFixture.publisher.publish).not.toHaveBeenCalled();

    const mysqlFixture = dependencies();
    jest
      .mocked(mysqlFixture.repository.create)
      .mockRejectedValueOnce(new Error('MySQL unavailable'));
    await expect(
      mysqlFixture.service.upload({
        userId,
        originalName: 'movie.mp4',
        content: validMp4,
        fps: 1,
      }),
    ).rejects.toBeInstanceOf(VideoOperationError);
    expect(mysqlFixture.files.deleteVideo).toHaveBeenCalledTimes(1);
    expect(mysqlFixture.publisher.publish).not.toHaveBeenCalled();
  });

  it('compensates the database and storage when publishing fails', async () => {
    const fixture = dependencies();
    jest.mocked(fixture.publisher.publish).mockRejectedValueOnce(new Error('RabbitMQ unavailable'));

    await expect(
      fixture.service.upload({
        userId,
        originalName: 'movie.mp4',
        content: validMp4,
        fps: 1,
      }),
    ).rejects.toBeInstanceOf(VideoOperationError);
    expect(fixture.repository.delete).toHaveBeenCalledWith(userId, videoId);
    expect(fixture.files.deleteVideo).toHaveBeenCalledTimes(1);
  });

  it('paginates mapped catalog data and falls back to MySQL when Redis is unavailable', async () => {
    const secondVideoId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const fixture = dependencies([video(), video({ id: secondVideoId })]);
    jest.mocked(fixture.cache.get).mockRejectedValueOnce(new Error('Redis unavailable'));
    jest.mocked(fixture.cache.setEx).mockRejectedValueOnce(new Error('Redis unavailable'));

    const result = await fixture.service.list(userId, { page: 2, pageSize: 1 });

    expect(fixture.repository.listByUser).toHaveBeenCalledWith(userId);
    expect(result).toMatchObject({
      items: [expect.objectContaining({ id: secondVideoId, status: 'FAILED', sizeBytes: '5' })],
      page: 2,
      pageSize: 1,
      total: 2,
      totalPages: 2,
    });
    expect(result.items[0]).not.toHaveProperty('inputPath');
    expect(result.items[0]).not.toHaveProperty('outputPath');
  });

  it('returns owned details and hides missing or foreign videos as not found', async () => {
    const fixture = dependencies([video()]);
    await expect(fixture.service.get(userId, videoId)).resolves.toMatchObject({
      id: videoId,
      status: 'FAILED',
    });
    jest.mocked(fixture.repository.findByUser).mockResolvedValueOnce(null);
    fixture.cache.get = jest.fn(async () => null);

    await expect(fixture.service.get(userId, videoId)).rejects.toBeInstanceOf(VideoNotFoundError);
  });

  it('checks the stored input and requeues a failed owned video without a retry cap', async () => {
    const fixture = dependencies([video({ attempt: 100 })]);

    await expect(fixture.service.retry(userId, videoId)).resolves.toEqual({
      id: videoId,
      status: 'QUEUED',
      attempt: 101,
    });
    expect(fixture.files.assertInputAvailable).toHaveBeenCalledWith(
      expect.objectContaining({
        inputPath: `/storage/${userId}/${videoId}/input.mp4`,
      }),
      `/storage/${userId}/${videoId}/input.mp4`,
    );
    expect(fixture.publisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          attempt: 101,
          sourceObjectKey: `/storage/${userId}/${videoId}/input.mp4`,
        }),
      }),
    );
    expect(fixture.cache.del).toHaveBeenCalledTimes(1);
  });

  it('rejects retry with an internal storage error when the original input is missing', async () => {
    const fixture = dependencies([video()]);
    jest
      .mocked(fixture.files.assertInputAvailable)
      .mockRejectedValueOnce(new VideoFileStoreError());

    await expect(fixture.service.retry(userId, videoId)).rejects.toBeInstanceOf(
      VideoFileStoreError,
    );
    expect(fixture.repository.retryFailed).not.toHaveBeenCalled();
    expect(fixture.publisher.publish).not.toHaveBeenCalled();
  });

  it('rejects retry for missing, active, or concurrently changed videos', async () => {
    const fixture = dependencies();
    await expect(fixture.service.retry(userId, videoId)).rejects.toBeInstanceOf(VideoNotFoundError);

    jest
      .mocked(fixture.repository.findByUser)
      .mockResolvedValueOnce(video({ status: 'PROCESSING' }));
    await expect(fixture.service.retry(userId, videoId)).rejects.toBeInstanceOf(VideoConflictError);

    jest.mocked(fixture.repository.findByUser).mockResolvedValueOnce(video());
    jest.mocked(fixture.repository.retryFailed).mockResolvedValueOnce(false);
    await expect(fixture.service.retry(userId, videoId)).rejects.toBeInstanceOf(VideoConflictError);
  });

  it('restores FAILED when a retry cannot be published', async () => {
    const failedVideo = video();
    const fixture = dependencies([failedVideo]);
    jest.mocked(fixture.publisher.publish).mockRejectedValueOnce(new Error('RabbitMQ unavailable'));

    await expect(fixture.service.retry(userId, videoId)).rejects.toBeInstanceOf(
      VideoOperationError,
    );
    expect(fixture.repository.restoreFailed).toHaveBeenCalledWith(failedVideo);
  });

  it('opens downloads only for completed owned videos', async () => {
    const completed = video({
      status: 'COMPLETED',
      outputPath: `/storage/${userId}/${videoId}/output.zip`,
      errorCode: null,
      errorMessage: null,
    });
    const fixture = dependencies([completed]);

    await expect(fixture.service.download(userId, videoId)).resolves.toBeDefined();
    jest.mocked(fixture.repository.findByUser).mockResolvedValueOnce(video());
    await expect(fixture.service.download(userId, videoId)).rejects.toBeInstanceOf(
      VideoConflictError,
    );
    jest.mocked(fixture.repository.findByUser).mockResolvedValueOnce(null);
    await expect(fixture.service.download(userId, videoId)).rejects.toBeInstanceOf(
      VideoNotFoundError,
    );
  });

  it('removes a queued video, its local files, and cached catalog immediately', async () => {
    const queuedVideo = video({
      status: 'QUEUED',
      processingStartedAt: null,
      completedAt: null,
      errorCode: null,
      errorMessage: null,
    });
    const fixture = dependencies([queuedVideo]);

    await expect(fixture.service.removeFromQueue(userId, videoId)).resolves.toBeUndefined();
    expect(fixture.repository.deleteQueued).toHaveBeenCalledWith(userId, videoId);
    expect(fixture.files.deleteVideo).toHaveBeenCalledWith(
      expect.objectContaining({ inputPath: `/storage/${userId}/${videoId}/input.mp4` }),
    );
    expect(fixture.cache.del).toHaveBeenCalledWith([
      `video:${userId}:${videoId}`,
      `videos:${userId}`,
    ]);
  });

  it('refuses deletion for a missing, active, or concurrently updated video', async () => {
    const fixture = dependencies();
    await expect(fixture.service.removeFromQueue(userId, videoId)).rejects.toBeInstanceOf(
      VideoNotFoundError,
    );

    jest
      .mocked(fixture.repository.findByUser)
      .mockResolvedValueOnce(video({ status: 'PROCESSING' }));
    await expect(fixture.service.removeFromQueue(userId, videoId)).rejects.toBeInstanceOf(
      VideoConflictError,
    );

    jest.mocked(fixture.repository.findByUser).mockResolvedValueOnce(video({ status: 'QUEUED' }));
    jest.mocked(fixture.repository.deleteQueued).mockResolvedValueOnce(false);
    await expect(fixture.service.removeFromQueue(userId, videoId)).rejects.toBeInstanceOf(
      VideoConflictError,
    );
  });

  it('applies processing status events and invalidates cache only after an update', async () => {
    const fixture = dependencies();
    const started: ProcessingStartedEventV1 = {
      eventId,
      eventType: 'video.processing.started',
      version: 1,
      occurredAt: '2026-01-01T00:00:00.000Z',
      payload: { videoId, userId, fps: 1, attempt: 1 },
    };
    await expect(fixture.service.applyStatusEvent(started)).resolves.toBe(true);
    expect(fixture.cache.del).toHaveBeenCalledTimes(1);

    jest.mocked(fixture.repository.applyStatusEvent).mockResolvedValueOnce(false);
    const failed: ProcessingFailedEventV1 = {
      eventId,
      eventType: 'video.processing.failed',
      version: 1,
      occurredAt: '2026-01-01T00:01:00.000Z',
      payload: {
        videoId,
        userId,
        errorCode: 'FFMPEG_ERROR',
        errorMessage: 'failed',
        fps: 1,
        attempt: 1,
      },
    };
    await expect(fixture.service.applyStatusEvent(failed)).resolves.toBe(false);
    expect(fixture.cache.del).toHaveBeenCalledTimes(1);
  });
});
