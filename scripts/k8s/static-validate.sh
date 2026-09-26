#!/usr/bin/env bash

set -Eeuo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

require_commands kubectl

temporary_directory="$(mktemp -d "${TMPDIR:-/tmp}/fiap-x-k8s-validation.XXXXXX")"
trap 'rm -rf "$temporary_directory"' EXIT

kubectl kustomize "$PROJECT_ROOT/infra/k8s/apps" >"$temporary_directory/apps.yaml"
kubectl kustomize "$PROJECT_ROOT/infra/k8s/base" >"$temporary_directory/base.yaml"

if command -v kubeconform >/dev/null 2>&1; then
  kubeconform -strict -summary "$temporary_directory/apps.yaml"
  kubeconform -strict -summary "$temporary_directory/base.yaml"
  kubeconform -strict -summary \
    "$PROJECT_ROOT/infra/k8s/dependencies/secret.example.yaml" \
    "$PROJECT_ROOT/infra/k8s/apps/application-secret.example.yaml" \
    "$PROJECT_ROOT/infra/k8s/operations/mysql-seed-job.yaml"
else
  log "kubeconform is not installed; Kustomize rendering passed, and cluster dry-run remains available through k8s-validate"
fi

log "Static Kubernetes validation passed"

