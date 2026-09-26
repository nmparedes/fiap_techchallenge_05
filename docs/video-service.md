# Video Service

## Scope

The Video Service provides the minimum authenticated video workflow required by FIAP X:

1. Accept a video upload and publish an asynchronous processing request.
2. List the authenticated user's videos.
3. Read the processing status of one owned video.
4. Download the ZIP archive of frames from a completed video.
5. Retry a failed video with a new processing attempt.

Every video lookup includes the authenticated UUID from the JWT `sub` claim. A valid user cannot
discover or access another user's metadata, upload, or archive. The only supported states are
`QUEUED`, `PROCESSING`, `COMPLETED`, and `FAILED`.

## Authentication

Send the HS256 JWT issued by the Auth Service on every `/videos` request:

```http
Authorization: Bearer <access-token>
```

The service validates the signature, algorithm, issuer, audience, expiration, and required
claims through the shared verifier. Operational endpoints and Swagger UI do not require a token.

## HTTP API

### Upload

`POST /videos`

The request body is `multipart/form-data` with exactly one `video` file and an optional `fps`
field. Supported filename extensions, case-insensitively, are `mp4`, `mov`, `avi`, `mkv`, `wmv`,
`flv`, and `webm`. The service validates the file signature instead of trusting the client MIME
type or filename alone. The exact limit is 200 MiB. FPS defaults to 1 and must be an integer from
1 through 10.

```sh
curl --request POST 'http://localhost:3002/videos' \
  --header 'Authorization: Bearer <access-token>' \
  --form 'video=@./sample.mp4' \
  --form 'fps=1'
```

A valid upload persists the input and metadata, publishes a confirmed RabbitMQ message, and
returns `202 Accepted`:

```json
{
  "success": true,
  "data": {
    "id": "<video-uuid>",
    "status": "QUEUED",
    "attempt": 1
  }
}
```

An invalid request returns `400`. A storage, database, or message publication failure before the
job is accepted returns `500`; the service compensates any partially created upload and record.

### Catalog

`GET /videos?page=1&pageSize=20`

Returns only videos owned by the authenticated user, newest first. `page` starts at 1 and
`pageSize` accepts values from 1 through 100. The response data contains `items`, `page`,
`pageSize`, `total`, and `totalPages`. Defaults are page 1 and 20 items.

### Status

`GET /videos/:id`

Queued, processing, and completed videos return HTTP `200` with `success: true`. A processing
failure also returns HTTP `200`, but uses `success: false`, status `FAILED`, and a stable error
code:

```json
{
  "success": false,
  "data": {
    "id": "<video-uuid>",
    "status": "FAILED",
    "errorCode": "FFMPEG_ERROR",
    "errorMessage": "FFmpeg could not process the input"
  },
  "error": {
    "code": "FFMPEG_ERROR",
    "message": "FFmpeg could not process the input"
  }
}
```

The actual response includes the complete video view. It never exposes internal input or output
paths. FFmpeg and ZIP failures are processing results, not HTTP server failures.

Status events are validated against the shared versioned contract before reaching the service.
Updates require the matching user, video, attempt, and current state. Duplicate, stale, and
out-of-order events are safely ignored. The service stores the latest `FFMPEG_ERROR` or
`ZIP_ERROR` code and message without retaining a complete event history.

### Download

`GET /videos/:id/download`

Returns `application/zip` only when the owned video is `COMPLETED` and its derived archive exists.
Other states return `409 VIDEO_CONFLICT`. An unknown or differently owned UUID returns the same
`404 VIDEO_NOT_FOUND` response. The service resolves the expected archive from the database row
and safe storage layout, never from client input, and streams it without buffering the ZIP in
memory. A missing or inaccessible completed archive returns a sanitized `500 INTERNAL_ERROR`.

### Retry

`POST /videos/:id/retry`

Only a `FAILED` video can be retried. The transition to `QUEUED`, attempt increment, and publish
guard prevent duplicate concurrent retries. Before the transition, the service verifies that the
stored input path matches the safe derived layout and still refers to a file. It clears the error,
does not impose an application retry limit, publishes with RabbitMQ confirmation, and invalidates
both caches. A successful retry returns `202 Accepted`; other states return `409 VIDEO_CONFLICT`.

## Errors

All request-time errors use a stable envelope:

```json
{
  "success": false,
  "error": {
    "code": "INVALID_REQUEST",
    "message": "The request is invalid"
  }
}
```

| HTTP status | Code              | Condition                                      |
| ----------- | ----------------- | ---------------------------------------------- |
| `400`       | `INVALID_REQUEST` | Invalid UUID, query, multipart body, or video. |
| `401`       | `UNAUTHORIZED`    | Missing, malformed, invalid, or expired JWT.   |
| `404`       | `VIDEO_NOT_FOUND` | Video does not exist for the JWT subject.      |
| `409`       | `VIDEO_CONFLICT`  | Download or retry is invalid for the state.    |
| `500`       | `INTERNAL_ERROR`  | Storage, MySQL, RabbitMQ, or internal failure. |

## Configuration

| Variable             | Required | Default               | Constraint                        |
| -------------------- | -------- | --------------------- | --------------------------------- |
| `AUTH_JWT_SECRET`    | Yes      | -                     | At least 32 UTF-8 bytes           |
| `AUTH_JWT_ISSUER`    | No       | `fiap-x-auth-service` | Must match the Auth Service       |
| `AUTH_JWT_AUDIENCE`  | No       | `fiap-x-api`          | Must match the Auth Service       |
| `VIDEO_STORAGE_ROOT` | Yes      | -                     | Writable shared storage directory |
| `VIDEO_HOST`         | No       | `0.0.0.0`             | Non-empty string                  |
| `VIDEO_PORT`         | No       | `3002`                | 1 to 65535                        |

The service also reads the shared `MYSQL_*`, `REDIS_URL`, and `RABBITMQ_URL` variables. It always
selects `video_db`, regardless of `MYSQL_DATABASE`.

The upload limit and FPS range are fixed application policies rather than deployment
configuration: the service always enforces 200 MiB and FPS 1 through 10, with a default of 1.

## Operations

- `GET /health/live` checks only that the HTTP process is running.
- `GET /health/ready` verifies MySQL and the RabbitMQ event exchange, the dependencies required
  to accept work. Redis is optional and falls back to MySQL on cache failures.
- `GET /metrics` exposes Prometheus request-duration, upload-outcome, and status-event metrics.
- `GET /docs` serves Swagger UI for every route and documents JWT Bearer authentication.
- JSON logs include the Fastify request ID and identifiers needed to correlate accepted jobs.
  Passwords, JWTs, file contents, and internal storage paths are never logged.
- `SIGINT` and `SIGTERM` stop HTTP acceptance and close RabbitMQ channels, MySQL connections, and
  Redis before process termination.
