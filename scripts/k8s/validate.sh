#!/usr/bin/env bash

set -Eeuo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

parse_profile "$@"
require_commands kubectl minikube
assert_profile_context

log "Rendering application and complete Kustomize compositions"
kubectl kustomize "$PROJECT_ROOT/infra/k8s/apps" >/dev/null
kubectl kustomize "$PROJECT_ROOT/infra/k8s/base" >/dev/null

log "Running client-side dry-runs against Minikube discovery"
kube apply --dry-run=client --kustomize "$PROJECT_ROOT/infra/k8s/base" >/dev/null
kube apply --dry-run=client --filename "$PROJECT_ROOT/infra/k8s/operations/mysql-seed-job.yaml" >/dev/null
kube apply --dry-run=client --filename "$PROJECT_ROOT/infra/k8s/dependencies/secret.example.yaml" >/dev/null
kube apply --dry-run=client --filename "$PROJECT_ROOT/infra/k8s/apps/application-secret.example.yaml" >/dev/null

log "Kustomize rendering and dry-runs passed"

