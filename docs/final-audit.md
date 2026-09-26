# Final compliance audit - step 11.1

Audit date: 2026-09-16  
Audited project: `/Users/moryanp/dev/sandbox/fiap/tech-challenge-05`

## Scope and classification rules

This report audits only the requirements documented in the academic brief and the approved Phase
01 through Phase 10 plans. It does not add production hardening requirements. No application code,
configuration, tests, manifests, workflows, or external deployment state was changed during the
audit.

Classifications:

- **PASS**: the requirement has direct evidence in inspected source/configuration and, where
  applicable, a successful reproducible validation.
- **FAIL**: inspected evidence or an executed validation directly contradicts the requirement.
- **NOT VERIFIED**: the available static evidence is compatible with the requirement, but the
  audit did not obtain enough runtime evidence to claim compliance.

Observed facts and unexecuted/runtime assumptions are kept separate below. A passing unit test is
evidence of the tested behavior, not proof that an unstarted external dependency or cluster works.

## Sources inspected

- Primary brief: `/Users/moryanp/dev/sandbox/fiap/docs/POSTECH - SOAT - Fase 5 - Hacka.pdf`, all 5
  pages, extracted with `pdftotext -layout` and checked with `pdfinfo`.
- Approved plans: `/Users/moryanp/dev/sandbox/fiap/docs/prompts/Fase 01.md` through `Fase 10.md`, all
  1,682 lines read.
- Complete project tree excluding dependency internals, including `apps/**`, `packages/**`,
  `infra/mysql/**`, `infra/docker/**`, `infra/k8s/**`, `infra/monitoring/**`, `scripts/**`, `docs/**`,
  `.github/workflows/**`, root tooling files, tests, generated coverage summaries, and build
  artifacts.
- The old prototype was treated only as a non-normative reference. No compliance conclusion relies
  on it because the current source, brief, and approved plans were sufficient.

The supplied project directory contains no `.git` metadata. Therefore branch history, remote
repository state, and past GitHub runs were not asserted as verified facts.

## Executed validation summary

All five npm gates were run from an isolated copy at `/tmp/fiap-x-audit.GP5vXK/repo` so their
generated outputs could not alter the audited project.

| Command                                                                             | Result               | Reproducible observation                                                                                                                                                                        |
| ----------------------------------------------------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node --version`                                                                    | PASS                 | `v24.15.0`                                                                                                                                                                                      |
| `npm run format:check`                                                              | RESOLVED in 11.2     | It failed in 11.1 on 25 files. After formatting only those files, the complete root/workspace gate exited 0.                                                                                    |
| `npm run lint`                                                                      | RESOLVED in 11.2     | It failed in 11.1 with four `no-undef` errors in `infra/docker/frontend/server.mjs`. After the file-scoped Node global override, the complete root/workspace gate exited 0.                     |
| `npm run typecheck`                                                                 | PASS                 | Root TypeScript build/test configuration and workspace scripts completed with exit code 0.                                                                                                      |
| `npm run test:coverage`                                                             | PASS                 | 10 workspaces, 59 suites, and 339 tests passed. Every workspace aggregate exceeded 80% for statements, branches, functions, and lines.                                                          |
| `npm run build`                                                                     | PASS                 | All 10 workspaces built; the Vite production build completed successfully.                                                                                                                      |
| `bash scripts/k8s/static-validate.sh`                                               | PASS with limitation | `kubectl kustomize` rendered application and full base compositions. `kubeconform` was unavailable, so strict Kubernetes schema validation was not run.                                         |
| Ruby YAML parse over `infra/**/*.yml`, `infra/**/*.yaml`, `.github/workflows/*.yml` | PASS                 | Both workflows and all Kubernetes/monitoring YAML files parsed successfully. This checks YAML syntax, not GitHub expression semantics.                                                          |
| `jq empty` on both Grafana dashboard JSON files                                     | PASS                 | Both dashboard documents are valid JSON.                                                                                                                                                        |
| `docker compose --env-file .env.audit -f infra/monitoring/compose.yaml config`      | PASS                 | Monitoring Compose interpolation and structure rendered successfully in the isolated copy.                                                                                                      |
| `docker buildx build --check --file <Dockerfile> .` for five Dockerfiles            | PASS with warnings   | All five checks completed. The frontend produced two `SecretsUsedInArgOrEnv` heuristic warnings because the public URL variable contains `AUTH`; no credential or secret value was found there. |

Not executed: image builds, container startup, `promtool`, live Minikube dry-run/apply, migrations
against a real MySQL instance, real RabbitMQ/Redis integration, or the end-to-end smoke script.
These operations were not necessary for static validation and would create or mutate external
runtime state. `actionlint`, `yamllint`, `kubeconform`, and `promtool` were not installed.

## Compliance checklist

### C01 - Node.js 24.15.0, TypeScript, Fastify, and monorepo - PASS

**Observed evidence:** `package.json` is private, ESM, declares npm workspaces `apps/*` and
`packages/*`, fixes `engines.node` to `24.15.0`, and uses TypeScript `5.9.3`. `.nvmrc` and
`.node-version` both contain `24.15.0`. The active runtime returned `v24.15.0`. The four services
depend on and instantiate Fastify; `npm run typecheck` and `npm run build` passed.

**Minimum correction:** none.

### C02 - Separate Auth, Video, Processor, and Notification services - PASS

**Observed evidence:** separate executable workspaces exist at `apps/auth-service`,
`apps/video-service`, `apps/processor-service`, and `apps/notification-service`, each with its own
package, configuration, entrypoint, tests, and build output. Docker and Kubernetes also define one
image/deployment per service.

**Minimum correction:** none.

### C03 - JWT Bearer and per-user isolation - PASS

**Observed evidence:** `apps/auth-service/src/app.ts` issues HS256 JWTs with `sub`, issuer,
audience, and expiration. `packages/infrastructure/src/jwt.ts` verifies algorithm, issuer,
audience, expiry, and claims. Video repository queries in
`apps/video-service/src/video-repository.ts` filter by both `id` and `user_id`; notification queries
in `apps/notification-service/src/notification-repository.ts` filter by `user_id` derived from the
verified token. HTTP tests cover missing/invalid/expired tokens and John/Mary isolation.

**Minimum correction:** none.

### C04 - John Doe and Mary Doe seeds - PASS

**Observed evidence:** `packages/infrastructure/src/mysql/seeds.ts` defines `john.doe` /
`JohnDoe123!` and `mary.doe` / `MaryDoe123!`, hashes passwords with `bcryptjs` cost 12, and skips
existing usernames. `packages/infrastructure/src/mysql/seeds.test.ts` verifies idempotence and that
plaintext passwords are not inserted. The Kubernetes seed Job invokes the compiled seed CLI.

**Minimum correction:** none.

### C05 - Seven upload extensions and 200 MiB limit - PASS

**Observed evidence:** `apps/video-service/src/upload-policy.ts` accepts case-insensitive MP4, AVI,
MOV, MKV, WMV, FLV, and WebM, checks signatures, and defines `200 * 1024 * 1024` bytes. Fastify
multipart and the application service both enforce the limit. `apps/frontend/src/upload-validation.ts`
duplicates the client-side guard without replacing backend validation. Unit/API tests cover all
seven extensions, invalid content, and the size boundary.

**Minimum correction:** none.

### C06 - Integer fps 1..10, default 1, images-per-second semantics - PASS

**Observed evidence:** Video multipart validation accepts only the regular expression
`1` through `10`, defaults to `1`, and revalidates with `Number.isInteger`. The Processor validates
the same interval and invokes FFmpeg with `-vf fps=<value>` in
`apps/processor-service/src/ffmpeg.ts`. The frontend uses `min=1`, `max=10`, `step=1`, value `1`,
and an accessible tooltip stating that fps is the number of images extracted per second.

**Minimum correction:** none.

### C07 - Asynchronous RabbitMQ flow and durable topology - PASS

**Observed evidence:** `packages/infrastructure/src/rabbitmq.ts` declares durable topic exchange
`video.events`, durable quorum queues, durable dead-letter exchange/queue, persistent messages,
publisher confirms, manual acknowledgements, configurable prefetch, and validation before
handling. Upload returns 202 only after the publisher promise completes. RabbitMQ tests verify
topology, persistence, confirms, prefetch 1, acknowledgements, redelivery, and dead-lettering.

**Minimum correction:** none.

### C08 - FFmpeg, ZIP, cleanup, functional failures, and manual retry - PASS

**Observed evidence:** `apps/processor-service/src/ffmpeg.ts`, `zip.ts`, and
`processing-attempt.ts` run FFmpeg without a shell, require produced frames, write ZIP via a
partial path, remove partial output on failure, remove temporary frames after every attempt, and
remove input only after successful archive creation. Known failures map to `FFMPEG_ERROR` or
`ZIP_ERROR`. `POST /videos/:id/retry` is owner-scoped, requires `FAILED`, atomically increments the
attempt, verifies retained input, republishes with confirm, and has no retry limit. Tests cover
success, FFmpeg/ZIP failures, cleanup, redelivery, and retry conflict/rollback paths.

**Minimum correction:** none.

### C09 - HTTP 200 with `success:false` for FFmpeg/ZIP failures; 400/500 before processing - PASS

**Observed evidence:** `GET /videos/:id` in `apps/video-service/src/app.ts` returns HTTP 200 with
`success: false`, `FAILED`, and the stored functional error for terminal processing failure.
Validation/multipart errors map to 400, while storage, persistence, and publication failures map to
sanitized 500 responses. API tests explicitly cover these distinctions.

**Minimum correction:** none.

### C10 - Authorized download - PASS

**Observed evidence:** `GET /videos/:id/download` requires Bearer authentication. The service loads
the record through an owner-filtered repository lookup, requires `COMPLETED`, derives/validates the
archive path rather than accepting a client path, and streams `application/zip`. Foreign IDs map
to the same 404 behavior as absent IDs. Tests cover ownership, status conflicts, streaming, and a
missing archive.

**Minimum correction:** none.

### C11 - Internal-only notifications - PASS

**Observed evidence:** Notification consumes only `video.processing.failed`, persists an internal
record idempotently by video and attempt, and exposes only authenticated `GET /notifications`.
There is no e-mail, SMS, push, WebSocket, or SSE implementation. The frontend polls and renders
this internal API.

**Minimum correction:** none.

### C12 - Health/live, health/ready, logs, and metrics - PASS

**Observed evidence:** all four services expose `/health/live`, `/health/ready`, and `/metrics`.
Readiness checks only required dependencies for each service. `packages/observability/src/logger.ts`
provides structured JSON logging with service/correlation context and secret redaction. Shared and
service metrics cover HTTP requests/duration, dependency readiness, auth outcomes, uploads/retries,
processor outcomes/duration/errors, and notification outcomes/duration. Tests validate endpoints,
metric registration, bounded labels, and redaction.

**Minimum correction:** none.

### C13 - Prometheus and Grafana - PASS

**Observed evidence:** `infra/monitoring` contains Prometheus configuration with four service
targets and Grafana datasource/dashboard provisioning. The dashboard includes HTTP traffic,
errors, latency, uploads, retries, processor outcomes/duration, notification outcomes, and
readiness. The same assets are incorporated into Kubernetes ConfigMaps. Compose/YAML and both
dashboard JSON files passed static parsing; dashboard queries match metric names present in code.
Runtime scrape and dashboard rendering were not claimed.

**Minimum correction:** none.

### C14 - Vintage pastel ASCII frontend, tooltips, and 3-second polling - PASS

**Observed evidence:** `apps/frontend/src/app.ts` creates the ASCII terminal layout, Portuguese
labels, upload/catalog/notification regions, and tooltips for username, password, video, fps, and
retry. `apps/frontend/src/styles.css` defines the monospace pastel presentation, focus behavior,
responsive layout, and reduced-motion handling. `POLLING_INTERVAL_MS` is exactly `3000`; polling
runs only for an authenticated visible page, prevents overlap, and stops on logout/unmount. DOM
tests cover tooltips, accessibility, polling interval/cancellation, output escaping, and the happy
flow.

**Minimum correction:** none.

### C15 - Swagger/OpenAPI - PASS

**Observed evidence:** Auth, Video, and Notification register `@fastify/swagger` with OpenAPI 3.1,
serve Swagger UI at `/docs`, declare request/response schemas, and document Bearer security on
functional protected routes. Their tests inspect generated OpenAPI documents. Processor has only
internal operational endpoints and the approved Phase 5 plan explicitly excluded Swagger/public
business API for that worker.

**Minimum correction:** none.

### C16 - Docker and Minikube - NOT VERIFIED

**Observed evidence:** five separate multi-stage Dockerfiles pin `node:24.15.0-bookworm-slim`, use
compiled entrypoints, run as `node`, and include FFmpeg only in Processor. All five passed
`docker buildx build --check`; the frontend's two heuristic `AUTH`-name warnings do not identify a
real secret. Kustomize successfully rendered dependencies and applications, including five
Deployments/Services, MySQL, Redis, RabbitMQ, Prometheus, Grafana, shared Video/Processor PVC,
Ingress, probes, and Video/Processor HPAs. Scripts require an explicit Minikube profile and guard
cluster context.

**Unverified runtime hypothesis:** the images are buildable/runnable together and the rendered
resources pass server schema validation, roll out, migrate/seed, process a real upload, and serve a
download in Minikube. No image build, cluster apply, or smoke test was executed in this read-only
audit; `kubeconform` was unavailable.

### C17 - GitHub Actions - RESOLVED

**Observed evidence:** `.github/workflows/ci.yml` has pull-request and main-push triggers,
read-only permissions, concurrency cancellation, Node 24.15.0, `npm ci`, and the five required
separate gates. `.github/workflows/images.yml` has a five-component matrix, PR build without push,
tag `v*` publication to GHCR with job-scoped `packages: write`, immutable version/SHA tags, BuildKit
cache, and Processor FFmpeg verification. Both files parse as YAML.

Step 11.2 formatted only the 25 files reported in 11.1 and added a file-scoped ESLint override for
the legitimate `console`, `process`, and `URL` globals in `infra/docker/frontend/server.mjs`. No
workflow behavior, dependency, functional code, or threshold changed. The five commands used by
CI now exit 0: `format:check`, `lint`, `typecheck`, `test:coverage`, and `build`. Coverage retained
59 passing suites / 339 passing tests and remained above 80% in all four metrics for every
workspace aggregate.

**Minimum correction:** completed by R-11.2-001.

### C18 - Jest and 80% in all four metrics - PASS

**Observed evidence:** `packages/config/jest/base.config.js` enforces global 80% thresholds for
statements, branches, functions, and lines. `npm run test:coverage` executed every workspace and
passed 59 suites / 339 tests. The lowest workspace aggregate was Frontend at 93.34% statements,
84.30% branches, 95.83% functions, and 93.34% lines, all above threshold.

**Minimum correction:** none.

## Facts versus hypotheses

### Verified facts

- The source/configuration facts cited in C01-C18 were directly inspected.
- The exact command outcomes in the validation table were observed during this audit.
- Unit/API/DOM tests and coverage passed without live MySQL, Redis, RabbitMQ, FFmpeg, Docker
  containers, or Kubernetes.
- Dockerfile checks, Compose rendering, YAML/JSON parsing, and Kustomize rendering are static
  validations only.

### Hypotheses not promoted to facts

- A real multi-service run will connect successfully to MySQL, Redis, and RabbitMQ.
- Prometheus will scrape all four live targets and Grafana will render every panel with data.
- All five images will build and run on the target machine; static Dockerfile checks do not prove
  full builds.
- Minikube will complete rollouts and the smoke flow on this host.
- GitHub-hosted runners will behave identically to the local isolated-copy run. The current local
  failures are nevertheless deterministic inputs to that workflow.
- The absent `.git` metadata means repository history, remote linkage, default branch, and actual
  GitHub run history were not verified.

## Remediation scope for step 11.2

Only observed FAIL items appear here.

### R-11.2-001 - Restore green GitHub Actions quality gates - RESOLVED

- **Planned minimal correction (recorded before implementation):** apply Prettier only to the 25
  files named by the failed `format:check`, and add one file-scoped ESLint override declaring the
  legitimate `process`, `URL`, and `console` globals used by the Node.js frontend server. No
  functional code, workflow behavior, dependency, or test threshold will change. The existing
  `format:check` and `lint` gates are the direct regression checks for this configuration-only fix.
- **Violated requirement:** C17 - GitHub Actions; the required CI commands must complete
  successfully, but `format:check` and `lint` currently exit 1.
- **Probable files:** `docs/local-kubernetes.md`, `infra/docker/INVENTORY.md`,
  `infra/docker/frontend/server.mjs`, the 22 Prettier-reported files under `infra/k8s/**`, and
  `eslint.config.js` if a narrow Node override is selected.
- **Acceptance criterion:** from a clean copy with Node 24.15.0 and `npm ci`, each command exits 0
  independently: `npm run format:check`, `npm run lint`, `npm run typecheck`,
  `npm run test:coverage`, and `npm run build`; no workflow trigger, permission, matrix, or
  publishing behavior is broadened.
- **Implemented correction:** Prettier was applied only to the 25 files identified by 11.1.
  `eslint.config.js` received one override scoped to `infra/docker/frontend/server.mjs`, declaring
  only `console`, `process`, and `URL` as read-only globals.
- **Verification evidence:** all five acceptance commands exited 0 on 2026-09-16. Coverage passed
  59 suites and 339 tests, with every workspace aggregate above the configured 80% thresholds.
  No test file needed adjustment because the failed formatting and static-analysis gates are the
  direct regression checks for this configuration-only remediation.

## Totals

- PASS: **16**
- RESOLVED: **1**
- FAIL: **0**
- NOT VERIFIED: **1**
- Resolved remediation IDs: **R-11.2-001**
