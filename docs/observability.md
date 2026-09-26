# Local observability

This setup runs only Prometheus and Grafana. The four FIAP X services remain separate and must
already be running with their internal `GET /metrics` endpoints reachable from the Prometheus
container.

## Prerequisites

- Docker with Compose support.
- Auth Service on port `3001`.
- Video Service on port `3002`.
- Processor Service on port `3003`.
- Notification Service on port `3004`.

The default targets use `host.docker.internal`, which is mapped to the Docker host by the monitoring
compose file. Override `MONITORING_*_TARGET` when a service uses another reachable host or port.

## Configuration

Copy the example environment once from the repository root:

```sh
cp .env.example .env
```

The monitoring-specific variables are:

| Variable                         | Default                     | Purpose                                    |
| -------------------------------- | --------------------------- | ------------------------------------------ |
| `MONITORING_AUTH_TARGET`         | `host.docker.internal:3001` | Auth Service metrics target                |
| `MONITORING_VIDEO_TARGET`        | `host.docker.internal:3002` | Video Service metrics target               |
| `MONITORING_PROCESSOR_TARGET`    | `host.docker.internal:3003` | Processor Service metrics target           |
| `MONITORING_NOTIFICATION_TARGET` | `host.docker.internal:3004` | Notification Service metrics target        |
| `PROMETHEUS_PORT`                | `9090`                      | Prometheus host port                       |
| `GRAFANA_PORT`                   | `3000`                      | Grafana host port                          |
| `GRAFANA_ADMIN_USER`             | `admin`                     | Demonstration administrator                |
| `GRAFANA_ADMIN_PASSWORD`         | `fiap-x-admin`              | Demonstration password; change when needed |

Targets are written into a temporary Prometheus configuration when its container starts. The source
template remains environment-independent.

## Start and stop

From the repository root:

```sh
docker compose --env-file .env -f infra/monitoring/compose.yaml up -d
```

Open:

- Prometheus: <http://localhost:9090>
- Prometheus targets: <http://localhost:9090/targets>
- Grafana: <http://localhost:3000>
- Provisioned dashboard: **Dashboards > FIAP X > FIAP X**

Grafana provisions the Prometheus datasource and dashboard automatically. Sign in with
`GRAFANA_ADMIN_USER` and `GRAFANA_ADMIN_PASSWORD`.

Stop only the monitoring stack with:

```sh
docker compose --env-file .env -f infra/monitoring/compose.yaml down
```

## Local validation

Validate Compose interpolation without starting containers:

```sh
docker compose --env-file .env -f infra/monitoring/compose.yaml config
```

After startup, validate the generated Prometheus configuration and check all four targets:

```sh
docker compose --env-file .env -f infra/monitoring/compose.yaml exec prometheus \
  promtool check config /tmp/prometheus.yml
curl --fail http://localhost:9090/api/v1/targets
```

The dashboard queries only metrics emitted by the services:

- `fiap_x_http_requests_total`
- `fiap_x_http_request_duration_seconds_bucket`
- `fiap_x_readiness`
- `fiap_x_video_uploads_total`
- `fiap_x_video_retries_total`
- `fiap_x_processor_jobs_total`
- `fiap_x_processor_job_duration_seconds_bucket`
- `fiap_x_notification_events_consumed_total`

There are no alert rules, Alertmanager, external integrations, application containers, Dockerfiles,
or Kubernetes resources in this monitoring setup.

## Minikube handoff

This compose stack is only the isolated pre-Phase 09 validation environment. Kubernetes application
and monitoring manifests are intentionally not included here. During Phase 09, use addresses that
are reachable from the Prometheus workload for the same four `/metrics` targets; the metric names,
datasource UID, and dashboard do not need to change.
