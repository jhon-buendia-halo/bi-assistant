#!/usr/bin/env bash
# Builds the backend and stages it (dist + production node_modules) for packaging.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/../../backend" && pwd)"
STAGING_DIR="$BACKEND_DIR/release-staging"

cd "$BACKEND_DIR"
npm run build

rm -rf "$STAGING_DIR"
mkdir -p "$STAGING_DIR"
cp -R dist "$STAGING_DIR/dist"
cp package.json package-lock.json "$STAGING_DIR/"

cd "$STAGING_DIR"
npm ci --omit=dev --ignore-scripts --legacy-peer-deps --no-audit --no-fund

# Fewer files = a faster Windows install and uninstall (roadmap 1.7.22).
node "$SCRIPT_DIR/prune-node-modules.mjs" "$STAGING_DIR/node_modules"

echo "Backend staged at $STAGING_DIR"
