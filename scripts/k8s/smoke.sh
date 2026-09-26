#!/usr/bin/env bash

set -Eeuo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

parse_profile "$@"
require_commands kubectl minikube curl jq
assert_profile_context

kube --namespace "$NAMESPACE" get deployment auth-service video-service processor-service notification-service frontend >/dev/null

temporary_directory="$(mktemp -d "${TMPDIR:-/tmp}/fiap-x-smoke.XXXXXX")"
port_forward_pids=()

cleanup() {
  local process_id
  for process_id in "${port_forward_pids[@]}"; do
    kill "$process_id" >/dev/null 2>&1 || true
    wait "$process_id" >/dev/null 2>&1 || true
  done
}
trap cleanup EXIT

start_port_forward() {
  local service="$1"
  local local_port="$2"
  local service_port="$3"
  kube --namespace "$NAMESPACE" port-forward "service/$service" "$local_port:$service_port" \
    >"$temporary_directory/$service.port-forward.log" 2>&1 &
  port_forward_pids+=("$!")
}

wait_for_health() {
  local name="$1"
  local url="$2"
  local attempt
  for attempt in {1..30}; do
    if curl --fail --silent --show-error "$url" >/dev/null 2>&1; then
      log "$name health passed"
      return 0
    fi
    sleep 1
  done
  die "$name did not become reachable at $url"
}

start_port_forward auth-service 13001 3001
start_port_forward video-service 13002 3002
start_port_forward processor-service 13003 3003
start_port_forward notification-service 13004 3004
start_port_forward frontend 18080 8080

wait_for_health auth-service http://127.0.0.1:13001/health/live
wait_for_health auth-service-readiness http://127.0.0.1:13001/health/ready
wait_for_health video-service http://127.0.0.1:13002/health/live
wait_for_health video-service-readiness http://127.0.0.1:13002/health/ready
wait_for_health processor-service http://127.0.0.1:13003/health/live
wait_for_health processor-service-readiness http://127.0.0.1:13003/health/ready
wait_for_health notification-service http://127.0.0.1:13004/health/live
wait_for_health notification-service-readiness http://127.0.0.1:13004/health/ready
wait_for_health frontend http://127.0.0.1:18080/health

log "Logging in as the seeded John Doe user"
login_response="$(curl --fail --silent --show-error \
  --request POST \
  --header 'content-type: application/json' \
  --data '{"username":"john.doe","password":"JohnDoe123!"}' \
  http://127.0.0.1:13001/auth/login)"
access_token="$(jq --raw-output --exit-status \
  '.data.accessToken // .data.token // .accessToken // .token' <<<"$login_response")"
[[ -n "$access_token" && "$access_token" != "null" ]] || die "login response did not contain an access token"
log "Login passed"

sample_video="$temporary_directory/smoke.mp4"
processor_pod="$(kube --namespace "$NAMESPACE" get pod \
  --selector app.kubernetes.io/name=processor-service \
  --output jsonpath='{.items[0].metadata.name}')"
remote_sample="/tmp/fiap-x-smoke-$$.mp4"
log "Generating the sample video with FFmpeg from the Processor image"
kube --namespace "$NAMESPACE" exec "$processor_pod" -- \
  ffmpeg -hide_banner -loglevel error \
    -f lavfi -i 'color=c=blue:s=160x120:d=1' \
    -c:v mpeg4 -pix_fmt yuv420p -r 10 -y "$remote_sample"
kube --namespace "$NAMESPACE" cp "$processor_pod:$remote_sample" "$sample_video"
kube --namespace "$NAMESPACE" exec "$processor_pod" -- rm -f "$remote_sample"
[[ -s "$sample_video" ]] || die "Processor did not produce a sample video"

log "Uploading a one-second video"
upload_response="$(curl --fail --silent --show-error \
  --request POST \
  --header "authorization: Bearer $access_token" \
  --form "video=@$sample_video;type=video/mp4" \
  --form 'fps=1' \
  http://127.0.0.1:13002/videos)"
video_id="$(jq --raw-output --exit-status '.data.id // .data.video.id // .id' <<<"$upload_response")"
[[ -n "$video_id" && "$video_id" != "null" ]] || die "upload response did not contain a video id"
log "Upload accepted as $video_id"

final_status=""
status_response=""
smoke_attempts="${FIAP_X_SMOKE_ATTEMPTS:-60}"
[[ "$smoke_attempts" =~ ^[1-9][0-9]*$ ]] || die "FIAP_X_SMOKE_ATTEMPTS must be a positive integer"
for ((attempt = 1; attempt <= smoke_attempts; attempt += 1)); do
  status_response="$(curl --fail --silent --show-error \
    --header "authorization: Bearer $access_token" \
    "http://127.0.0.1:13002/videos/$video_id")"
  final_status="$(jq --raw-output '.data.status // .data.video.status // .status // empty' <<<"$status_response")"
  log "Video status: ${final_status:-unknown}"
  if [[ "$final_status" == "COMPLETED" || "$final_status" == "FAILED" ]]; then
    break
  fi
  sleep 3
done

notification_file="$temporary_directory/notifications.json"
notification_http_status="$(curl --silent --show-error \
  --header "authorization: Bearer $access_token" \
  --output "$notification_file" \
  --write-out '%{http_code}' \
  http://127.0.0.1:13004/notifications)"
notification_response="$(<"$notification_file")"
if [[ "$notification_http_status" =~ ^2[0-9][0-9]$ ]]; then
  log "Notification query passed"
else
  log "Notification query returned HTTP $notification_http_status"
fi

if [[ "$final_status" != "COMPLETED" && "$final_status" != "FAILED" ]]; then
  printf 'Last video response:\n%s\n' "$(jq . <<<"$status_response")"
  printf 'Notifications (HTTP %s):\n%s\n' \
    "$notification_http_status" "$(jq . <<<"$notification_response" 2>/dev/null || printf '%s' "$notification_response")"
  die "video did not reach a final state; last response and notifications were displayed"
fi

if [[ "$final_status" == "COMPLETED" ]]; then
  archive="$temporary_directory/$video_id.zip"
  curl --fail --silent --show-error \
    --header "authorization: Bearer $access_token" \
    --output "$archive" \
    "http://127.0.0.1:13002/videos/$video_id/download"
  [[ -s "$archive" ]] || die "downloaded archive is empty"
  log "Download passed ($(wc -c < "$archive" | tr -d ' ') bytes)"
  [[ "$notification_http_status" =~ ^2[0-9][0-9]$ ]] || \
    die "video completed, but notification query returned HTTP $notification_http_status"
  log "Smoke test passed"
else
  printf 'Video failure response:\n%s\n' "$(jq . <<<"$status_response")"
  printf 'Notifications (HTTP %s):\n%s\n' \
    "$notification_http_status" "$(jq . <<<"$notification_response" 2>/dev/null || printf '%s' "$notification_response")"
  die "video reached FAILED; failure and notifications were displayed without modifying application code"
fi
