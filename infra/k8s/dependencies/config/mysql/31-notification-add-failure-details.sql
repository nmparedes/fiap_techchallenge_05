ALTER TABLE notifications
  ADD COLUMN attempt INT UNSIGNED NOT NULL AFTER video_id,
  ADD COLUMN error_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL AFTER attempt,
  ADD CONSTRAINT ck_notifications_attempt CHECK (attempt > 0),
  ADD CONSTRAINT ck_notifications_error_code
    CHECK (error_code IN ('FFMPEG_ERROR', 'ZIP_ERROR')),
  ADD UNIQUE KEY uq_notifications_video_attempt (video_id, attempt);
