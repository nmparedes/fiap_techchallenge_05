#!/usr/bin/env bash

set -Eeuo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

parse_profile "$@"

"$SCRIPT_DIR/prerequisites.sh" --profile "$PROFILE"

log "Starting or selecting Minikube profile '$PROFILE'"
minikube start \
  --profile "$PROFILE" \
  --driver=docker \
  --container-runtime=docker \
  --cpus="${FIAP_X_MINIKUBE_CPUS:-4}" \
  --memory="${FIAP_X_MINIKUBE_MEMORY:-6144mb}" \
  --disk-size="${FIAP_X_MINIKUBE_DISK_SIZE:-20g}"

select_profile_context
assert_profile_context

log "Enabling ingress and metrics-server addons"
minikube --profile "$PROFILE" addons enable ingress
minikube --profile "$PROFILE" addons enable metrics-server
kube --namespace ingress-nginx rollout status deployment/ingress-nginx-controller --timeout=240s
kube --namespace kube-system rollout status deployment/metrics-server --timeout=240s

"$SCRIPT_DIR/validate.sh" --profile "$PROFILE"
"$SCRIPT_DIR/images.sh" --profile "$PROFILE"
"$SCRIPT_DIR/secrets.sh" --profile "$PROFILE"

log "Applying MySQL, Redis, RabbitMQ, shared storage, Prometheus, and Grafana"
kube apply --kustomize "$PROJECT_ROOT/infra/k8s/dependencies"

kube --namespace "$NAMESPACE" rollout status statefulset/mysql --timeout=300s
for deployment in redis rabbitmq prometheus grafana; do
  kube --namespace "$NAMESPACE" rollout status "deployment/$deployment" --timeout=300s
done

log "Waiting for the idempotent migration Job"
if ! kube --namespace "$NAMESPACE" wait --for=condition=complete job/mysql-migrate --timeout=300s; then
  kube --namespace "$NAMESPACE" logs job/mysql-migrate --all-containers=true || true
  die "MySQL migrations failed or timed out"
fi
kube --namespace "$NAMESPACE" logs job/mysql-migrate --all-containers=true

if kube --namespace "$NAMESPACE" get job mysql-seed >/dev/null 2>&1; then
  log "Seed Job already exists; it will not be executed again"
else
  log "Creating the one-time seed Job"
  kube apply --filename "$PROJECT_ROOT/infra/k8s/operations/mysql-seed-job.yaml"
fi

if ! kube --namespace "$NAMESPACE" wait --for=condition=complete job/mysql-seed --timeout=300s; then
  kube --namespace "$NAMESPACE" logs job/mysql-seed --all-containers=true || true
  die "MySQL seed failed or timed out"
fi
kube --namespace "$NAMESPACE" logs job/mysql-seed --all-containers=true

log "Applying the five application components, Ingress, and HPAs"
kube apply --kustomize "$PROJECT_ROOT/infra/k8s/apps"

for deployment in auth-service video-service processor-service notification-service frontend; do
  kube --namespace "$NAMESPACE" rollout status "deployment/$deployment" --timeout=300s
done

log "FIAP X rollouts completed"
print_access
printf '\nRun the smoke test with:\n  make k8s-smoke PROFILE=%s\n' "$PROFILE"

