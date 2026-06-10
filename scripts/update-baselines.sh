#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<EOF
Usage: $0 <test-name> <results-json> [--yes]

  test-name     Name of the baseline file under apps/identity-backend-load-testing/baselines/
  results-json  Path to the k6 summary JSON to copy in
  --yes         Required: confirm the commit. Without this flag the script
                prints the diff but does not stage or commit.

Updating baselines tightens or loosens the regression gate, so the commit
must be intentional. Run this from the branch you want the commit on.
EOF
  exit 1
}

if [ $# -lt 2 ]; then
  usage
fi

TEST_NAME="$1"
RESULTS_JSON="$2"
CONFIRM="${3:-}"
REPO_ROOT="$(git rev-parse --show-toplevel)"
BASELINES_DIR="$REPO_ROOT/apps/identity-backend-load-testing/baselines"
TARGET="$BASELINES_DIR/$TEST_NAME.json"

if [ ! -f "$RESULTS_JSON" ]; then
  echo "Error: results file not found: $RESULTS_JSON" >&2
  exit 1
fi

mkdir -p "$BASELINES_DIR"

if [ -f "$TARGET" ]; then
  echo "=== Existing baseline ==="
  cat "$TARGET"
  echo
fi
echo "=== New baseline (from $RESULTS_JSON) ==="
cat "$RESULTS_JSON"
echo

if [ "$CONFIRM" != "--yes" ]; then
  echo "Refusing to write without --yes. Re-run with --yes to commit." >&2
  exit 2
fi

cp "$RESULTS_JSON" "$TARGET"

# baselines/ is gitignored — force-add so the commit actually contains the file.
git -C "$REPO_ROOT" add --force "$TARGET"

git -C "$REPO_ROOT" commit -m "chore: update k6 baseline for $TEST_NAME"

echo "Baseline updated: $TARGET"
