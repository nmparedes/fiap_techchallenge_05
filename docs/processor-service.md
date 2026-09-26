# Processor Service

## Scope

The Processor Service is an internal worker. It consumes version 1
`video.processing.requested` events, extracts deterministic PNG frames with FFmpeg, writes
`output.zip`, and publishes the existing version 1 processing status events. It has no public
business API and owns no database.

## Processing flow

For a new request, the worker:

1. Checks whether the expected `output.zip` is already a non-empty regular file.
2. Publishes and confirms `video.processing.started` when processing is required.
3. Runs FFmpeg without a shell using the configured FPS value and deterministic
   `frame-%06d.png` names.
4. Creates the ZIP from only the frames produced by the current attempt.
5. Publishes and confirms either `video.processing.completed` or `video.processing.failed`.
6. Returns from the handler so the shared RabbitMQ consumer acknowledges the request.

Known FFmpeg and ZIP failures use only `FFMPEG_ERROR` or `ZIP_ERROR`. Their functional messages
are sanitized and limited to 256 characters. Unexpected storage or RabbitMQ errors propagate to
the shared consumer, which negatively acknowledges the delivery with requeue enabled.

Invalid content types, malformed JSON, and events that fail the shared schema are negatively
acknowledged without requeue and follow the existing dead-letter topology.

## At-least-once delivery

The worker uses prefetch `1` and manual acknowledgements. If a request is redelivered after a
non-empty `output.zip` was created, the worker does not run FFmpeg again. It republishes and
confirms the corresponding `video.processing.completed` event, then allows the request to be
acknowledged. The archive path is derived from the user UUID, video UUID, and input extension;
timestamps are not used as identity.

The implementation deliberately does not use a distributed lock. Concurrent delivery to
different worker instances before either archive is complete can therefore perform duplicate
work, while the final valid archive remains the redelivery guard.

## Shared storage

The Processor and Video Services must use the same `VIDEO_STORAGE_ROOT`:

```text
{VIDEO_STORAGE_ROOT}/{userId}/{videoId}/input.{extension}
{VIDEO_STORAGE_ROOT}/{userId}/{videoId}/frames/
{VIDEO_STORAGE_ROOT}/{userId}/{videoId}/output.zip
```

Frames are removed after both successful and failed attempts. The input video is removed only
after the final ZIP has been created successfully.

## Configuration

| Variable                        | Required | Default | Constraint                                 |
| ------------------------------- | -------- | ------- | ------------------------------------------ |
| `RABBITMQ_URL`                  | Yes      | -       | Non-empty AMQP connection URL              |
| `VIDEO_STORAGE_ROOT`            | Yes      | -       | Shared readable and writable directory     |
| `PROCESSOR_PORT`                | No       | `3003`  | Integer from 1 through 65535               |
| `PROCESSOR_PREFETCH`            | No       | `1`     | Must be exactly `1`                        |
| `PROCESSOR_SHUTDOWN_TIMEOUT_MS` | No       | `10000` | Integer from 1 through 300000 milliseconds |

## Commands

From the repository root:

```sh
npm run build --workspace @fiap-x/processor-service
npm run typecheck --workspace @fiap-x/processor-service
npm run lint --workspace @fiap-x/processor-service
npm test --workspace @fiap-x/processor-service
npm run test:coverage --workspace @fiap-x/processor-service
npm start --workspace @fiap-x/processor-service
```

RabbitMQ, shared storage, and the FFmpeg executable must be available before starting the worker.

## Operational endpoints

- `GET /health/live` reports process liveness.
- `GET /health/ready` requires the established RabbitMQ connection, read/write storage access,
  and an executable `ffmpeg` found in `PATH`.
- `GET /metrics` exposes Prometheus text format for HTTP duration, job outcomes, and job duration.

Structured job logs contain the request event ID, generated status event ID, video ID, attempt,
outcome, duration, and archive-reuse flag. They exclude event bodies, AMQP URLs, file contents,
storage paths, and FFmpeg output.

## Shutdown

`SIGINT` and `SIGTERM` cancel the RabbitMQ consumer before draining the active job. The worker
waits up to `PROCESSOR_SHUTDOWN_TIMEOUT_MS`, then closes the consumer channel, publisher channel,
RabbitMQ connection, and internal HTTP server. A timeout is logged and does not prevent resource
closure.
