CREATE TABLE IF NOT EXISTS notifications (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  video_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  message TEXT NOT NULL,
  read_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY ix_notifications_user_created (user_id, created_at DESC),
  KEY ix_notifications_user_unread (user_id, read_at)
) ENGINE=InnoDB;
