#!/usr/bin/env bash
# Builds the backend and stages it (dist + production node_modules) for packaging.
set -euo pipefail

BACKEND_DIR="$(cd "$(dirname "$0")/../../backend" && pwd)"
STAGING_DIR="$BACKEND_DIR/release-staging"

cd "$BACKEND_DIR"
npm run build

rm -rf "$STAGING_DIR"
mkdir -p "$STAGING_DIR"
cp -R dist "$STAGING_DIR/dist"
cp package.json package-lock.json "$STAGING_DIR/"

cd "$STAGING_DIR"
npm ci --omit=dev --ignore-scripts --legacy-peer-deps --no-audit --no-fund

echo "Backend staged at $STAGING_DIR"
