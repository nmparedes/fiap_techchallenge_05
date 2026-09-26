# Final acceptance - step 11.4

Acceptance date: 2026-09-16  
Target: local Minikube profile and kubectl context `fiap-x`

## Result rules

- **PASS**: the command or scenario completed with directly observed evidence.
- **FAIL**: the command or scenario ran and returned a result that did not meet the expected
  condition.
- **NOT EXECUTED**: the scenario was not run to completion because a prerequisite or earlier
  failure made the result unreliable or unsafe to pursue.

No application code, test, operational configuration, infrastructure definition, workflow, tag,
release, remote deployment, or published image was changed. Quality gates ran in an isolated copy
at `/tmp/fiap-x-final-acceptance.oKzLX3/repo`.

## Tool versions

| Tool              | Result | Observed version                     |
| ----------------- | ------ | ------------------------------------ |
| Node.js           | PASS   | `v24.15.0`                           |
| npm               | PASS   | `11.12.1`                            |
| Docker CLI/server | PASS   | `29.4.1` / `29.4.1` (Docker Desktop) |
| kubectl           | PASS   | `v1.35.3`; Kustomize `v5.7.1`        |
| Minikube          | PASS   | `v1.38.1`                            |

Commands: `node --version`, `npm --version`, `docker --version`,
`docker info --format ...`, `kubectl version --client=true --output=yaml`, and
`minikube version --short`.

## Repository quality gates

| Command                 | Result | Evidence                                                                                                                                          |
| ----------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run format:check`  | PASS   | Root and Frontend Prettier checks completed with exit code 0.                                                                                     |
| `npm run lint`          | PASS   | Root and workspace ESLint checks completed with exit code 0.                                                                                      |
| `npm run typecheck`     | PASS   | Root build/test TypeScript checks and workspace checks completed with exit code 0.                                                                |
| `npm run test:coverage` | PASS   | 59 suites and 339 tests passed across 10 workspaces. Every workspace aggregate remained above 80% for statements, branches, functions, and lines. |
| `npm run build`         | PASS   | All 10 workspaces built; Vite produced the Frontend bundle.                                                                                       |

## Docker images

| Validation                                                          | Result | Evidence                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Static Dockerfile checks                                            | PASS   | `docker buildx build --check` completed for Auth, Video, Processor, Notification, and Frontend. Auth, Video, Processor, and Notification had no warnings. Frontend had two heuristic `SecretsUsedInArgOrEnv` warnings caused by the public variable name `VITE_AUTH_API_BASE_URL`; no secret value was present. |
| Five deployed application images                                    | PASS   | Auth, Video, Processor, Notification, and Frontend pods were `Ready=true`, each with a distinct `docker://sha256:...` image ID. `node --version` inside every image returned `v24.15.0`; Processor returned FFmpeg `5.1.9`.                                                                                     |
| Rebuild five current images through `make k8s-start PROFILE=fiap-x` | FAIL   | Minikube stopped before the build with `RSRC_DOCKER_STORAGE`: Docker `/var` was at 100%. The suggested `--force` and destructive prune options were not used. Therefore the running image IDs prove the existing deployment, not a fresh build of the current Dockerfiles during this step.                     |

## Kubernetes manifests and cluster

| Validation                    | Result       | Evidence                                                                                                                                                                                                            |
| ----------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Static render                 | PASS         | `scripts/k8s/static-validate.sh` rendered the application and base compositions; `kubectl kustomize` produced 18 application resources and 39 complete-base resources.                                              |
| Strict offline schema check   | NOT EXECUTED | `kubeconform` is not installed.                                                                                                                                                                                     |
| Live node                     | PASS         | Node `fiap-x` reported `Ready`; `MemoryPressure=False`, `DiskPressure=False`, and `PIDPressure=False`.                                                                                                              |
| Workloads                     | PASS         | Nine Deployments and the MySQL StatefulSet were available; MySQL migration and seed Jobs were complete; four PVCs were `Bound`; Video and Processor HPAs were present.                                              |
| Documented start procedure    | FAIL         | `make k8s-start PROFILE=fiap-x` confirmed prerequisites and the Docker-based profile, then Minikube rejected startup because its internal `/var` had no free space. No force flag or storage cleanup was performed. |
| Shared video storage capacity | FAIL         | `df -h /data/videos` in both Video and Processor showed a 24 GiB filesystem at 100%, with 0 available.                                                                                                              |

The apparent difference between `minikube status` (`InsufficientStorage`) and Kubernetes node
condition `DiskPressure=False` was recorded rather than reconciled by changing the environment.

## GitHub Actions workflows

| Validation               | Result       | Evidence                                                                                                            |
| ------------------------ | ------------ | ------------------------------------------------------------------------------------------------------------------- |
| YAML syntax              | PASS         | Ruby YAML parsing succeeded for `.github/workflows/ci.yml` and `images.yml`.                                        |
| Quality workflow content | PASS         | Static assertions found all five commands: `format:check`, `lint`, `typecheck`, `test:coverage`, and `build`.       |
| Image workflow content   | PASS         | Static assertions found all five component matrix entries, PR `push: false`, and the separate tag publication path. |
| `actionlint` validation  | NOT EXECUTED | `actionlint` is not installed. No GitHub run or publication was triggered.                                          |

## Live service endpoints

Temporary local port-forwards were used and then closed.

| Check                             | Result | Evidence                                                                                                                                                |
| --------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend `/health`                | PASS   | HTTP success through `service/frontend`.                                                                                                                |
| Auth live/ready                   | PASS   | `/health/live` and `/health/ready` returned HTTP success.                                                                                               |
| Video live/ready                  | PASS   | `/health/live` and `/health/ready` returned HTTP success.                                                                                               |
| Processor live/ready              | PASS   | `/health/live` and `/health/ready` returned HTTP success.                                                                                               |
| Notification live/ready           | PASS   | `/health/live` and `/health/ready` returned HTTP success.                                                                                               |
| Auth, Video, Notification Swagger | PASS   | Each `/docs/` URL returned HTTP success. Processor intentionally has no Swagger UI.                                                                     |
| Prometheus                        | PASS   | `/-/ready` succeeded and `/api/v1/targets` reported 4 healthy targets out of 4.                                                                         |
| Grafana                           | PASS   | `/api/health` succeeded.                                                                                                                                |
| RabbitMQ Management UI            | PASS   | The UI root returned HTTP success and `rabbitmqctl list_users` showed the configured local administrator.                                               |
| RabbitMQ alarm health             | FAIL   | Authenticated `/api/health/checks/alarms` returned HTTP 503; `rabbitmq-diagnostics -q alarms` reported `Free disk space alarm on node rabbit@rabbitmq`. |

## Functional acceptance

| Scenario                                     | Result       | Evidence                                                                                                                                                                                                                                                            |
| -------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Login as John Doe                            | PASS         | `POST /auth/login` with the documented local demonstration seed returned an access token.                                                                                                                                                                           |
| Login as Mary Doe                            | PASS         | `POST /auth/login` with the documented local demonstration seed returned an access token.                                                                                                                                                                           |
| User isolation                               | PASS         | For an existing John video, Mary's detail request returned HTTP 404 and her list contained zero matches for John's video ID.                                                                                                                                        |
| Upload permitted MP4 with fps 1              | FAIL         | A valid MP4 generated by FFmpeg had the expected `ftyp` signature, but `POST /videos` returned HTTP 500. Video logged a sanitized `VideoOperationError`. Direct storage inspection showed `/data/videos` at 100%, consistent with a pre-processing storage failure. |
| Observe `QUEUED -> PROCESSING -> COMPLETED`  | NOT EXECUTED | The new upload was not accepted, so there was no new job whose transitions could be observed without fabricating a result.                                                                                                                                          |
| Download and inspect new ZIP                 | NOT EXECUTED | No new job reached `COMPLETED`. No unrelated existing archive was substituted as evidence.                                                                                                                                                                          |
| Create controlled FFmpeg failure             | NOT EXECUTED | Upload persistence is blocked by full shared storage, so the intentionally invalid-but-signature-compatible MP4 could not be accepted for processing.                                                                                                               |
| Manual retry from controlled failure         | NOT EXECUTED | No controlled `FAILED` record was created, and John's current list contained no existing `FAILED` record suitable for an honest fallback retry.                                                                                                                     |
| Internal notification for controlled failure | NOT EXECUTED | No controlled failure event was produced. Existing notification data was not presented as if it came from this acceptance run.                                                                                                                                      |

The failed upload occurred before asynchronous acceptance and correctly used HTTP 500 rather than
the HTTP 200/`success:false` semantics reserved for a later FFmpeg/ZIP result. This observation does
not replace the unexecuted asynchronous failure scenario.

## Acceptance summary

| Result       | Count |
| ------------ | ----: |
| PASS         |    30 |
| FAIL         |     5 |
| NOT EXECUTED |     7 |

- PASS: tool inventory, all five quality gates, Dockerfile static checks, five running images,
  manifest rendering, live Kubernetes workloads, health/readiness, John and Mary authentication,
  per-user isolation, three Swagger UIs, four Prometheus targets, Grafana, and RabbitMQ Management
  UI availability.
- FAIL: fresh documented stack start/image rebuild, shared storage capacity, RabbitMQ alarm health,
  and new permitted-video upload.
- NOT EXECUTED: strict kubeconform/actionlint checks and the downstream success/failure flows that
  require a newly accepted upload.

No correction was attempted. Before recording a full live demonstration, an operator must restore
free space in the Docker/Minikube environment using an explicitly chosen local maintenance action,
then rerun `make k8s-start PROFILE=fiap-x` and the acceptance flow. This report does not authorize or
perform data deletion.

## Reproduction commands

The principal read-only or project-provided commands used as evidence were:

```sh
node --version
npm --version
docker --version
docker info --format '{{.ServerVersion}} {{.OperatingSystem}}'
kubectl version --client=true --output=yaml
minikube version --short

npm run format:check
npm run lint
npm run typecheck
npm run test:coverage
npm run build

docker buildx build --check --file infra/docker/auth-service/Dockerfile .
docker buildx build --check --file infra/docker/video-service/Dockerfile .
docker buildx build --check --file infra/docker/processor-service/Dockerfile .
docker buildx build --check --file infra/docker/notification-service/Dockerfile .
docker buildx build --check --file infra/docker/frontend/Dockerfile .

scripts/k8s/static-validate.sh
kubectl kustomize infra/k8s/apps
kubectl kustomize infra/k8s/base
minikube status --profile fiap-x
kubectl --context fiap-x get node
kubectl --context fiap-x -n fiap-x get deployments,statefulsets,pods,hpa,jobs,pvc
make k8s-start PROFILE=fiap-x
kubectl --context fiap-x -n fiap-x exec deployment/video-service -- df -h /data/videos
kubectl --context fiap-x -n fiap-x exec deployment/processor-service -- df -h /data/videos
kubectl --context fiap-x -n fiap-x exec deployment/rabbitmq -- rabbitmq-diagnostics -q alarms
```

Service HTTP checks used temporary `kubectl port-forward` processes, which were closed after the
checks. Workflow validation parsed `.github/workflows/ci.yml` and `.github/workflows/images.yml` as
YAML and asserted their documented command and image matrices without triggering GitHub Actions.
