# FIAP X

FIAP X is an academic video-processing platform for the FIAP Software Architecture postgraduate
hackathon. An authenticated user uploads a video, the system extracts frames asynchronously, and a
successful job produces a downloadable ZIP archive.

The implementation is a TypeScript monorepo with a browser frontend, four Fastify services,
RabbitMQ, MySQL, Redis, shared file storage, Prometheus, Grafana, Docker, and Kubernetes. It
supports local Minikube execution and deployment to a prepared Kubernetes environment. See the
[architecture and complete flow](docs/architecture.md).

## Prerequisites

- Node.js `24.15.0` and npm `11.12.1` for repository quality commands.
- Docker daemon, Minikube, kubectl, OpenSSL, curl, and Make for the complete local stack.
- jq for the functional smoke test.
- Approximately 4 CPUs, 6 GiB of Minikube memory, and 20 GiB of Minikube disk.

Use `.nvmrc` or `.node-version` to select the required Node.js version.

## Quick start with Minikube

The supported demonstration path builds the five images locally, creates local secrets, applies
dependencies and applications, runs migrations and seeds, and waits for rollouts:

```sh
make k8s-start PROFILE=fiap-x
```

The command prints the Minikube IP and the hosts entry for:

```text
<minikube-ip> fiap-x.local auth.fiap-x.local video.fiap-x.local notification.fiap-x.local
```

On hosts where the Docker-driver IP is not directly routable, keep this running and use
`127.0.0.1` in that hosts entry:

```sh
minikube tunnel --profile fiap-x
```

Open <http://fiap-x.local>. The local environment uses HTTP without TLS. Check status or run the
existing end-to-end demonstration:

```sh
make k8s-status PROFILE=fiap-x
make k8s-smoke PROFILE=fiap-x
```

Remove only the FIAP X namespace and its local data with:

```sh
make k8s-stop PROFILE=fiap-x
```

The stop command does not delete the Minikube profile. Full setup, access, secret handling, and
troubleshooting are in [Local Minikube](docs/local-kubernetes.md).

## Local demonstration accounts

These credentials are seeds for the local academic demonstration only. Do not reuse them in any
other environment.

| Name     | Username   | Password      |
| -------- | ---------- | ------------- |
| John Doe | `john.doe` | `JohnDoe123!` |
| Mary Doe | `mary.doe` | `MaryDoe123!` |

## Processing rules

- Accepted filename extensions, case-insensitively: MP4, AVI, MOV, MKV, WMV, FLV, and WebM.
- Maximum upload size: exactly 200 MiB (`200 * 1024 * 1024` bytes).
- `fps` means images extracted per second. It must be an integer from 1 to 10 and defaults to 1.
- A valid upload returns HTTP 202 only after RabbitMQ confirms the durable processing message.
- Validation errors return HTTP 400; storage, database, or enqueue failures before acceptance
  return HTTP 500.
- A later FFmpeg or ZIP failure is a processing result: `GET /videos/:id` returns HTTP 200 with
  `success: false`, status `FAILED`, and `FFMPEG_ERROR` or `ZIP_ERROR`.
- A completed archive is downloadable only by its owner. A failed job can be retried manually;
  there is no automatic functional retry.
- Notifications are stored and displayed only inside FIAP X; no e-mail, SMS, push, WebSocket, or
  SSE channel is implemented.

See [Video Service](docs/video-service.md), [Processor Service](docs/processor-service.md), and
[Notification Service](docs/notification-service.md) for the detailed contracts.

## Service access

The frontend is exposed by Ingress at <http://fiap-x.local>. The three Swagger UIs and internal
tools are accessed with local port-forwards:

```sh
kubectl --context fiap-x -n fiap-x port-forward service/auth-service 3001:3001
kubectl --context fiap-x -n fiap-x port-forward service/video-service 3002:3002
kubectl --context fiap-x -n fiap-x port-forward service/notification-service 3004:3004
kubectl --context fiap-x -n fiap-x port-forward service/rabbitmq 15672:15672
kubectl --context fiap-x -n fiap-x port-forward service/prometheus 9090:9090
kubectl --context fiap-x -n fiap-x port-forward service/grafana 3000:3000
```

| Interface            | URL after its port-forward   |
| -------------------- | ---------------------------- |
| Auth Swagger         | <http://localhost:3001/docs> |
| Video Swagger        | <http://localhost:3002/docs> |
| Notification Swagger | <http://localhost:3004/docs> |
| RabbitMQ management  | <http://localhost:15672>     |
| Prometheus           | <http://localhost:9090>      |
| Grafana              | <http://localhost:3000>      |

Processor is an internal worker and intentionally has no public business API or Swagger UI.
RabbitMQ and Grafana credentials are generated locally; retrieval commands are documented in
[Local Minikube](docs/local-kubernetes.md#internal-tools-and-swagger).

## Quality commands

Install exactly the locked dependencies, then run the same five gates as GitHub Actions:

```sh
npm ci
npm run format:check
npm run lint
npm run typecheck
npm run test:coverage
npm run build
```

Jest enforces at least 80% for statements, branches, functions, and lines in every workspace
aggregate.

## Environment variables

`.env.example` contains development placeholders, not real secrets. The application uses these
names:

- MySQL: `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USERNAME`, `MYSQL_PASSWORD`, `MYSQL_DATABASE`,
  `MYSQL_CONNECTION_LIMIT`, `MYSQL_SSL`.
- JWT/Auth: `AUTH_HOST`, `AUTH_PORT`, `AUTH_JWT_SECRET`, `AUTH_JWT_EXPIRES_IN_SECONDS`,
  `AUTH_JWT_ISSUER`, `AUTH_JWT_AUDIENCE`.
- Video/Processor: `VIDEO_HOST`, `VIDEO_PORT`, `VIDEO_STORAGE_ROOT`, `PROCESSOR_PORT`,
  `PROCESSOR_PREFETCH`, `PROCESSOR_SHUTDOWN_TIMEOUT_MS`.
- Notification: `NOTIFICATION_PORT`, `NOTIFICATION_DEFAULT_PAGE_SIZE`,
  `NOTIFICATION_MAXIMUM_PAGE_SIZE`.
- Dependencies: `REDIS_URL`, `RABBITMQ_URL`.
- Monitoring: `MONITORING_AUTH_TARGET`, `MONITORING_VIDEO_TARGET`,
  `MONITORING_PROCESSOR_TARGET`, `MONITORING_NOTIFICATION_TARGET`, `PROMETHEUS_PORT`,
  `GRAFANA_PORT`, `GRAFANA_ADMIN_USER`, `GRAFANA_ADMIN_PASSWORD`.

Minikube automation accepts optional `FIAP_X_*` overrides documented in
[Local Minikube](docs/local-kubernetes.md#configuration-variables). Never commit `.env` or real
credential values.

## Documentation

- [Architecture, responsibilities, and end-to-end flow](docs/architecture.md)
- [Local Minikube operation and troubleshooting](docs/local-kubernetes.md)
- [Authentication](docs/authentication.md)
- [Video Service](docs/video-service.md)
- [Processor Service](docs/processor-service.md)
- [Notification Service](docs/notification-service.md)
- [Frontend](docs/frontend.md)
- [Data infrastructure](docs/data-infrastructure.md)
- [RabbitMQ topology](docs/rabbitmq-topology.md)
- [Cache and shared storage](docs/cache-and-storage.md)
- [Observability](docs/observability.md)
- [Continuous integration and delivery](docs/ci.md)
- [Production deployment](docs/production-deployment.md)

## Academic limitations

This repository supports local Minikube operation and deployment to a prepared Kubernetes
environment. It does not provision cloud infrastructure, TLS certificates, or managed data
services. It also does not implement external notifications, public registration, refresh tokens,
password recovery, MFA, RBAC, real-time UI updates, processing cancellation, progress percentage,
or automatic retry of functional FFmpeg/ZIP failures.
