#!/usr/bin/env bash

set -Eeuo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

parse_profile "$@"
require_commands docker minikube kubectl
assert_profile_context

log "Pointing Docker at Minikube profile '$PROFILE'"
eval "$(minikube --profile "$PROFILE" docker-env --shell bash)"
docker info >/dev/null

build_image() {
  local image="$1"
  local dockerfile="$2"
  shift 2
  log "Building $image"
  docker build --file "$PROJECT_ROOT/$dockerfile" --tag "$image" "$@" "$PROJECT_ROOT"
}

build_image fiap-x/auth-service:local infra/docker/auth-service/Dockerfile
build_image fiap-x/video-service:local infra/docker/video-service/Dockerfile
build_image fiap-x/processor-service:local infra/docker/processor-service/Dockerfile
build_image fiap-x/notification-service:local infra/docker/notification-service/Dockerfile
build_image fiap-x/frontend:local infra/docker/frontend/Dockerfile \
  --build-arg VITE_AUTH_API_BASE_URL="${FIAP_X_AUTH_PUBLIC_URL:-http://fiap-x.local}" \
  --build-arg VITE_VIDEO_API_BASE_URL="${FIAP_X_VIDEO_PUBLIC_URL:-http://fiap-x.local}" \
  --build-arg VITE_NOTIFICATION_API_BASE_URL="${FIAP_X_NOTIFICATION_PUBLIC_URL:-http://fiap-x.local}"

for image in \
  fiap-x/auth-service:local \
  fiap-x/video-service:local \
  fiap-x/processor-service:local \
  fiap-x/notification-service:local \
  fiap-x/frontend:local; do
  docker image inspect "$image" >/dev/null
done

log "Five application images are available inside Minikube"
