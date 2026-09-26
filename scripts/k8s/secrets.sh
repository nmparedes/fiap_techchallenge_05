#!/usr/bin/env bash

set -Eeuo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

parse_profile "$@"
require_commands kubectl minikube openssl
assert_profile_context

kube apply --filename "$PROJECT_ROOT/infra/k8s/dependencies/namespace.yaml" >/dev/null

secret_exists() {
  kube --namespace "$NAMESPACE" get secret "$1" >/dev/null 2>&1
}

create_dependency_secret() {
  local mysql_root_password mysql_password redis_password rabbitmq_password grafana_password
  mysql_root_password="${FIAP_X_MYSQL_ROOT_PASSWORD:-$(openssl rand -hex 24)}"
  mysql_password="${FIAP_X_MYSQL_PASSWORD:-$(openssl rand -hex 24)}"
  redis_password="${FIAP_X_REDIS_PASSWORD:-$(openssl rand -hex 24)}"
  rabbitmq_password="${FIAP_X_RABBITMQ_PASSWORD:-$(openssl rand -hex 24)}"
  grafana_password="${FIAP_X_GRAFANA_PASSWORD:-$(openssl rand -hex 24)}"

  kube --namespace "$NAMESPACE" create secret generic fiap-x-dependencies \
    --from-literal=MYSQL_ROOT_PASSWORD="$mysql_root_password" \
    --from-literal=MYSQL_USERNAME="${FIAP_X_MYSQL_USERNAME:-fiap_x}" \
    --from-literal=MYSQL_PASSWORD="$mysql_password" \
    --from-literal=REDIS_PASSWORD="$redis_password" \
    --from-literal=REDIS_URL="redis://:$redis_password@redis:6379" \
    --from-literal=RABBITMQ_USERNAME="${FIAP_X_RABBITMQ_USERNAME:-fiap_x}" \
    --from-literal=RABBITMQ_PASSWORD="$rabbitmq_password" \
    --from-literal=RABBITMQ_URL="amqp://${FIAP_X_RABBITMQ_USERNAME:-fiap_x}:$rabbitmq_password@rabbitmq:5672" \
    --from-literal=GRAFANA_ADMIN_USER="${FIAP_X_GRAFANA_ADMIN_USER:-admin}" \
    --from-literal=GRAFANA_ADMIN_PASSWORD="$grafana_password" \
    --dry-run=client --output=yaml | kube apply --filename=- >/dev/null
}

create_application_secret() {
  local jwt_secret
  jwt_secret="${FIAP_X_AUTH_JWT_SECRET:-$(openssl rand -hex 32)}"
  ((${#jwt_secret} >= 32)) || die "FIAP_X_AUTH_JWT_SECRET must contain at least 32 characters"

  kube --namespace "$NAMESPACE" create secret generic fiap-x-application \
    --from-literal=AUTH_JWT_SECRET="$jwt_secret" \
    --dry-run=client --output=yaml | kube apply --filename=- >/dev/null
}

if [[ "${FIAP_X_ROTATE_SECRETS:-false}" == "true" ]] || ! secret_exists fiap-x-dependencies; then
  create_dependency_secret
  log "Dependency Secret created or updated"
else
  log "Dependency Secret already exists; preserving current values"
fi

if [[ "${FIAP_X_ROTATE_SECRETS:-false}" == "true" ]] || ! secret_exists fiap-x-application; then
  create_application_secret
  log "Application Secret created or updated"
else
  log "Application Secret already exists; preserving current values"
fi

