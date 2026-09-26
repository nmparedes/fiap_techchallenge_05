# Notification Service

## Scope

The Notification Service consumes `video.processing.failed` events and stores one internal
notification per video processing attempt. It exposes only the authenticated user's notifications.
It does not send email, SMS, push messages, WebSocket events, or requests to other services.

## Configuration

The service owns the `notification_db` database and uses the shared MySQL, RabbitMQ, and JWT
settings. The service-specific values are:

| Variable                         | Required | Default | Constraint   |
| -------------------------------- | -------- | ------- | ------------ |
| `NOTIFICATION_PORT`              | No       | `3004`  | 1 to 65535   |
| `NOTIFICATION_DEFAULT_PAGE_SIZE` | No       | `20`    | 1 to maximum |
| `NOTIFICATION_MAXIMUM_PAGE_SIZE` | No       | `100`   | 1 to 100     |

`AUTH_JWT_SECRET` is required and must contain at least 32 UTF-8 bytes. JWT issuer and audience
default to the Auth Service values documented in `.env.example`.

## Running locally

From the repository root, prepare the environment, apply the existing migrations, build, and start
the workspace:

```sh
cp .env.example .env
npm run db:migrate
npm run build --workspace @fiap-x/notification-service
npm run start --workspace @fiap-x/notification-service
```

MySQL and RabbitMQ must be reachable. The migration runner creates the notification table and adds
the processing attempt, error code, and unique `(video_id, attempt)` constraint before the service
starts consuming failures.

## HTTP endpoints

### List notifications

`GET /notifications?page=1&pageSize=20`

Send the JWT using `Authorization: Bearer <token>`. The service always reads the owner identifier
from the verified `sub` claim. A caller cannot select another user through query parameters, request
bodies, or headers.

Notifications are returned newest first. `page` starts at 1, and `pageSize` cannot exceed the
configured maximum. The response contains `id`, `videoId`, `attempt`, `errorCode`, the sanitized
message, and `createdAt` for each item.

### Operations

- `GET /health/live` reports process liveness.
- `GET /health/ready` checks the owned MySQL pool and established RabbitMQ connection.
- `GET /metrics` returns Prometheus metrics.
- `GET /docs` serves the OpenAPI documentation and Swagger UI.

The operations endpoints do not require authentication. `GET /notifications` is the only functional
public API.

## Consumption and shutdown

The service uses the shared validated failure consumer with manual acknowledgements. It acknowledges
only after persistence succeeds, acknowledges idempotent duplicates, requests redelivery for database
failures, and dead-letters invalid messages. Shutdown first cancels new deliveries, waits for active
persistence, and then closes the RabbitMQ channel, RabbitMQ connection, HTTP server, and MySQL pool.
