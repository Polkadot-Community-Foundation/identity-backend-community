#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

INTEGRATION_COMPOSE="docker/test/integration/docker-compose.yml"
E2E_COMPOSE="docker/test/e2e/docker-compose.yml"
ENV_FILE="docker/test/e2e/.env"
LOAD_TEST_PKG="@identity-backend/load-testing"

SCENARIO="smoke"
TEAR_DOWN=false
SKIP_BUILD_IMAGES=false
SKIP_BUILD_K6=false
SKIP_SEED=false
REGENERATE_ENV=false
TARGET_URL=""

usage() {
  cat <<EOF
Usage: $0 [scenario] [flags]

Scenarios (one of):
  smoke            ~30s sanity check (default)
  search           bucketed search load (~2m)
  health           healthcheck constant 50 RPS
  auth-challenges  POST /auth/challenges
  subscriptions    create + list, authenticated
  stress           ramp to PEAK_RPS (default 2000), 2m soak, aborts at SLO breach
  spike            sudden jump to SPIKE_RPS (default 1500), recovery observed
  concurrent       ramping VUs to VUS (default 2000), 2m soak
  all              smoke + search + health (sequence)

Flags:
  --down               docker compose down after the run
  --skip-build-images  Don't rebuild the e2e docker images
  --skip-build-k6      Don't rebuild k6 .mjs scripts
  --skip-seed          Don't re-seed (faster repeat runs)
  --regenerate-env     Force-rewrite docker/test/e2e/.env
  --target-url <url>   Target an existing deployment instead of spinning up Docker
  -h, --help           Show this message

Env knobs read by scenarios:
  SEED_COUNT=<N>       Seed N rows (default 10000, max 100000)
  JWT_SECRET=<v>       Override JWT for subscriptions (defaults to JWT_AUTH_SECRET)
  PEAK_RPS=<N>         For stress scenario (default 2000)
  SPIKE_RPS=<N>        For spike scenario (default 1500)
  VUS=<N>              For concurrent scenario (default 2000)
  SOAK_DURATION=<d>    For stress / concurrent scenarios (default 2m)
  POC=on|off           Exercise the proof-of-compute gate on search (default off;
                       requires POC_ENABLED=true on the target)
  LOADTEST_RUN_ID=<s>  Tags every request's User-Agent so traces are filterable
                       (default local-<timestamp>)
EOF
  exit "${1:-1}"
}

while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help) usage 0 ;;
    --down) TEAR_DOWN=true ;;
    --skip-build-images) SKIP_BUILD_IMAGES=true ;;
    --skip-build-k6) SKIP_BUILD_K6=true ;;
    --skip-seed) SKIP_SEED=true ;;
    --regenerate-env) REGENERATE_ENV=true ;;
    --target-url)
      [ $# -ge 2 ] || { echo "--target-url requires a URL argument" >&2; usage; }
      TARGET_URL="$2"
      shift
      ;;
    -*) echo "Unknown flag: $1" >&2; usage ;;
    *) SCENARIO="$1" ;;
  esac
  shift
done

SEED_COUNT="${SEED_COUNT:-10000}"
LOADTEST_RUN_ID="${LOADTEST_RUN_ID:-local-$(date +%Y%m%d-%H%M%S)}"

log() { printf '\033[1;36m▶ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*" >&2; }
die() { printf '\033[1;31m✘ %s\033[0m\n' "$*" >&2; exit 1; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Missing required command: $1${2:+ — $2}"
}

compose_int() { docker compose -f "$INTEGRATION_COMPOSE" "$@"; }
compose_e2e() { docker compose -f "$E2E_COMPOSE" "$@"; }

resolve_host_port() {
  local file="$1" svc="$2" container_port="$3"
  local endpoint
  endpoint="$(docker compose -f "$file" port "$svc" "$container_port" 2>/dev/null || true)"
  [ -n "$endpoint" ] || return 1
  echo "${endpoint##*:}"
}

log "Checking prerequisites"
require_cmd pnpm
if ! command -v k6 >/dev/null 2>&1; then
  cat <<'EOF' >&2

k6 is not installed. Install it then re-run:

  K6_VERSION=v1.3.0
  curl -fsSL "https://github.com/grafana/k6/releases/download/${K6_VERSION}/k6-${K6_VERSION}-linux-amd64.tar.gz" \
    | sudo tar xz --strip-components=1 -C /usr/local/bin "k6-${K6_VERSION}-linux-amd64/k6"

EOF
  die "k6 not in PATH"
fi

if [ -n "$TARGET_URL" ]; then
  BASE_URL="${TARGET_URL%/}"
  log "Targeting live URL: ${BASE_URL}"
  log "Skipping Docker infrastructure (--target-url)"
else
  require_cmd docker

  NEED_IMAGES=()
  for img in identity-backend:e2e-latest identity-backend-startup:e2e-latest chopsticks:e2e-latest; do
    docker image inspect "$img" >/dev/null 2>&1 || NEED_IMAGES+=("$img")
  done

  if [ "${#NEED_IMAGES[@]}" -gt 0 ] && [ "$SKIP_BUILD_IMAGES" = false ]; then
    log "Building e2e docker images (missing: ${NEED_IMAGES[*]})"
    bash docker/test/e2e/build-local.sh
  elif [ "${#NEED_IMAGES[@]}" -gt 0 ]; then
    die "Missing images: ${NEED_IMAGES[*]} — drop --skip-build-images or run docker/test/e2e/build-local.sh"
  else
    log "All e2e images already present"
  fi

  log "Starting integration compose (postgres + chopsticks)"
  E2E_POSTGRES_HOST_PORT="${E2E_POSTGRES_HOST_PORT:-0}" \
    compose_int up -d --wait --wait-timeout 120

  PG_PORT="$(resolve_host_port "$INTEGRATION_COMPOSE" postgres 5432 || true)"
  [ -n "$PG_PORT" ] || die "Could not resolve postgres host port"
  HOST_DATABASE_URL="postgres://postgres:password@localhost:${PG_PORT}/identity_backend"
  log "Postgres mapped to localhost:${PG_PORT}"

  log "Creating identity_backend DB if needed"
  compose_int exec -T postgres createdb -U postgres identity_backend 2>/dev/null || true

  log "Running drizzle migrations"
  DATABASE_URL="$HOST_DATABASE_URL" pnpm --filter identity-backend-container run db:migrate

  if [ "$REGENERATE_ENV" = true ] || [ ! -f "$ENV_FILE" ]; then
    log "Writing ${ENV_FILE}"
    bash "$SCRIPT_DIR/write-load-test-env.sh"
  else
    log "Reusing existing ${ENV_FILE} (use --regenerate-env to refresh)"
  fi

  log "Starting e2e compose (web + chopsticks)"
  compose_e2e up -d --wait --wait-timeout 240

  WEB_PORT="$(resolve_host_port "$E2E_COMPOSE" web 8080 || true)"
  [ -n "$WEB_PORT" ] || die "Could not resolve web host port"
  BASE_URL="http://localhost:${WEB_PORT}"

  log "Confirming web is healthy at ${BASE_URL}"
  curl -fsS "${BASE_URL}/healthcheck" >/dev/null || die "/healthcheck did not respond — check 'compose_e2e logs web --tail 50'"

  if [ "$SKIP_SEED" = false ]; then
    log "Seeding ${SEED_COUNT} rows"
    DATABASE_URL="$HOST_DATABASE_URL" \
      pnpm --filter @identity-backend/load-testing loadgen:seed-usernames -- "$SEED_COUNT"
  else
    log "Skipping seed (--skip-seed)"
  fi
fi

if [ -n "$TARGET_URL" ]; then
  log "Confirming target is reachable at ${BASE_URL}"
  health_ok=false
  for attempt in 1 2 3; do
    if curl -fsS --connect-timeout 10 --max-time 15 "${BASE_URL}/healthcheck" >/dev/null 2>&1; then
      log "healthcheck passed (attempt ${attempt})"
      health_ok=true
      break
    fi
    warn "healthcheck attempt ${attempt}/3 failed — retrying in 2s"
    [ "$attempt" -lt 3 ] && sleep 2
  done
  if [ "$health_ok" = false ]; then
    warn "healthcheck failed after 3 attempts at ${BASE_URL} — proceeding (target may not expose /healthcheck)"
  fi
fi

if [ "$SKIP_BUILD_K6" = false ]; then
  log "Building k6 .mjs scripts"
  pnpm --filter "$LOAD_TEST_PKG" build
else
  log "Skipping k6 build (--skip-build-k6)"
fi

REGISTER_PAYLOADS_PATH="$REPO_ROOT/apps/identity-backend-load-testing/register-payloads.json"
JWT_TOKENS_PATH="$REPO_ROOT/apps/identity-backend-load-testing/jwt-tokens.json"
LOCAL_ATTESTER_PUBLIC_KEY="0xd43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d"

prepare_register_payloads() {
  log "Generating signed register payloads (count=${REGISTER_COUNT:-1000})"
  ATTESTER_PUBLIC_KEY="${ATTESTER_PUBLIC_KEY:-$LOCAL_ATTESTER_PUBLIC_KEY}" \
    REGISTER_PAYLOADS="$REGISTER_PAYLOADS_PATH" \
    pnpm --filter @identity-backend/load-testing loadgen:register-payloads -- "${REGISTER_COUNT:-1000}"
}

prepare_jwt_tokens() {
  log "Acquiring JWT tokens via the auth challenge flow (limit=${JWT_TOKEN_LIMIT:-50})"
  BASE_URL="$BASE_URL" \
    REGISTER_PAYLOADS="$REGISTER_PAYLOADS_PATH" \
    JWT_TOKENS="$JWT_TOKENS_PATH" \
    JWT_TOKEN_LIMIT="${JWT_TOKEN_LIMIT:-50}" \
    pnpm --filter @identity-backend/load-testing loadgen:jwt-tokens -- "$BASE_URL"
}

run_scenario() {
  local name="$1"
  log "Running scenario: ${name} (run_id=${LOADTEST_RUN_ID})"
  case "$name" in
    smoke|search|health|auth-challenges|subscriptions|stress|spike|concurrent)
      BASE_URL="$BASE_URL" \
        JWT_SECRET="${JWT_SECRET:-my-very-strong-random-jwt-secret}" \
        LOADTEST_RUN_ID="$LOADTEST_RUN_ID" \
        POC="${POC:-off}" \
        pnpm --filter "$LOAD_TEST_PKG" "test:load:${name}"
      ;;
    register)
      prepare_register_payloads
      BASE_URL="$BASE_URL" REGISTER_PAYLOADS="$REGISTER_PAYLOADS_PATH" \
        LOADTEST_RUN_ID="$LOADTEST_RUN_ID" VUS="${VUS:-50}" SLA_MS="${SLA_MS:-100000}" \
        pnpm --filter "$LOAD_TEST_PKG" test:load:register
      ;;
    storm)
      prepare_register_payloads
      prepare_jwt_tokens
      BASE_URL="$BASE_URL" REGISTER_PAYLOADS="$REGISTER_PAYLOADS_PATH" JWT_TOKENS="$JWT_TOKENS_PATH" \
        LOADTEST_RUN_ID="$LOADTEST_RUN_ID" VUS="${VUS:-50}" TICKET_RPS="${TICKET_RPS:-100}" SLA_MS="${SLA_MS:-100000}" \
        pnpm --filter "$LOAD_TEST_PKG" test:load:storm
      ;;
    *)
      die "Unknown scenario: ${name}"
      ;;
  esac
}

case "$SCENARIO" in
  all)
    run_scenario smoke
    run_scenario search
    run_scenario health
    ;;
  *)
    run_scenario "$SCENARIO"
    ;;
esac

if [ "$TEAR_DOWN" = true ] && [ -z "$TARGET_URL" ]; then
  log "Tearing down compose stacks (--down)"
  compose_e2e down --remove-orphans
  compose_int down --remove-orphans
fi

log "Done."
