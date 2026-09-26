#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
NAMESPACE="fiap-x"
PROFILE=""

log() {
  printf '[fiap-x] %s\n' "$*"
}

die() {
  printf '[fiap-x] ERROR: %s\n' "$*" >&2
  exit 1
}

parse_profile() {
  while (($# > 0)); do
    case "$1" in
      --profile|-p)
        (($# >= 2)) || die "--profile requires a value"
        PROFILE="$2"
        shift 2
        ;;
      *)
        die "unknown argument: $1"
        ;;
    esac
  done

  [[ -n "$PROFILE" ]] || die "an explicit Minikube profile is required: --profile <name>"
  [[ "$PROFILE" =~ ^[a-zA-Z0-9][a-zA-Z0-9._-]*$ ]] || die "invalid Minikube profile name"
}

require_commands() {
  local command_name
  for command_name in "$@"; do
    command -v "$command_name" >/dev/null 2>&1 || die "required command not found: $command_name"
  done
}

profile_status() {
  minikube --profile "$PROFILE" status --format='{{.Host}}' 2>/dev/null || true
}

require_running_profile() {
  [[ "$(profile_status)" == "Running" ]] || die "Minikube profile '$PROFILE' is not running"
}

select_profile_context() {
  require_running_profile
  minikube --profile "$PROFILE" update-context >/dev/null
  kubectl config use-context "$PROFILE" >/dev/null
}

assert_profile_context() {
  local current_context
  require_running_profile
  current_context="$(kubectl config current-context 2>/dev/null || true)"
  [[ "$current_context" == "$PROFILE" ]] || die \
    "refusing cluster operation: current context '$current_context' does not match explicit Minikube profile '$PROFILE'"
}

kube() {
  kubectl --context "$PROFILE" "$@"
}

print_access() {
  local cluster_ip
  cluster_ip="$(minikube --profile "$PROFILE" ip)"

  printf '\nFIAP X is available through the Minikube ingress.\n'
  printf 'Add this local hosts entry if it is not already present:\n\n'
  printf '  %s fiap-x.local auth.fiap-x.local video.fiap-x.local notification.fiap-x.local\n\n' "$cluster_ip"
  printf 'If the Docker driver cannot route that IP from the host (common on macOS), run:\n\n'
  printf '  minikube tunnel --profile %s\n\n' "$PROFILE"
  printf 'Keep the tunnel open and use 127.0.0.1 instead of %s in the hosts entry.\n\n' "$cluster_ip"
  printf 'Frontend:      http://fiap-x.local\n'
  printf 'Auth API:      http://auth.fiap-x.local/auth\n'
  printf 'Video API:     http://video.fiap-x.local/videos\n'
  printf 'Notification:  http://notification.fiap-x.local/notifications\n'
  printf 'Grafana:       kubectl --context %s -n %s port-forward service/grafana 3000:3000\n' "$PROFILE" "$NAMESPACE"
  printf 'Prometheus:    kubectl --context %s -n %s port-forward service/prometheus 9090:9090\n' "$PROFILE" "$NAMESPACE"
}
