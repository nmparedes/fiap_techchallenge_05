#!/usr/bin/env bash

set -Eeuo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

parse_profile "$@"
require_commands docker minikube kubectl openssl curl

docker info >/dev/null 2>&1 || die "Docker daemon is not running"

log "Docker: $(docker version --format '{{.Client.Version}}')"
log "Minikube: $(minikube version --short)"
log "kubectl: $(kubectl version --client=true --output=yaml | sed -n 's/^  gitVersion: //p')"
log "Explicit profile: $PROFILE"
log "Prerequisites are available"
