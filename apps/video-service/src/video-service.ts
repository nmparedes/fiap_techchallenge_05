import { basename, extname } from 'node:path';
import type { ReadStream } from 'node:fs';

import {
  getCachedUserVideos,
  getCachedVideoDetails,
  invalidateVideoCache,
  createVideoStoragePaths,
  SUPPORTED_VIDEO_EXTENSIONS,
  type VideoCacheClient,
  type VideoRecord,
} from '@fiap-x/infrastructure';
import type {
  ProcessingRequestedEventV1,
  ProcessingStatusEventV1,
  VideoPage,
  VideoView,
} from '@fiap-x/contracts';

import type { ProcessingRequestPublisher } from './processing-publisher.js';
import {
  MAX_VIDEO_FPS,
  MAX_VIDEO_UPLOAD_BYTES,
  MIN_VIDEO_FPS,
  hasVideoSignature,
} from './upload-policy.js';
import type { VideoFileStore } from './video-files.js';
import type { VideoRepository } from './video-repository.js';

export class InvalidVideoUploadError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'InvalidVideoUploadError';
  }
}

export class VideoNotFoundError extends Error {
  public constructor() {
    super('Video not found');
    this.name = 'VideoNotFoundError';
  }
}

export class VideoConflictError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'VideoConflictError';
  }
}

export class VideoOperationError extends Error {
  public constructor() {
    super('Video operation failed');
    this.name = 'VideoOperationError';
  }
}

export interface UploadVideoInput {
  userId: string;
  originalName: string;
  content: Buffer;
  fps: number;
}

export interface AcceptedVideo {
  id: string;
  status: 'QUEUED';
  attempt: number;
}

export interface VideoPagination {
  page: number;
  pageSize: number;
}

export interface VideoServiceDependencies {
  repository: VideoRepository;
  cache: VideoCacheClient;
  files: VideoFileStore;
  publisher: ProcessingRequestPublisher;
  storageRoot: string;
  createId: () => string;
  now: () => Date;
}

function toVideoView(video: VideoRecord): VideoView {
  return {
    id: video.id,
    originalName: video.originalName,
    extension: video.extension,
    sizeBytes: video.sizeBytes.toString(),
    fps: video.fps,
    status: video.status,
    attempt: video.attempt,
    errorCode: video.errorCode,
    errorMessage: video.errorMessage,
    downloadAvailable: video.status === 'COMPLETED' && video.outputPath !== null,
    processingStartedAt: video.processingStartedAt?.toISOString() ?? null,
    completedAt: video.completedAt?.toISOString() ?? null,
    createdAt: video.createdAt.toISOString(),
    updatedAt: video.updatedAt.toISOString(),
  };
}

function safeOriginalName(value: string): string {
  const name = basename(value.replaceAll('\\', '/')).trim();
  if (name.length === 0 || name.length > 255) {
    throw new InvalidVideoUploadError(
      'The video filename must contain between 1 and 255 characters',
    );
  }

  return name;
}

function readExtension(filename: string): string {
  const extension = extname(filename).slice(1).toLowerCase();
  if (!(SUPPORTED_VIDEO_EXTENSIONS as readonly string[]).includes(extension)) {
    throw new InvalidVideoUploadError('The uploaded file has an unsupported video extension');
  }

  return extension;
}

export class VideoApplicationService {
  public constructor(private readonly dependencies: VideoServiceDependencies) {}

  public async upload(input: UploadVideoInput): Promise<AcceptedVideo> {
    if (input.content.length === 0) {
      throw new InvalidVideoUploadError('The uploaded video must not be empty');
    }
    if (input.content.length > MAX_VIDEO_UPLOAD_BYTES) {
      throw new InvalidVideoUploadError('The uploaded video exceeds the 200 MiB limit');
    }
    if (!Number.isInteger(input.fps) || input.fps < MIN_VIDEO_FPS || input.fps > MAX_VIDEO_FPS) {
      throw new InvalidVideoUploadError('FPS must be an integer between 1 and 10');
    }

    const originalName = safeOriginalName(input.originalName);
    const extension = readExtension(originalName);
    if (!hasVideoSignature(extension, input.content)) {
      throw new InvalidVideoUploadError('The uploaded file content is not a supported video');
    }
    const videoId = this.dependencies.createId();
    const paths = createVideoStoragePaths(
      this.dependencies.storageRoot,
      input.userId,
      videoId,
      extension,
    );
    let stored = false;
    let persisted = false;

    try {
      await this.dependencies.files.saveUpload(paths, input.content);
      stored = true;
      await this.dependencies.repository.create({
        id: videoId,
        userId: input.userId,
        originalName,
        extension,
        sizeBytes: input.content.length,
        fps: input.fps,
        inputPath: paths.inputPath,
      });
      persisted = true;

      await this.dependencies.publisher.publish(
        this.createProcessingRequest(videoId, input.userId, paths.inputPath, input.fps, 1),
      );
      await invalidateVideoCache(this.dependencies.cache, input.userId, videoId);

      return { id: videoId, status: 'QUEUED', attempt: 1 };
    } catch {
      if (persisted) {
        try {
          await this.dependencies.repository.delete(input.userId, videoId);
        } catch {
          // Preserve the original operation failure.
        }
      }
      if (stored) {
        try {
          await this.dependencies.files.deleteVideo(paths);
        } catch {
          // Preserve the original operation failure.
        }
      }

      throw new VideoOperationError();
    }
  }

  public async list(userId: string, pagination: VideoPagination): Promise<VideoPage> {
    const videos = await getCachedUserVideos(this.dependencies.cache, userId, async () => {
      const videos = await this.dependencies.repository.listByUser(userId);
      return videos.map(toVideoView);
    });

    const offset = (pagination.page - 1) * pagination.pageSize;
    return {
      items: videos.slice(offset, offset + pagination.pageSize),
      page: pagination.page,
      pageSize: pagination.pageSize,
      total: videos.length,
      totalPages: Math.ceil(videos.length / pagination.pageSize),
    };
  }

  public async get(userId: string, videoId: string): Promise<VideoView> {
    const video = await getCachedVideoDetails(
      this.dependencies.cache,
      userId,
      videoId,
      async () => {
        const record = await this.dependencies.repository.findByUser(userId, videoId);
        return record === null ? null : toVideoView(record);
      },
    );

    if (video === null) {
      throw new VideoNotFoundError();
    }

    return video;
  }

  public async retry(userId: string, videoId: string): Promise<AcceptedVideo> {
    const video = await this.dependencies.repository.findByUser(userId, videoId);
    if (video === null) {
      throw new VideoNotFoundError();
    }
    if (video.status !== 'FAILED') {
      throw new VideoConflictError('Only failed videos can be retried');
    }

    const paths = createVideoStoragePaths(
      this.dependencies.storageRoot,
      video.userId,
      video.id,
      video.extension,
    );
    await this.dependencies.files.assertInputAvailable(paths, video.inputPath);

    const updated = await this.dependencies.repository.retryFailed(video);
    if (!updated) {
      throw new VideoConflictError('The video status changed before the retry was accepted');
    }

    const nextAttempt = video.attempt + 1;
    try {
      await this.dependencies.publisher.publish(
        this.createProcessingRequest(
          video.id,
          video.userId,
          paths.inputPath,
          video.fps,
          nextAttempt,
        ),
      );
      await invalidateVideoCache(this.dependencies.cache, userId, videoId);
      return { id: video.id, status: 'QUEUED', attempt: nextAttempt };
    } catch {
      try {
        await this.dependencies.repository.restoreFailed(video);
        await invalidateVideoCache(this.dependencies.cache, userId, videoId);
      } catch {
        // Preserve the publish failure while leaving recovery details in structured logs upstream.
      }
      throw new VideoOperationError();
    }
  }

  public async removeFromQueue(userId: string, videoId: string): Promise<void> {
    const video = await this.dependencies.repository.findByUser(userId, videoId);
    if (video === null) {
      throw new VideoNotFoundError();
    }
    if (video.status !== 'QUEUED') {
      throw new VideoConflictError('Only queued videos can be removed');
    }

    const removed = await this.dependencies.repository.deleteQueued(userId, videoId);
    if (!removed) {
      throw new VideoConflictError('The video status changed before it could be removed');
    }

    const paths = createVideoStoragePaths(
      this.dependencies.storageRoot,
      video.userId,
      video.id,
      video.extension,
    );
    await this.dependencies.files.deleteVideo(paths);
    await invalidateVideoCache(this.dependencies.cache, userId, videoId);
  }

  public async download(userId: string, videoId: string): Promise<ReadStream> {
    const video = await this.dependencies.repository.findByUser(userId, videoId);
    if (video === null) {
      throw new VideoNotFoundError();
    }
    if (video.status !== 'COMPLETED' || video.outputPath === null) {
      throw new VideoConflictError('The video archive is not available');
    }

    const paths = createVideoStoragePaths(
      this.dependencies.storageRoot,
      video.userId,
      video.id,
      video.extension,
    );
    return this.dependencies.files.openArchive(paths, video.outputPath);
  }

  public async applyStatusEvent(event: ProcessingStatusEventV1): Promise<boolean> {
    const updated = await this.dependencies.repository.applyStatusEvent(event);
    if (updated) {
      await invalidateVideoCache(
        this.dependencies.cache,
        event.payload.userId,
        event.payload.videoId,
      );
    }
    return updated;
  }

  private createProcessingRequest(
    videoId: string,
    userId: string,
    sourceObjectKey: string,
    fps: number,
    attempt: number,
  ): ProcessingRequestedEventV1 {
    return {
      eventId: this.dependencies.createId(),
      eventType: 'video.processing.requested',
      version: 1,
      occurredAt: this.dependencies.now().toISOString(),
      payload: { videoId, userId, sourceObjectKey, fps, attempt },
    };
  }
}
