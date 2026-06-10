#!/usr/bin/env bash
set -euo pipefail

archive="${1:-}"
if [ -z "$archive" ] || [ ! -f "$archive" ]; then
  echo "usage: $0 <path-to-e2e-telemetry-<shard>.tar.gz>" >&2
  exit 1
fi

archive_abs="$(cd "$(dirname "$archive")" && pwd)/$(basename "$archive")"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

tar xzf "$archive_abs" -C "$tmpdir"

echo "extracted traces:"
ls -la "$tmpdir"

docker network create otel-replay 2>/dev/null || true

if ! docker ps --format '{{.Names}}' | grep -qx otel-replay-jaeger; then
  docker run -d --rm --name otel-replay-jaeger --network otel-replay \
    -p 16686:16686 \
    -p 4327:4317 \
    -e COLLECTOR_OTLP_ENABLED=true \
    jaegertracing/all-in-one:1.62
  echo "waiting 3s for jaeger to start..."
  sleep 3
fi

docker run --rm --network otel-replay \
  -v "$tmpdir":/traces:ro \
  -v "$repo_root/scripts/otel-replay-collector.yml":/etc/otelcol/config.yaml:ro \
  otel/opentelemetry-collector-contrib:0.150.1 \
  --config=/etc/otelcol/config.yaml

echo ""
echo "traces loaded into jaeger"
echo "  ui: http://localhost:16686"
echo "  services to look for: identity-backend-web, identity-backend-e2e-test"
echo ""
echo "stop jaeger with: docker stop otel-replay-jaeger && docker network rm otel-replay"
