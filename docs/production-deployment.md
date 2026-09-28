# Production deployment

This repository can deploy the application to a prepared Kubernetes cluster, including Amazon EKS,
Azure Kubernetes Service, Google Kubernetes Engine, or a self-managed cluster. The deployment
workflow applies the application services; it does not provision a cloud account, cluster, DNS,
certificate, data service, or storage service.

## Deployment flow

1. A merge into `main` publishes five immutable GHCR images tagged `sha-<commit>`.
2. When `PRODUCTION_DEPLOY_ENABLED=true`, GitHub starts the production deployment workflow with
   that image tag.
3. GitHub enforces the protection rules configured on the `production` Environment.
4. The workflow applies configuration, secrets, and the production Kubernetes overlay, then waits
   for the five application rollouts.

A version tag matching `v*` publishes versioned images without triggering another automatic
deployment. The **Deploy production** workflow can also be started manually to apply a published
`v*` or `sha-<commit>` image tag.

## Cluster prerequisites

The target cluster must provide:

- GitHub Actions network access to the Kubernetes API;
- an Ingress controller compatible with the configured ingress class, DNS for the public domain,
  and TLS termination;
- a pre-created PersistentVolumeClaim for shared video storage with simultaneous read/write access
  from Video and Processor pods. EKS deployments commonly use EFS with `ReadWriteMany`; a standard
  EBS `ReadWriteOnce` volume is not suitable for the shared claim;
- MySQL with the required databases and migrations, plus reachable Redis and RabbitMQ instances;
  and
- a least-privilege Kubernetes identity that can manage the selected namespace, Deployments,
  Services, ConfigMaps, Secrets, Ingresses, and HorizontalPodAutoscalers.

## GitHub configuration

Create the repository variable `PRODUCTION_DEPLOY_ENABLED` with value `true` in **Settings >
Secrets and variables > Actions > Variables** to enable deployments after merges into `main`.

Create a `production` Environment in **Settings > Environments** and configure required reviewers.
Store the following values in that Environment. Do not commit credentials or store them in `.env`.

### Variables

| Name                             | Example                             | Purpose                                                            |
| -------------------------------- | ----------------------------------- | ------------------------------------------------------------------ |
| `PRODUCTION_NAMESPACE`           | `fiap-x`                            | Kubernetes namespace. Defaults to `fiap-x`.                        |
| `PRODUCTION_DOMAIN`              | `app.example.com`                   | Public domain without `https://`. Required.                        |
| `PRODUCTION_INGRESS_CLASS`       | `nginx`                             | Ingress class. Defaults to `nginx`.                                |
| `PRODUCTION_IMAGE_REGISTRY`      | `ghcr.io/my-org`                    | Image registry. Defaults to the repository owner's GHCR namespace. |
| `PRODUCTION_GHCR_PULL_USERNAME`  | `my-org`                            | Identity used by the cluster to pull GHCR images. Required.        |
| `PRODUCTION_VIDEO_STORAGE_CLAIM` | `video-storage`                     | Existing shared-storage PVC. Defaults to `video-storage`.          |
| `PRODUCTION_MYSQL_HOST`          | `db.example.rds.amazonaws.com`      | MySQL host. Required.                                              |
| `PRODUCTION_MYSQL_PORT`          | `3306`                              | MySQL port. Defaults to `3306`.                                    |
| `PRODUCTION_MYSQL_SSL`           | `true`                              | Enables MySQL TLS. Defaults to `true`.                             |
| `PRODUCTION_REDIS_HOST`          | `cache.example.com`                 | Redis host. Required.                                              |
| `PRODUCTION_REDIS_PORT`          | `6379`                              | Redis port. Defaults to `6379`.                                    |
| `PRODUCTION_RABBITMQ_HOST`       | `rabbitmq.example.com`              | RabbitMQ host. Required.                                           |
| `PRODUCTION_RABBITMQ_PORT`       | `5672`                              | RabbitMQ port. Defaults to `5672`.                                 |
| `PRODUCTION_PROMETHEUS_URL`      | `http://prometheus.monitoring:9090` | Prometheus endpoint when available.                                |

### Secrets

| Name                                                      | Purpose                                                             |
| --------------------------------------------------------- | ------------------------------------------------------------------- |
| `PRODUCTION_KUBECONFIG_B64`                               | Base64-encoded, least-privilege kubeconfig used by the workflow.    |
| `PRODUCTION_AUTH_JWT_SECRET`                              | JWT secret containing at least 32 characters.                       |
| `PRODUCTION_MYSQL_USERNAME` / `PRODUCTION_MYSQL_PASSWORD` | Application database credentials.                                   |
| `PRODUCTION_REDIS_URL`                                    | Complete Redis URL, including credentials when required.            |
| `PRODUCTION_RABBITMQ_URL`                                 | Complete RabbitMQ URL, including credentials.                       |
| `PRODUCTION_GHCR_PULL_TOKEN`                              | Package-read token used by the cluster to pull private GHCR images. |

On macOS, encode a kubeconfig value with:

```bash
base64 < kubeconfig-production.yaml | tr -d '\n'
```

Treat the kubeconfig as a credential: do not commit it, add it to `.env`, or print it in logs.

## Deploying a release

1. Merge an approved pull request into `main`.
2. Approve the `production` Environment when GitHub requests approval.
3. Confirm that all deployments complete and open `https://<PRODUCTION_DOMAIN>`.

To apply an existing image version, open **Actions > Deploy production > Run workflow** and enter
the required `v*` or `sha-<commit>` tag.

The production overlay is located in `infra/k8s/overlays/production`. Its placeholders are rendered
from the Environment variables by the deployment workflow and it must not be applied directly.
