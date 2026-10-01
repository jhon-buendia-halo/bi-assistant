#!/usr/bin/env bash
# Serve the site locally on :4500, Functions included.
#
# `/download/<target>` and `/api/latest` need a GitHub token with read access to
# the private repo's releases. Without one they return 503 and the page falls
# back to its static copy.
#
# Env:
#   GITHUB_TOKEN   fine-grained PAT, Contents: Read-only on bi-assistant
#   PORT           default 4500
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
PORT="${PORT:-4500}"
lsof -ti tcp:"$PORT" | xargs -r kill 2>/dev/null || true

args=(pages dev public --port "$PORT" --compatibility-date 2026-09-01)
if [ -n "${GITHUB_TOKEN:-}" ]; then
  args+=(--binding "GITHUB_TOKEN=$GITHUB_TOKEN")
else
  echo "▲ GITHUB_TOKEN not set — download routes will return 503." >&2
fi

echo "▸ http://localhost:$PORT"
exec npx --yes wrangler@4 "${args[@]}"
