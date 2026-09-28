# Continuous integration and delivery

## Quality checks

The `.github/workflows/ci.yml` workflow runs for pushes and pull requests that target `dev`,
`uat`, or `main`. It uses Node.js 24.15.0 and npm 11.12.1, installs the locked dependencies with
`npm ci`, and runs these gates in order:

1. `npm run format:check`
2. `npm run lint`
3. `npm run typecheck`
4. `npm run test:coverage`
5. `npm run build`

Coverage reports are uploaded as workflow artifacts for seven days whenever they are available,
including when a test command fails.

The quality workflow does not start Minikube, publish images, or deploy an environment. Minikube
is a local development environment started explicitly by the developer.

## Container images

The `.github/workflows/images.yml` workflow builds all five application images for pull requests
that change image inputs. Pull-request builds verify the runtime images but do not authenticate to
a registry or publish an image.

When a change is merged into `main`, the workflow publishes immutable GHCR images tagged with the
commit SHA:

- `ghcr.io/<owner>/fiap-x-auth-service:sha-<commit>`
- `ghcr.io/<owner>/fiap-x-video-service:sha-<commit>`
- `ghcr.io/<owner>/fiap-x-processor-service:sha-<commit>`
- `ghcr.io/<owner>/fiap-x-notification-service:sha-<commit>`
- `ghcr.io/<owner>/fiap-x-frontend:sha-<commit>`

Pushing a version tag that matches `v*` publishes both the version tag, such as `v1.2.3`, and the
corresponding `sha-<commit>` tag. Workflows use the repository `GITHUB_TOKEN` with
job-scoped `packages: write` permission for publication.

## Production deployment

After a merge into `main`, the image workflow calls the production deployment workflow only when
the repository variable `PRODUCTION_DEPLOY_ENABLED` is exactly `true`. The deployment uses the
immutable image tag produced by that merge and is protected by the GitHub `production`
Environment.

The production workflow does not provision cloud infrastructure. It deploys the application to a
prepared Kubernetes cluster using the configuration stored in the `production` Environment. See
[Production deployment](production-deployment.md) for the required cluster resources, GitHub
variables, and secrets.
