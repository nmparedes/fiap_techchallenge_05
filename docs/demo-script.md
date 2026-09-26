# Demo script - FIAP X

Target duration: 8-10 minutes. This script uses only the local Minikube implementation and the
behaviour documented in [Final acceptance](final-acceptance.md). The accounts below are seeds for
the local academic demonstration only.

## Before recording

From the repository root, confirm the exact context and start the documented stack:

```sh
minikube status --profile fiap-x
kubectl config current-context
make k8s-start PROFILE=fiap-x
make k8s-status PROFILE=fiap-x
```

Expected: context `fiap-x`, all workloads ready, migrations and seed Jobs complete, and the hosts
entry printed by `k8s-status`. Open <http://fiap-x.local>. If the Docker-driver address is not
routable, keep `minikube tunnel --profile fiap-x` running and use the hosts entry documented by the
status command.

Before attempting the functional flow, verify the two resources that blocked the final acceptance:

```sh
kubectl --context fiap-x -n fiap-x exec deployment/video-service -- df -h /data/videos
kubectl --context fiap-x -n fiap-x exec deployment/rabbitmq -- rabbitmq-diagnostics -q alarms
```

Expected: free capacity on `/data/videos` and no RabbitMQ disk alarm. At acceptance time the volume
was full and RabbitMQ reported a free-disk alarm. If either condition remains, do not represent the
upload flow as successful. Use the fallback at the end after an operator has chosen a safe local
maintenance action; this script does not prescribe deletion.

In separate terminals, start only the port-forwards needed on screen:

```sh
kubectl --context fiap-x -n fiap-x port-forward service/auth-service 3001:3001
kubectl --context fiap-x -n fiap-x port-forward service/video-service 3002:3002
kubectl --context fiap-x -n fiap-x port-forward service/notification-service 3004:3004
kubectl --context fiap-x -n fiap-x port-forward service/rabbitmq 15672:15672
kubectl --context fiap-x -n fiap-x port-forward service/prometheus 9090:9090
kubectl --context fiap-x -n fiap-x port-forward service/grafana 3000:3000
```

## Recording sequence

### 1. Problem and architecture - 45 seconds

Show [Architecture](architecture.md) and explain: FIAP X receives a video, extracts frames with
FFmpeg, packages them as a ZIP, and lets only the owner download the result. Point out the Frontend,
Auth, Video, Processor and Notification components; RabbitMQ provides the asynchronous flow, MySQL
persists business data, Redis caches video queries, and shared storage carries input and output
files. Prometheus scrapes the four backend services and Grafana presents the metrics.

Expected: the diagram contains these components and shows Processor as an internal worker, not a
public API.

### 2. Services and technologies - 45 seconds

Run:

```sh
kubectl --context fiap-x -n fiap-x get deployments,statefulsets,pods,hpa,jobs,pvc
```

Explain that the monorepo uses Node.js 24.15.0, TypeScript and Fastify; the frontend uses React;
there are five application images; and the local platform is Kubernetes through Minikube.

Expected: nine Deployments, the MySQL StatefulSet, ready application pods, completed migration and
seed Jobs, bound PVCs, and Video/Processor HPAs. If the live counts differ, describe the displayed
state instead of quoting these expected counts.

### 3. Login - 30 seconds

At <http://fiap-x.local>, sign in as John Doe:

- Username: `john.doe`
- Password: `JohnDoe123!`

Expected: the authenticated video workspace opens. State that this is a local demonstration seed,
not a production credential.

### 4. Upload rules and fps - 60 seconds

Select a small valid MP4 and keep `fps` at `1`. Explain before submitting:

- accepted extensions are MP4, AVI, MOV, MKV, WMV, FLV and WebM, case-insensitively;
- the maximum is exactly 200 MiB;
- `fps` means images extracted per second, accepts integers from 1 to 10, and defaults to 1.

Submit the upload. Expected: HTTP 202 after the durable RabbitMQ publication is confirmed and a new
video appears as `QUEUED`. Invalid input is HTTP 400; a storage, database or enqueue failure before
acceptance is HTTP 500.

### 5. Asynchronous processing - 45 seconds

Keep the page visible and point out the `QUEUED -> PROCESSING -> COMPLETED` transitions. The frontend
polls every three seconds; no WebSocket or SSE is claimed.

Expected: the job reaches `COMPLETED`. RabbitMQ carries metadata and storage keys, while Processor
runs FFmpeg and creates the ZIP from deterministic PNG frames.

### 6. Download and inspect the ZIP - 45 seconds

Use the completed video's Download action and save the archive. In a terminal, inspect the exact
downloaded path:

```sh
unzip -t /path/to/downloaded/output.zip
zipinfo -1 /path/to/downloaded/output.zip
```

Expected: `unzip -t` reports no errors and the listing contains PNG frames. Do not use the literal
placeholder path during the recording. Explain that download authorization is owner-scoped.

### 7. Functional failure, retry and internal notification - 90 seconds

Prepare a deliberately corrupt file that passes the MP4 signature check but cannot be decoded by
FFmpeg:

```sh
printf '\x00\x00\x00\x18ftypisomnot-a-real-video' > /tmp/fiap-x-controlled-failure.mp4
```

Upload it as John with `fps` 1. Expected according to the verified contract: initial acceptance is
HTTP 202; the later processing result is `FAILED`; detail remains HTTP 200 with `success: false` and
`FFMPEG_ERROR`. The internal Notifications area receives the failure notification. Use Retry once
and explain that it starts a new manual attempt; it does not turn the corrupt input into a valid
video and there is no automatic functional retry.

This controlled live scenario was **not executed in final acceptance** because shared storage was
full. Perform it on video only after the preflight checks are healthy. If the prepared byte sequence
is rejected before asynchronous acceptance in the current environment, report the observed HTTP
400/500 result and use the fallback; do not call it an FFmpeg failure.

### 8. User isolation - 45 seconds

Note one of John's video IDs, sign out, and sign in as Mary Doe:

- Username: `mary.doe`
- Password: `MaryDoe123!`

Expected: Mary's list does not contain John's video, and direct lookup of that John ID returns HTTP 404. This isolation check passed during final acceptance. Sign back in as John if another screen is
needed.

### 9. Swagger - 30 seconds

Open:

- Auth: <http://localhost:3001/docs>
- Video: <http://localhost:3002/docs>
- Notification: <http://localhost:3004/docs>

Expected: three Swagger UIs. Explain that Processor is deliberately internal and has no Swagger UI.

### 10. Health, metrics, Prometheus and Grafana - 60 seconds

Show representative endpoints and dashboards:

```sh
curl --fail http://localhost:3001/health/live
curl --fail http://localhost:3001/health/ready
curl --fail http://localhost:3002/health/live
curl --fail http://localhost:3004/health/ready
```

Open Prometheus at <http://localhost:9090> and Grafana at <http://localhost:3000>. Expected:
Prometheus is ready with four healthy service targets and Grafana shows the provisioned FIAP X
dashboard. Grafana credentials are generated locally; retrieve them only when needed using the
commands in [Local Minikube](local-kubernetes.md#internal-tools-and-swagger). RabbitMQ Management is
available at <http://localhost:15672> using its generated local credentials.

### 11. Kubernetes and GitHub Actions - 45 seconds

Return to the workload command from step 2, then show `.github/workflows/ci.yml` and
`.github/workflows/images.yml`. Explain only what is present: CI runs format, lint, typecheck,
coverage and build; the image workflow covers the five application images and has a separate tag
publication path. No workflow or image is triggered during the demonstration.

The matching local commands are:

```sh
npm run format:check
npm run lint
npm run typecheck
npm run test:coverage
npm run build
```

Expected from final acceptance: all five pass; 59 suites and 339 tests pass, and each workspace
aggregate remains above 80% for statements, branches, functions and lines.

### 12. Closing - 30 seconds

Relate what was shown to the academic requirements: authenticated owner isolation, seven upload
formats and 200 MiB limit, fps semantics, durable asynchronous processing, FFmpeg/ZIP output,
manual retry with internal notification, observability, Docker, Minikube and CI. State the explicit
limits: local environment only, no cloud deployment and no external notifications.

## Legitimate technical fallback

If storage, RabbitMQ, ingress, or a workload becomes unavailable during recording:

1. Show the failing command and actual result; do not substitute old data as a live success.
2. Show [Final acceptance](final-acceptance.md), which distinguishes PASS, FAIL and NOT EXECUTED,
   and [Final audit](final-audit.md) for the statically and test-verified contract.
3. Run `make k8s-status PROFILE=fiap-x` and, if the stack is otherwise healthy,
   `make k8s-smoke PROFILE=fiap-x`. The smoke test performs health checks, John login, upload,
   polling, successful archive download and notification lookup without changing application code.
4. Omit any live success claim for upload, transitions, ZIP, controlled failure, retry or
   notification that did not actually complete.

The fallback is only for legitimate local technical unavailability; it is not a prerecorded or
fabricated replacement for the functional demonstration.
