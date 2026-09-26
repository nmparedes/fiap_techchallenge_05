# Cache and shared storage

## Redis

The Video Service may cache only these read models:

| Data          | Key                        | TTL        |
| ------------- | -------------------------- | ---------- |
| Video details | `video:{userId}:{videoId}` | 30 seconds |
| User listing  | `videos:{userId}`          | 30 seconds |

UUIDs are validated and normalized to lowercase before a key is created. Cache reads use the
cache-aside pattern: a hit returns the decoded JSON, while a miss, malformed value, or Redis
failure loads the source-of-truth value from MySQL. Failure to refresh the cache does not fail a
successful MySQL read.

Every successful status transition or retry update must call `invalidateVideoCache` after the
MySQL mutation. It removes both the video detail and the owning user's listing. Invalidation
failure is reported by a `false` result but must not roll back an already committed MySQL change.

Redis is not used for JWT sessions, distributed locks, files, videos, or authoritative state.

## Shared file storage

`createVideoStoragePaths` accepts a trusted storage root plus validated user and video UUIDs. It
normalizes the root, UUIDs, and supported extension and returns this layout:

```text
{storageRoot}/{userId}/{videoId}/input.{extension}
{storageRoot}/{userId}/{videoId}/frames/
{storageRoot}/{userId}/{videoId}/output.zip
```

The only supported input extensions are `mp4`, `avi`, `mov`, `mkv`, `wmv`, `flv`, and `webm`.
Original filenames never participate in storage paths. Empty roots, null bytes, invalid UUIDs,
unsupported extensions, and path traversal inputs are rejected. Cleanup functions revalidate
containment before any removal.

Before each attempt, `prepareVideoProcessingAttempt` removes leftover frames and recreates the
frames directory. After every attempt, `cleanupVideoProcessingAttempt` removes the frames
directory. It preserves the input after failure or retry and removes it only when the caller
confirms successful processing. The completed `output.zip` is preserved.

The storage root must refer to filesystem storage shared by the Video and Processor Services in a
later deployment. Video bytes and ZIP files must never be placed in RabbitMQ messages, Redis
values, or MySQL columns; those systems store only events, cacheable metadata, and paths.
