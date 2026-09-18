#!/usr/bin/env bash
# Name the macOS menu bar and Dock for unpackaged runs.
#
# macOS takes the app's displayed name from the running bundle — its directory
# name and Info.plist — and ignores app.setName() and any custom menu template.
# Packaged builds get this from electron-builder's `productName`; `npm run
# electron` and `electron:dev` launch Electron.app straight out of node_modules,
# which is named "Electron". So rename that bundle and point the launcher at it.
#
# Idempotent, and a no-op off macOS or when node_modules has not been installed.
set -euo pipefail

APP_NAME="Halo BI Assistant"
DIST="$(cd "$(dirname "$0")/.." && pwd)/node_modules/electron/dist"
BUNDLE="$DIST/$APP_NAME.app"

[ "$(uname)" = "Darwin" ] || exit 0
[ -d "$DIST" ] || exit 0

# `electron/path.txt` is what the launcher resolves, so it has to track the
# rename. CFBundleExecutable stays "Electron" — the binary keeps its own name.
if [ ! -d "$BUNDLE" ]; then
  [ -d "$DIST/Electron.app" ] || exit 0
  mv "$DIST/Electron.app" "$BUNDLE"
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
