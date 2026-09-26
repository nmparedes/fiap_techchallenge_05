ALTER TABLE videos
  ADD COLUMN error_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER output_path,
  ADD CONSTRAINT ck_videos_error_code
    CHECK (error_code IS NULL OR error_code IN ('FFMPEG_ERROR', 'ZIP_ERROR'));
