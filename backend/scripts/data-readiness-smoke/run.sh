#!/usr/bin/env bash
# Data readiness live smoke (BA-259): throwaway embedded Postgres + the built
# app, then smoke.mjs. Needs `npm run build` in backend/ first.
#   PG_PORT=55471 APP_PORT=3311 backend/scripts/data-readiness-smoke/run.sh
# Everything lives in one temp dir, removed on exit. Processes are stopped by
# the PIDs this script started, never by pattern.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
BACKEND="$(cd "$HERE/../.." && pwd)"
PG_PORT="${PG_PORT:-55471}"
APP_PORT="${APP_PORT:-3311}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/dr-smoke.XXXXXX")"
PG_PID=""
APP_PID=""

for p in "$PG_PORT" "$APP_PORT"; do
  if (echo > "/dev/tcp/127.0.0.1/$p") 2>/dev/null; then
    echo "port $p is busy; set PG_PORT / APP_PORT to free ports" >&2
    exit 1
  fi
done
[ -f "$BACKEND/dist/cli.js" ] || { echo "run 'npm run build' in backend/ first" >&2; exit 1; }

cleanup() {
  [ -n "$APP_PID" ] && kill "$APP_PID" 2>/dev/null || true
  [ -n "$PG_PID" ] && kill "$PG_PID" 2>/dev/null || true
  [ -n "$PG_PID" ] && wait "$PG_PID" 2>/dev/null || true
  [ -n "$APP_PID" ] && wait "$APP_PID" 2>/dev/null || true
  rm -rf "$WORK"
}
trap cleanup EXIT

echo "work dir: $WORK"
# embedded-postgres and pg go in the temp dir, never in package.json.
(cd "$WORK" && npm init -y >/dev/null && npm install --no-audit --no-fund embedded-postgres pg >"$WORK/npm.log" 2>&1)
cp "$HERE/start-postgres.cjs" "$WORK/"

node "$WORK/start-postgres.cjs" "$WORK/pgdata" "$PG_PORT" "$HERE/seed.sql" >"$WORK/pg.log" 2>&1 &
PG_PID=$!
for _ in $(seq 1 120); do
  grep -q "POSTGRES READY" "$WORK/pg.log" && break
  kill -0 "$PG_PID" 2>/dev/null || { cat "$WORK/pg.log"; exit 1; }
  sleep 1
done
grep -q "POSTGRES READY" "$WORK/pg.log" || { cat "$WORK/pg.log"; exit 1; }
echo "postgres pid $PG_PID on $PG_PORT"

(cd "$BACKEND" && INTELLIFY_API_PORT=0 exec node dist/cli.js --no-open --port "$APP_PORT" --data-dir "$WORK/appdata") >"$WORK/app.log" 2>&1 &
APP_PID=$!
for _ in $(seq 1 60); do
  curl -s -o /dev/null "http://127.0.0.1:$APP_PORT/datasources" && break
  kill -0 "$APP_PID" 2>/dev/null || { cat "$WORK/app.log"; exit 1; }
  sleep 1
done
echo "app pid $APP_PID on $APP_PORT"

node "$HERE/smoke.mjs" "http://127.0.0.1:$APP_PORT" "$PG_PORT" "${OUT_DIR:-$WORK/out}"
