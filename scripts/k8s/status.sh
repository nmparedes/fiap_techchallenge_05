#!/usr/bin/env bash

set -Eeuo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

parse_profile "$@"
require_commands kubectl minikube
assert_profile_context

if ! kube get namespace "$NAMESPACE" >/dev/null 2>&1; then
  log "FIAP X is not installed in profile '$PROFILE'"
  exit 0
fi

kube --namespace "$NAMESPACE" get deployments,statefulsets,pods,services,ingress,horizontalpodautoscalers,jobs,persistentvolumeclaims
print_access

