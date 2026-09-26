# Stage 9.1 Docker inventory

This inventory records the monorepo runtime contract discovered during stage 9.1. Later local
deployment stages can reuse it without rescanning application source.

| Component            | Image                               | Port | Compiled/static entrypoint                    | Liveness           | Build artifact                    |
| -------------------- | ----------------------------------- | ---: | --------------------------------------------- | ------------------ | --------------------------------- |
| Auth Service         | `fiap-x/auth-service:local`         | 3001 | `node apps/auth-service/dist/main.js`         | `GET /health/live` | `apps/auth-service/dist/`         |
| Video Service        | `fiap-x/video-service:local`        | 3002 | `node apps/video-service/dist/main.js`        | `GET /health/live` | `apps/video-service/dist/`        |
| Processor Service    | `fiap-x/processor-service:local`    | 3003 | `node apps/processor-service/dist/main.js`    | `GET /health/live` | `apps/processor-service/dist/`    |
| Notification Service | `fiap-x/notification-service:local` | 3004 | `node apps/notification-service/dist/main.js` | `GET /health/live` | `apps/notification-service/dist/` |
| Vite frontend        | `fiap-x/frontend:local`             | 8080 | `node server.mjs` serving `/app/dist`         | `GET /health`      | `apps/frontend/dist/`             |

All four APIs also expose `GET /health/ready`. Readiness checks external dependencies, so Docker
healthchecks intentionally use the real liveness endpoints. The frontend server supports an SPA
fallback to `index.html`. All runtime stages use an unprivileged `node` user.

## Build contract

- Node.js is pinned to `24.15.0` (`node:24.15.0-bookworm-slim`) in every build and runtime stage.
- Shared TypeScript workspaces build in dependency order: `config`, `contracts`, `infrastructure`,
  `observability`, then the selected API workspace. Runtime stages install production dependencies
  only for that selected workspace.
- API artifacts are ESM JavaScript under each workspace's `dist/`; production does not use
  `ts-node`.
- The frontend runs TypeScript checking followed by `vite build`. Its public API URLs are Vite
  compile-time values supplied through `VITE_AUTH_API_BASE_URL`, `VITE_VIDEO_API_BASE_URL`, and
  `VITE_NOTIFICATION_API_BASE_URL` build arguments.
- FFmpeg is installed and checked with `ffmpeg -version` only in the Processor runtime image.
- Video and Processor use the shared storage path `/data/videos` by default.

## Runtime configuration

| Component      | Required variables                                                                                                                                    | Optional variables and image defaults                                                                                                                                                                          | External dependencies                                      |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Auth           | `AUTH_JWT_SECRET`, `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USERNAME`, `MYSQL_PASSWORD`, `MYSQL_CONNECTION_LIMIT`, `MYSQL_SSL`                              | `AUTH_HOST=0.0.0.0`, `AUTH_PORT=3001`, `AUTH_JWT_EXPIRES_IN_SECONDS=3600`, `AUTH_JWT_ISSUER=fiap-x-auth-service`, `AUTH_JWT_AUDIENCE=fiap-x-api`                                                               | MySQL database `auth_db`                                   |
| Video          | `AUTH_JWT_SECRET`, `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USERNAME`, `MYSQL_PASSWORD`, `MYSQL_CONNECTION_LIMIT`, `MYSQL_SSL`, `REDIS_URL`, `RABBITMQ_URL` | `VIDEO_HOST=0.0.0.0`, `VIDEO_PORT=3002`, `VIDEO_STORAGE_ROOT=/data/videos`, `AUTH_JWT_ISSUER=fiap-x-auth-service`, `AUTH_JWT_AUDIENCE=fiap-x-api`                                                              | MySQL database `video_db`, Redis, RabbitMQ, shared storage |
| Processor      | `RABBITMQ_URL`                                                                                                                                        | `PROCESSOR_PORT=3003`, `VIDEO_STORAGE_ROOT=/data/videos`, `PROCESSOR_PREFETCH=1`, `PROCESSOR_SHUTDOWN_TIMEOUT_MS=10000`                                                                                        | RabbitMQ, FFmpeg, shared storage                           |
| Notification   | `AUTH_JWT_SECRET`, `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USERNAME`, `MYSQL_PASSWORD`, `MYSQL_CONNECTION_LIMIT`, `MYSQL_SSL`, `RABBITMQ_URL`              | `NOTIFICATION_PORT=3004`, `NOTIFICATION_DEFAULT_PAGE_SIZE=20`, `NOTIFICATION_MAXIMUM_PAGE_SIZE=100`, `AUTH_JWT_ISSUER=fiap-x-auth-service`, `AUTH_JWT_AUDIENCE=fiap-x-api`                                     | MySQL database `notification_db`, RabbitMQ                 |
| Frontend build | None (localhost fallbacks exist)                                                                                                                      | `VITE_AUTH_API_BASE_URL=http://localhost:3001`, `VITE_VIDEO_API_BASE_URL=http://localhost:3002`, `VITE_NOTIFICATION_API_BASE_URL=http://localhost:3004`; runtime `FRONTEND_HOST=0.0.0.0`, `FRONTEND_PORT=8080` | Browser access to the three public APIs                    |

No secret or `.env` file is copied into an image. Public frontend URLs are embedded by Vite at
build time and must not contain credentials, query strings, or fragments.
