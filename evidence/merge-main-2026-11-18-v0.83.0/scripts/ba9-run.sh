#!/usr/bin/env bash
# BA-9 re-baseline after main v0.83.0 (2026-11-17). Runs one job per line of a
# jobs file, at most 6 at once, each on a fresh copy of its build's template
# data dir, with the LLM saved in that template (gpt-5.6-luna, effort low).
#
#   .eval-loop/ba9-run.sh <jobs-file>
#
# Job line (tab-separated): name  build(branch|main)  set  datasets  extra-env
# extra-env is space-separated KEY=VALUE pairs, or "-" for none.
set -euo pipefail
LOOP="$(cd "$(dirname "$0")" && pwd)"
OUT="$LOOP/runs/ba9"
mkdir -p "$OUT" "$LOOP/data/ba9-runs"

# The model (2026-11-18, the user's choice): gpt-5.6-luna, effort low, saved
# in each template data dir by ba9-save-llm.mjs (the loop rounds' setting).
export LOOP OUT

run_job() {
  local name="$1" build="$2" set="$3" datasets="$4" extra="$5"
  local dist template
  case "$build" in
    branch) dist="$LOOP/build/ba9-branch/backend/dist"; template="$LOOP/data/ba9-branch-template" ;;
    # main v0.83.0 (cfcc3722) with the branch's eval harness, question bank and
    # samples laid over it; Emily's instructions and tools hash as main's.
    main) dist="$LOOP/build/ba9-main-evals/backend/dist"; template="$LOOP/data/ba9-main-template" ;;
    *) echo "unknown build $build" >&2; return 2 ;;
  esac
  local data="$LOOP/data/ba9-runs/$name"
  rm -rf "$data" && cp -R "$template" "$data"
  local -a extras=()
  if [ "$extra" != "-" ]; then read -r -a extras <<<"$extra"; fi
  local started; started=$(date +%s)
  env APP_DATA_DIR="$data" EVAL_DATASETS="$datasets" EVAL_SET="$set" \
    EVAL_REPEATS="${REPEATS:-3}" EVAL_RUN_FILE="$OUT/$name.json" \
    "${extras[@]}" \
    node "$dist/mastra/evals/run-assistant-evals.js" </dev/null >"$OUT/$name.log" 2>&1 || true
  echo "$name done in $(( $(date +%s) - started ))s: $(grep -E 'questions passed' "$OUT/$name.log" | tail -1)"
}
export -f run_job

grep -v '^#' "$1" | grep -v '^\s*$' | tr '\t' '\037' |
  xargs -P 6 -I{} bash -c 'IFS=$'"'"'\037'"'"' read -r n b s d e <<<"$1"; run_job "$n" "$b" "$s" "$d" "$e"' _ {}
