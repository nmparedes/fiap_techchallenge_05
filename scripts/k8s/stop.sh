#!/usr/bin/env bash

set -Eeuo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

parse_profile "$@"
require_commands kubectl minikube
assert_profile_context

if kube get namespace "$NAMESPACE" >/dev/null 2>&1; then
  log "Removing only namespace '$NAMESPACE' from Minikube profile '$PROFILE'"
  kube delete namespace "$NAMESPACE" --wait=true --timeout=180s
else
  log "Namespace '$NAMESPACE' is already absent"
fi

log "Minikube profile '$PROFILE' was not stopped or deleted"

