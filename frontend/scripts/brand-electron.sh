#!/usr/bin/env bash
# Name the macOS menu bar and Dock for unpackaged runs.
#
# macOS takes the app's displayed name from the running bundle — its directory
# name and Info.plist — and ignores app.setName() and any custom menu template.
# Packaged builds get this from electron-builder's `productName`; `npm run
# electron` and `electron:dev` launch Electron.app straight out of node_modules,
# which is named "Electron". So rename that bundle and point the launcher at it.
#
# The name is the selected brand's OS name (BRAND=halo|mercer, default halo;
# ADR-0045). Switching brands renames whichever bundle an earlier run left.
#
# Idempotent, and a no-op off macOS or when node_modules has not been installed.
set -euo pipefail

FRONTEND="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$FRONTEND/node_modules/electron/dist"

[ "$(uname)" = "Darwin" ] || exit 0
[ -d "$DIST" ] || exit 0

APP_NAME="$(cd "$FRONTEND" && node --input-type=module -e \
  "import { resolveBrand } from './scripts/brand.mjs'; console.log(resolveBrand().config.osName)")"
[ -n "$APP_NAME" ] || { echo "[brand-electron] the brand has no osName" >&2; exit 1; }
BUNDLE="$DIST/$APP_NAME.app"

# `electron/path.txt` is what the launcher resolves, so it has to track the
# rename. CFBundleExecutable stays "Electron" — the binary keeps its own name.
# The bundle to rename is the pristine Electron.app or one an earlier run
# named after another brand: any .app here holding the Electron binary.
if [ ! -d "$BUNDLE" ]; then
  CURRENT=""
  for candidate in "$DIST"/*.app; do
    [ -x "$candidate/Contents/MacOS/Electron" ] && { CURRENT="$candidate"; break; }
  done
  [ -n "$CURRENT" ] || exit 0
  mv "$CURRENT" "$BUNDLE"
fi
printf '%s' "$APP_NAME.app/Contents/MacOS/Electron" > "$DIST/../path.txt"

PLIST="$BUNDLE/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleName $APP_NAME" "$PLIST"
/usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName $APP_NAME" "$PLIST"

# LaunchServices caches the name against the bundle and would keep showing the
# old one in the Dock and menu bar until the record is rebuilt.
LSREGISTER=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
[ -x "$LSREGISTER" ] && "$LSREGISTER" -f "$BUNDLE" || true

echo "[brand-electron] dev Electron.app branded as \"$APP_NAME\""
