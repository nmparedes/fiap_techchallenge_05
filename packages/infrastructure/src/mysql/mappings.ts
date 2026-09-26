import type { ProcessingErrorCode, VideoStatus } from '@fiap-x/contracts';

export class DataMappingError extends Error {
  public constructor(field: string, value: unknown) {
    super(`Invalid database value for ${field}: ${String(value)}`);
    this.name = 'DataMappingError';
  }
}

type DateValue = Date | string;

export interface UserRow {
  id: string;
  username: string;
  display_name: string;
  password_hash: string;
  created_at: DateValue;
  updated_at: DateValue;
}

export interface UserRecord {
  id: string;
  username: string;
  displayName: string;
  passwordHash: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface VideoRow {
  id: string;
  user_id: string;
  original_name: string;
  extension: string;
  size_bytes: bigint | number | string;
  fps: number | string;
  status: string;
  input_path: string;
  output_path: string | null;
  error_code: string | null;
  error_message: string | null;
  attempt: number | string;
  processing_started_at: DateValue | null;
  completed_at: DateValue | null;
  created_at: DateValue;
  updated_at: DateValue;
}

export interface VideoRecord {
  id: string;
  userId: string;
  originalName: string;
  extension: string;
  sizeBytes: bigint;
  fps: number;
  status: VideoStatus;
  inputPath: string;
  outputPath: string | null;
  errorCode: ProcessingErrorCode | null;
  errorMessage: string | null;
  attempt: number;
  processingStartedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NotificationRow {
  id: string;
  user_id: string;
  video_id: string;
  message: string;
  read_at: DateValue | null;
  created_at: DateValue;
}

export interface NotificationRecord {
  id: string;
  userId: string;
  videoId: string;
  message: string;
  readAt: Date | null;
  createdAt: Date;
}

const videoStatuses = new Set<VideoStatus>(['QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED']);
const processingErrorCodes = new Set<ProcessingErrorCode>(['FFMPEG_ERROR', 'ZIP_ERROR']);

function toDate(field: string, value: DateValue): Date {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new DataMappingError(field, value);
  }

  return date;
}

function toNullableDate(field: string, value: DateValue | null): Date | null {
  return value === null ? null : toDate(field, value);
}

function toFiniteNumber(field: string, value: number | string): number {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    throw new DataMappingError(field, value);
  }

  return number;
}

function toBigInt(field: string, value: bigint | number | string): bigint {
  try {
    return BigInt(value);
  } catch {
    throw new DataMappingError(field, value);
  }
}

function toVideoStatus(value: string): VideoStatus {
  if (!videoStatuses.has(value as VideoStatus)) {
    throw new DataMappingError('status', value);
  }

  return value as VideoStatus;
}

function toProcessingErrorCode(value: string | null): ProcessingErrorCode | null {
  if (value === null) {
    return null;
  }
  if (!processingErrorCodes.has(value as ProcessingErrorCode)) {
    throw new DataMappingError('error_code', value);
  }

  return value as ProcessingErrorCode;
}

export function mapUserRow(row: UserRow): UserRecord {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    passwordHash: row.password_hash,
    createdAt: toDate('created_at', row.created_at),
    updatedAt: toDate('updated_at', row.updated_at),
  };
}

export function mapVideoRow(row: VideoRow): VideoRecord {
  return {
    id: row.id,
    userId: row.user_id,
    originalName: row.original_name,
    extension: row.extension,
    sizeBytes: toBigInt('size_bytes', row.size_bytes),
    fps: toFiniteNumber('fps', row.fps),
    status: toVideoStatus(row.status),
    inputPath: row.input_path,
    outputPath: row.output_path,
    errorCode: toProcessingErrorCode(row.error_code),
    errorMessage: row.error_message,
    attempt: toFiniteNumber('attempt', row.attempt),
    processingStartedAt: toNullableDate('processing_started_at', row.processing_started_at),
    completedAt: toNullableDate('completed_at', row.completed_at),
    createdAt: toDate('created_at', row.created_at),
    updatedAt: toDate('updated_at', row.updated_at),
  };
}

export function mapNotificationRow(row: NotificationRow): NotificationRecord {
  return {
    id: row.id,
    userId: row.user_id,
    videoId: row.video_id,
    message: row.message,
    readAt: toNullableDate('read_at', row.read_at),
    createdAt: toDate('created_at', row.created_at),
  };
}
