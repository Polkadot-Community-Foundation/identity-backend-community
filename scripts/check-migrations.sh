#!/usr/bin/env bash
# check-migrations.sh - Verify that database migrations are in sync with schema
# Run db:generate and check for uncommitted changes

set -e

echo "Generating database migrations..."

# Run drizzle-kit generate to update migrations
pnpm -w run db:generate

# Check for uncommitted changes after generation
if ! git --no-pager diff --ignore-space-at-eol --ignore-blank-lines --exit-code; then
  echo ""
  echo "❌ ERROR: Changes detected after running drizzle-kit generate"
  echo ""
  echo "Your database schema has changed but the migrations haven't been updated."
  echo ""
  echo "To fix:"
  echo "  1. Run: pnpm -w run db:generate"
  echo "  2. Review and commit the generated migrations"
  echo ""
  echo "Diff of uncommitted changes:"
  echo "---"
  git --no-pager diff --ignore-space-at-eol --ignore-blank-lines
  echo "---"
  echo ""
  exit 1
fi

echo "✓ Migrations are in sync with schema"
exit 0
