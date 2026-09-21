#!/usr/bin/env bash
# Serve the static site locally on :4500.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-4500}"
lsof -ti tcp:"$PORT" | xargs -r kill 2>/dev/null || true
echo "▸ http://localhost:$PORT"
cd "$ROOT/public" && python3 -m http.server "$PORT"
