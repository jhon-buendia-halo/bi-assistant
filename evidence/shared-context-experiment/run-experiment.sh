#!/bin/zsh
# Runs the shared-context experiment: per round, the baseline set
# (insights-analyst) and the shared set (insights-analyst-shared-context)
# at the same time, each through its own metering proxy and its own fresh
# copy of the seed data dir. Usage: run-experiment.sh <first round> <last round>
# Needs `npx nest build` in backend/ first, a seed data dir with the
# "World Cup" dataset (SEED_DIR) and the LLM key file (LLM_ENV_FILE, the main
# checkout's .env.llm.local). Never run more than 6 eval processes on the
# local endpoint at once (lessons.md): this script runs 2.
set -u
ROOT=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
EXP=$ROOT/.context/shared-context
OUT=${OUT_DIR:-$EXP/runs}
SEED=${SEED_DIR:-$EXP/seed}
LLM_ENV_FILE=${LLM_ENV_FILE:-$ROOT/.env.llm.local}
UPSTREAM=http://127.0.0.1:8317
MODEL=claude-sonnet-5-5
KEY=$(grep -E '^LLM_API_KEY=' "$LLM_ENV_FILE" | head -1 | cut -d= -f2-)
FIRST=${1:-1}
LAST=${2:-3}

run_variant() {
  local variant=$1 set=$2 port=$3 round=$4
  local dir=$OUT/$variant/round-$round
  local data=$EXP/data/$variant-$round
  rm -rf "$dir" "$data"
  mkdir -p "$dir" "$data"
  cp -Rp "$SEED/." "$data/"
  node "$ROOT/scripts/llm-meter-proxy.mjs" --port "$port" --upstream "$UPSTREAM" \
    --log "$dir/meter.jsonl" > "$dir/proxy.log" 2>&1 &
  local proxy=$!
  echo "$proxy" > "$dir/proxy.pid"
  sleep 1
  local started=$(date +%s)
  # SMOKE_CASE=<baseline case id> runs that one case (prefixed `shared-` on
  # the shared set) instead of the whole set.
  local select="EVAL_SET=$set"
  if [[ -n "${SMOKE_CASE:-}" ]]; then
    if [[ $variant == shared ]]; then select="EVAL_CASES=shared-$SMOKE_CASE"
    else select="EVAL_CASES=$SMOKE_CASE"; fi
  fi
  (
    cd "$ROOT/backend" && \
    env APP_DATA_DIR="$data" APP_SECRET="$(cat "$data/.app-secret")" INTELLIFY_API=off \
    EVAL_DATASETS="World Cup" "$select" \
    EVAL_RESULTS_FILE="$dir/results.json" \
    EVAL_LLM_PROVIDER=custom EVAL_LLM_API_STYLE=anthropic \
    EVAL_LLM_BASE_URL="http://127.0.0.1:$port" EVAL_LLM_MODEL="$MODEL" \
    EVAL_LLM_API_KEY="$KEY" \
    node dist/mastra/evals/run-assistant-evals.js > "$dir/eval.log" 2>&1
  )
  local code=$?
  echo "$(( $(date +%s) - started ))" > "$dir/wall-seconds"
  echo "$code" > "$dir/exit-code"
  kill "$proxy" 2>/dev/null
  echo "$(date +%T) $variant round $round done (exit $code): $(tail -1 "$dir/eval.log")"
}

for round in $(seq "$FIRST" "$LAST"); do
  echo "$(date +%T) round $round started"
  run_variant baseline insights-analyst 8411 "$round" &
  local_a=$!
  run_variant shared insights-analyst-shared-context 8412 "$round" &
  local_b=$!
  wait $local_a $local_b
done
echo "$(date +%T) all rounds done"
