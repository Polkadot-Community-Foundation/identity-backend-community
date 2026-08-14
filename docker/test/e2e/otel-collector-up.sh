#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTAINER="${E2E_OTEL_CONTAINER:-e2e-otel-collector}"
VOLUME="${E2E_OTEL_VOLUME:-e2e-traces}"
NETWORK="${E2E_TEST_NETWORK:-test-network}"
CONFIG="$SCRIPT_DIR/otelcol-config.yml"
IMAGE="otel/opentelemetry-collector-contrib:0.150.1"
LOCK="${E2E_OTEL_LOCKFILE:-/tmp/${CONTAINER}.lock}"

log() { echo "otel-collector-up: $*" >&2; }

# Vitest's experimental OpenTelemetry integration builds its exporter at startup,
# before globalSetup runs, so the endpoint has to be known up front. When the caller
# pins OTEL_COLLECTOR_HOST_PORT we publish exactly that port; otherwise we fall back
# to an ephemeral one and echo it back for the caller to export.
if [ -n "${OTEL_COLLECTOR_HOST_PORT:-}" ]; then
  PUBLISH="127.0.0.1:${OTEL_COLLECTOR_HOST_PORT}:4318"
else
  PUBLISH="127.0.0.1::4318"
fi

exec 9>"$LOCK"
flock 9
if [ "$(docker inspect --format '{{.State.Status}}' "$CONTAINER" 2>/dev/null || true)" != "running" ]; then
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  docker volume create "$VOLUME" >/dev/null
  docker run --rm -v "$VOLUME":/traces alpine chown 10001:10001 /traces
  docker network inspect "$NETWORK" >/dev/null 2>&1 || docker network create "$NETWORK" >/dev/null
  docker run -d --name "$CONTAINER" \
    --network "$NETWORK" \
    -v "$CONFIG:/etc/otelcol/config.yaml:ro" \
    -v "$VOLUME":/traces \
    -p "$PUBLISH" \
    "$IMAGE" --config=/etc/otelcol/config.yaml >/dev/null
  log "started $CONTAINER"
else
  log "$CONTAINER already running"
fi
flock -u 9

MAPPING="$(docker port "$CONTAINER" 4318/tcp)"
FIRST_BINDING="${MAPPING%%$'\n'*}"
HOST_PORT="${FIRST_BINDING##*:}"
if [ -z "$HOST_PORT" ]; then
  log "could not determine host port from '$MAPPING'"
  exit 1
fi

for _ in $(seq 1 30); do
  if (exec 3<>"/dev/tcp/127.0.0.1/$HOST_PORT") 2>/dev/null; then
    exec 3>&- 3<&-
    echo "http://127.0.0.1:$HOST_PORT"
    exit 0
  fi
  sleep 0.5
done

log "collector did not accept connections on 127.0.0.1:$HOST_PORT within 15s"
docker logs "$CONTAINER" 2>&1 | tail -n 60 >&2 || true
exit 1
