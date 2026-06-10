#!/bin/bash
set -e

cd "$(dirname "$0")/../../.."

echo "Building E2E Docker images locally..."
echo ""

echo "→ Pruning workspaces..."
rm -rf .prune-identity .prune-api-docs .prune-e2e
pnpm exec turbo prune --docker identity-backend-container --out-dir=.prune-identity

# Mirror the gitignored file-protocol dep patch from .github/actions/turbo-prune/action.yml
if [ -f ".prune-identity/json/packages/descriptors/package.json" ]; then
  mkdir -p .prune-identity/json/packages/descriptors/.papi/descriptors
  cp packages/descriptors/.papi/descriptors/package.json \
     .prune-identity/json/packages/descriptors/.papi/descriptors/package.json
fi

pnpm exec turbo prune --docker "@polkadot-app/api-docs" --out-dir=.prune-api-docs

pnpm exec turbo prune --docker identity-backend-e2e-people-startup-container --out-dir=.prune-e2e
if [ -f ".prune-e2e/json/packages/descriptors/package.json" ]; then
  mkdir -p .prune-e2e/json/packages/descriptors/.papi/descriptors
  cp packages/descriptors/.papi/descriptors/package.json \
     .prune-e2e/json/packages/descriptors/.papi/descriptors/package.json
fi

echo "→ Building revive-storage-plugin..."
pnpm --filter @identity-backend/revive-storage-plugin build

echo "→ Building images with docker buildx bake..."
mkdir -p .turbo

PNPM_STORE="$(pnpm store path)"

PNPM_STORE_PATH="$PNPM_STORE" \
TURBO_CACHE_PATH="$(pwd)/.turbo" \
CACHE_EXPORT=false \
docker buildx bake --allow="fs.read=$PNPM_STORE" -f docker-bake.hcl --load e2e

echo ""
echo "✓ E2E images built successfully"
echo "  - ${TAG_APP_IDENTITY:-identity-backend:e2e-latest}"
echo "  - ${TAG_APP_E2E:-identity-backend-startup:e2e-latest}"
echo "  - ${TAG_CHOPSTICKS:-chopsticks:e2e-latest}"
echo ""
echo "You can now run: pnpm test:e2e"
