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

# Fewer files = a faster Windows install and uninstall. First bundle dist/
# into one file and keep only the packages that can't be bundled (roadmap
# 1.7.23), then strip build-time leftovers from those (roadmap 1.7.22).
node "$SCRIPT_DIR/bundle-backend.mjs" "$STAGING_DIR"
node "$SCRIPT_DIR/prune-node-modules.mjs" "$STAGING_DIR/node_modules"

# DuckDB's excel extension ships with the app (ADR-0052): the installer is a
# Windows build, and the host platform too when staging elsewhere.
PLATFORMS="windows_amd64"
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) PLATFORMS="$PLATFORMS osx_arm64" ;;
  Darwin-x86_64) PLATFORMS="$PLATFORMS osx_amd64" ;;
  Linux-x86_64) PLATFORMS="$PLATFORMS linux_amd64" ;;
esac
node "$SCRIPT_DIR/../../scripts/fetch-duckdb-extensions.mjs" $PLATFORMS --out "$STAGING_DIR/vendor/duckdb-extensions"

echo "Backend staged at $STAGING_DIR"
