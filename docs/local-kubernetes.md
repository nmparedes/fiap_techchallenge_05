# FIAP X on local Minikube

This procedure builds and runs the complete FIAP X demonstration locally. It never creates or
deletes a cloud cluster, registry, GitHub Actions workflow, or release. Every mutating command
requires an explicit Minikube profile, and the removal command deletes only the `fiap-x` namespace.

## Host requirements

- Docker daemon running locally.
- Minikube, kubectl, OpenSSL, curl, and Make.
- jq for the functional smoke test. The sample video is generated with the FFmpeg already present
  in the Processor image, so FFmpeg is not required on the host.
- Approximately 4 CPUs, 6 GiB of memory, and 20 GiB of Minikube disk. A host with at least 8 GiB
  of total memory is recommended.
- The project runtime remains Node.js 24.15.0 inside the pinned application images.

The examples use the explicit profile name `fiap-x`. Choose another name if needed, but pass the
same `PROFILE` value to every command.

## Validate without a cluster

```sh
make k8s-validate-static
```

This always renders both Kustomize compositions. If `kubeconform` is installed, it also validates
the rendered resources against Kubernetes schemas. Once Minikube is running, `make k8s-validate`
adds `kubectl apply --dry-run=client` validation using that profile's discovery data.

## Start

```sh
make k8s-start PROFILE=fiap-x
```

The command is idempotent and performs these operations in order:

1. checks prerequisites and starts or selects the explicit Docker-based Minikube profile;
2. confirms the kubectl context matches that profile;
3. enables and waits for the ingress and metrics-server addons;
4. validates the manifests with client dry-run;
5. points Docker to the Minikube Docker daemon and builds all five local images;
6. creates random demonstration Secrets if they do not already exist;
7. applies and waits for MySQL, Redis, RabbitMQ, shared storage, Prometheus, and Grafana;
8. waits for the migration Job and prints its logs;
9. runs the seed Job once, waits for it, and prints its logs;
10. applies the five application components, Ingress, and the Video/Processor HPAs;
11. waits for every application rollout and prints access instructions.

The frontend image is built with these public API URLs:

- `http://auth.fiap-x.local`
- `http://video.fiap-x.local`
- `http://notification.fiap-x.local`

The script prints the Minikube IP and the exact hosts entry to add locally. If that IP is not
routable from the host (common with the Docker driver on macOS), keep this command running in a
second terminal:

```sh
minikube tunnel --profile fiap-x
```

In that case, map the four printed hostnames to `127.0.0.1` instead of the Minikube IP. Then open
`http://fiap-x.local`. No TLS is used in this academic environment.

## Configuration variables

Secrets are generated in memory and stored only in Kubernetes. Existing values are preserved on
subsequent starts. To provide local values explicitly, export any of these variables before start:

```sh
export FIAP_X_MYSQL_ROOT_PASSWORD='local-value'
export FIAP_X_MYSQL_USERNAME='fiap_x'
export FIAP_X_MYSQL_PASSWORD='local-value'
export FIAP_X_REDIS_PASSWORD='local-value'
export FIAP_X_RABBITMQ_USERNAME='fiap_x'
export FIAP_X_RABBITMQ_PASSWORD='local-value'
export FIAP_X_GRAFANA_ADMIN_USER='admin'
export FIAP_X_GRAFANA_PASSWORD='local-value'
export FIAP_X_AUTH_JWT_SECRET='at-least-32-random-characters'
```

Set `FIAP_X_ROTATE_SECRETS=true` only when intentional. Rotation against existing persistent data
may require removing the local stack first.

Resource and public URL defaults can also be overridden before `k8s-start`:

```sh
export FIAP_X_MINIKUBE_CPUS=4
export FIAP_X_MINIKUBE_MEMORY=6144mb
export FIAP_X_MINIKUBE_DISK_SIZE=20g
export FIAP_X_AUTH_PUBLIC_URL=http://fiap-x.local
export FIAP_X_VIDEO_PUBLIC_URL=http://fiap-x.local
export FIAP_X_NOTIFICATION_PUBLIC_URL=http://fiap-x.local
```

`FIAP_X_SMOKE_ATTEMPTS` controls the smoke test's maximum number of 3-second status polls and must
be a positive integer. These values are local inputs; do not commit real credentials.

## Seeded users

The one-time seed Job creates these academic demonstration accounts:

| Name     | Username   | Password      |
| -------- | ---------- | ------------- |
| John Doe | `john.doe` | `JohnDoe123!` |
| Mary Doe | `mary.doe` | `MaryDoe123!` |

## Internal tools and Swagger

```sh
make k8s-status PROFILE=fiap-x
```

Only the frontend and browser API routes are exposed through Ingress. Swagger and internal tools
use separate local port-forwards; run each required command in its own terminal:

```sh
kubectl --context fiap-x -n fiap-x port-forward service/auth-service 3001:3001
kubectl --context fiap-x -n fiap-x port-forward service/video-service 3002:3002
kubectl --context fiap-x -n fiap-x port-forward service/notification-service 3004:3004
kubectl --context fiap-x -n fiap-x port-forward service/rabbitmq 15672:15672
kubectl --context fiap-x -n fiap-x port-forward service/grafana 3000:3000
kubectl --context fiap-x -n fiap-x port-forward service/prometheus 9090:9090
```

Open:

- Auth Swagger: <http://localhost:3001/docs>
- Video Swagger: <http://localhost:3002/docs>
- Notification Swagger: <http://localhost:3004/docs>
- RabbitMQ management: <http://localhost:15672>
- Grafana: <http://localhost:3000>
- Prometheus: <http://localhost:9090>

Processor is an internal worker and intentionally has no Swagger UI. RabbitMQ and Grafana
credentials are generated locally. Read them only when needed:

```sh
kubectl --context fiap-x -n fiap-x get secret fiap-x-dependencies \
  -o jsonpath='{.data.RABBITMQ_USERNAME}' | base64 --decode
printf '\n'
kubectl --context fiap-x -n fiap-x get secret fiap-x-dependencies \
  -o jsonpath='{.data.RABBITMQ_PASSWORD}' | base64 --decode
printf '\n'
kubectl --context fiap-x -n fiap-x get secret fiap-x-dependencies \
  -o jsonpath='{.data.GRAFANA_ADMIN_USER}' | base64 --decode
printf '\n'
kubectl --context fiap-x -n fiap-x get secret fiap-x-dependencies \
  -o jsonpath='{.data.GRAFANA_ADMIN_PASSWORD}' | base64 --decode
printf '\n'
```

## Functional smoke test

With the stack ready and local jq installed:

```sh
make k8s-smoke PROFILE=fiap-x
```

The test uses temporary port-forwards and performs service health checks, login as John Doe, a
one-second video upload, status polling, archive download on success, and notification lookup. The
video is generated inside the Processor pod. If processing reaches `FAILED` or does not reach a
terminal state, the test prints the last video response and notifications and exits with an error
without modifying application code.

## Remove only FIAP X

```sh
make k8s-stop PROFILE=fiap-x
```

This deletes only namespace `fiap-x`, including its local PVCs and data. It does not stop or delete
Minikube and does not disable shared addons. Stop the profile separately only if desired:

```sh
minikube stop --profile fiap-x
```

## Troubleshooting

- **Tool missing:** install the command reported by `make k8s-check PROFILE=fiap-x`. The start path
  requires Docker, Minikube, kubectl, OpenSSL, curl, and Make; the smoke test additionally requires
  jq. `kubeconform` is optional and strengthens `make k8s-validate-static` when installed.
- **Wrong context:** scripts stop before mutation unless the current context exactly matches the
  explicit profile. Use `kubectl config use-context fiap-x` and retry.
- **Docker unavailable:** start Docker Desktop or the local Docker daemon, then run `make k8s-check
PROFILE=fiap-x`.
- **`ErrImageNeverPull`:** rerun `make k8s-images PROFILE=fiap-x`; images must exist inside the
  Minikube Docker daemon.
- **Ingress does not resolve:** verify the hosts entry printed by `k8s-status`. With the Docker
  driver on macOS, run `minikube tunnel --profile fiap-x` and map the names to `127.0.0.1`. Then
  check `kubectl --context fiap-x -n ingress-nginx get pods`.
- **HPA shows unknown metrics:** wait for `kubectl --context fiap-x -n kube-system rollout status
deployment/metrics-server` and retry.
- **Migration or seed failure:** inspect `kubectl --context fiap-x -n fiap-x logs job/mysql-migrate`
  or `job/mysql-seed`. After correcting only the local environment, delete the failed Job by its
  exact name and rerun start; completed Jobs are deliberately not repeated.
- **Pod not ready:** run `kubectl --context fiap-x -n fiap-x get pods` and
  `kubectl --context fiap-x -n fiap-x describe pod <pod-name>`. Then inspect
  `kubectl --context fiap-x -n fiap-x logs <pod-name>` for the dependency named by the readiness
  failure. The automation does not silently alter application code.
- **Shared storage failure:** confirm the `video-storage` PVC is `Bound`, then describe the Video
  and Processor pods and verify both mount `/data/videos`. A failed processing attempt preserves
  the input but removes temporary frames.
- **FFmpeg unavailable:** inspect Processor readiness and logs, then verify the executable inside
  the deployed image with
  `kubectl --context fiap-x -n fiap-x exec deployment/processor-service -- ffmpeg -version`.
  FFmpeg is intentionally present only in the Processor image.
