#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

E2E_LOCAL_ID="$(printf '%s' "$REPO_ROOT" | sha256sum | cut -c1-8)"
HASH_DEC="$((16#${E2E_LOCAL_ID}))"

export E2E_LOCAL_ID
export TAG_APP_IDENTITY="identity-backend:e2e-${E2E_LOCAL_ID}"
export TAG_APP_E2E="identity-backend-startup:e2e-${E2E_LOCAL_ID}"
export TAG_CHOPSTICKS="chopsticks:e2e-${E2E_LOCAL_ID}"
export E2E_TEST_NETWORK="test-network-${E2E_LOCAL_ID}"
export E2E_OTEL_CONTAINER="e2e-otel-collector-${E2E_LOCAL_ID}"
export E2E_OTEL_VOLUME="e2e-traces-${E2E_LOCAL_ID}"
export E2E_INTEGRATION_PROJECT="integration-${E2E_LOCAL_ID}"
export E2E_INTEGRESQL_HOST_PORT="$((50000 + HASH_DEC % 10000))"
export E2E_POSTGRES_HOST_PORT="$((52000 + HASH_DEC % 10000))"
export OTEL_COLLECTOR_HOST_PORT="$((43000 + HASH_DEC % 1000))"

if [ "${OTEL_ENABLED:-}" = 'true' ]; then
  export OTEL_EXPORTER_OTLP_ENDPOINT="http://127.0.0.1:${OTEL_COLLECTOR_HOST_PORT}"
fi

echo "e2e-local: worktree=$REPO_ROOT id=$E2E_LOCAL_ID"
echo "e2e-local: tags=$TAG_APP_IDENTITY, $TAG_APP_E2E, $TAG_CHOPSTICKS"
echo "e2e-local: network=$E2E_TEST_NETWORK"
echo "e2e-local: ports integresql=$E2E_INTEGRESQL_HOST_PORT postgres=$E2E_POSTGRES_HOST_PORT otel=$OTEL_COLLECTOR_HOST_PORT"

skip_build=false
vitest_args=()
for arg in "$@"; do
  case "$arg" in
    --skip-build) skip_build=true ;;
    *) vitest_args+=("$arg") ;;
  esac
done

if [ "$skip_build" = false ]; then
  echo "e2e-local: building images (use --skip-build to skip)…"
  pnpm exec turbo build --filter=identity-backend-e2e...
  bash "$REPO_ROOT/docker/test/e2e/build-local.sh"
fi

exec pnpm --filter identity-backend-e2e exec vitest run "${vitest_args[@]}"
