#!/usr/bin/env bash
# Live smoke test of the "Custom endpoint" LLM provider (BA-281 / BA-299).
# Thin wrapper: checks the environment and Node, then runs smoke.mjs, which
# starts an isolated app, drives the API, scans for the raw key and stops the
# app by PID. See README.md for the variables.
#
#   APP_PORT=3460 CUSTOM_BASE_URL_OPENAI=http://127.0.0.1:8317/v1 \
#   CUSTOM_BASE_URL_ANTHROPIC=http://127.0.0.1:8317 CUSTOM_API_KEY=... \
#   backend/scripts/custom-endpoint-smoke/run.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ -z "${APP_PORT:-}" ]]; then
  echo "custom-endpoint-smoke: APP_PORT is required (a free port, not 3000/3100/3200/4200/55432/8317)" >&2
  exit 2
fi
if [[ -z "${CUSTOM_BASE_URL_OPENAI:-}" && -z "${CUSTOM_BASE_URL_ANTHROPIC:-}" ]]; then
  echo "custom-endpoint-smoke: set CUSTOM_BASE_URL_OPENAI and/or CUSTOM_BASE_URL_ANTHROPIC" >&2
  exit 2
fi
if ! command -v node >/dev/null 2>&1; then
  echo "custom-endpoint-smoke: node is not on PATH" >&2
  exit 2
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if (( NODE_MAJOR < 18 )); then
  echo "custom-endpoint-smoke: Node 18+ is required (found $(node -v))" >&2
  exit 2
fi

exec node "$SCRIPT_DIR/smoke.mjs"
