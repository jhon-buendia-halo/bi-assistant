#!/usr/bin/env bash
# Like ba9-run.sh, without xargs (macOS xargs -I refuses lines over 255 bytes,
# and EVAL_CASES lists are longer): every job line starts at once in the
# background, then the script waits. Usage: ba9-direct.sh <jobs-file>
set -uo pipefail
LOOP="$(cd "$(dirname "$0")" && pwd)"
OUT="$LOOP/runs/ba9"
mkdir -p "$OUT" "$LOOP/data/ba9-runs"

run_job() {
  local name="$1" build="$2" set="$3" datasets="$4" extra="$5" dist template
  case "$build" in
    branch) dist="$LOOP/build/ba9-branch/backend/dist"; template="$LOOP/data/ba9-branch-template" ;;
    main) dist="$LOOP/build/ba9-main-evals/backend/dist"; template="$LOOP/data/ba9-main-template" ;;
    ecom) dist="/Users/selbver/Developer/question-to-insights/bi-assistant/.claude/worktrees/ecommerce-evals-100/backend/dist"; template="$LOOP/data/ba9-branch-template" ;;
    *) echo "unknown build $build" >&2; return 2 ;;
  esac
  mkdir "$OUT/.claim-$name" 2>/dev/null || { echo "$name already claimed"; return 0; }
  local data="$LOOP/data/ba9-runs/$name"
  rm -rf "$data" && cp -R "$template" "$data"
  local -a extras=()
  if [ "$extra" != "-" ]; then read -r -a extras <<<"$extra"; fi
  local started; started=$(date +%s)
  env APP_DATA_DIR="$data" EVAL_DATASETS="$datasets" EVAL_SET="$set" \
    EVAL_REPEATS="${REPEATS:-3}" EVAL_RUN_FILE="$OUT/$name.json" \
    "${extras[@]}" \
    node "$dist/mastra/evals/run-assistant-evals.js" </dev/null >"$OUT/$name.log" 2>&1
  echo "$name done in $(( $(date +%s) - started ))s: $(grep -E 'questions passed' "$OUT/$name.log" | tail -1)"
}

while IFS=$'\t' read -r n b s d e; do
  case "$n" in ''|'#'*) continue ;; esac
  run_job "$n" "$b" "$s" "$d" "$e" &
done < "$1"
wait
