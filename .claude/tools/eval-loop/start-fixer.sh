#!/usr/bin/env bash
# Start the improvement loop's fixer for one round, isolated from the
# held-out questions (agents-evals R228; delivery.md section 2,
# *Improvement loop*; runbook docs/evals/loop/program.md).
#
# Usage:
#   .claude/tools/eval-loop/start-fixer.sh <round> [--export <dir>]
#       [--lever "<lever>"] [--target <categories>] [--allow-dirty] [--dry-run]
#
#   <round>        the round's name, such as r1
#   --export       the round's failure export (eval:export-failures --out);
#                  default .eval-loop/exports/<round>
#   --lever        the one lever of the round, told to the fixer
#   --target       the target categories, comma-separated, told to the fixer
#   --allow-dirty  start although the lever files have uncommitted changes
#                  (the fixer's tree is HEAD, without them)
#   --dry-run      prepare the tree and print the claude command, do not run it
#
# It adds a detached worktree at .eval-loop/fixer/<round>/tree (no branch),
# deletes from its working copy every path that carries held-out content
# (never committed), copies the export to .eval-loop/fixer/<round>/export/,
# and starts claude inside the tree with only Read, Edit, Write, Glob and
# Grep (no Bash: read and edit rules do not stop a subprocess), the deny
# rules of fixer-settings.json, no MCP server and no auto-memory. Collect the
# change with collect-fixer.sh <round>.
set -euo pipefail

# Paths that carry held-out content: question banks, checks and harness,
# planted facts and fixture generators, the evals spec, the domain policies,
# research and plans, evidence, E2E tests, the roadmap, work-unit proposals
# and the leak check's allowlist. Every one is also Read-denied in
# fixer-settings.json; the guard test
# (backend/src/mastra/evals/loop/fixer-settings.spec.ts) checks both. Any
# other file that names a held-out case is found by a scan and deleted too.
HELD_OUT_PATHS=(
  backend/src/mastra/evals
  backend/scripts/fixtures
  docker/postgres
  specs/capabilities/agents-evals
  docs/evals/domains
  docs/evals/loop/leak-allowlist.txt
  docs/research
  docs/plans
  evidence
  frontend/e2e
  roadmap.md
  proposals
)

# The lever files (agents-evals R229), checked for uncommitted changes.
LEVER_PATHS=(
  backend/src/mastra/agents
  backend/src/mastra/skills
  backend/src/mastra/tools
  backend/src/mastra/context-blocks.ts
  backend/src/mastra/tool-section.ts
  backend/src/modules/sessions/sessions.service.ts
  backend/src/modules/testing-data/fixtures/knowledge
)

die() {
  echo "start-fixer: $*" >&2
  exit 2
}

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(git -C "$script_dir" rev-parse --show-toplevel)"
settings="$script_dir/fixer-settings.json"

round="${1:-}"
[[ -n "$round" && "$round" != --* ]] || die "usage: start-fixer.sh <round> [--export <dir>] [--lever \"<lever>\"] [--target <categories>] [--allow-dirty] [--dry-run]"
[[ "$round" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || die "a round is letters, digits, dots, dashes and underscores (got \"$round\")"
shift

export_src="$root/.eval-loop/exports/$round"
lever=""
target=""
allow_dirty=0
dry_run=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --export) [[ $# -ge 2 ]] || die "--export needs a folder"; export_src="$2"; shift 2 ;;
    --lever) [[ $# -ge 2 ]] || die "--lever needs a value"; lever="$2"; shift 2 ;;
    --target) [[ $# -ge 2 ]] || die "--target needs categories"; target="$2"; shift 2 ;;
    --allow-dirty) allow_dirty=1; shift ;;
    --dry-run) dry_run=1; shift ;;
    *) die "unknown argument \"$1\"" ;;
  esac
done

[[ -f "$settings" ]] || die "no $settings"
case "$export_src" in /*) ;; *) export_src="$PWD/$export_src" ;; esac
[[ -f "$export_src/.eval-export" && -f "$export_src/README.md" ]] ||
  die "no failure export at $export_src; write one with npm --prefix backend run eval:export-failures -- --run <run> --out $export_src"

if [[ $allow_dirty -eq 0 ]]; then
  dirty="$(git -C "$root" status --porcelain -- "${LEVER_PATHS[@]}")"
  [[ -z "$dirty" ]] || die "the lever files have uncommitted changes, and the fixer's tree is HEAD without them; commit or revert them first, or pass --allow-dirty:
$dirty"
fi

fixer="$root/.eval-loop/fixer/$round"
tree="$fixer/tree"
[[ ! -e "$tree" ]] || die "$tree already exists; collect it first with collect-fixer.sh $round"
mkdir -p "$fixer"

git -C "$root" worktree add --detach "$tree" HEAD >/dev/null
for path in "${HELD_OUT_PATHS[@]}"; do
  rm -rf "${tree:?}/$path"
done
find "$tree" -type d -name dist -prune -exec rm -rf {} +

# Any other file that names a held-out case id or quotes a held-out question
# (a test, a note) is deleted as well (held-out-scan.mjs). A lever file that
# does stops the start: the fixer would edit it, and the lead fixes it first.
lever_re='^backend/src/mastra/(agents|skills|tools)/|^backend/src/mastra/(context-blocks|tool-section)\.ts$|^backend/src/modules/sessions/sessions\.service\.ts$|^backend/src/modules/testing-data/fixtures/knowledge/'
named="$(node "$script_dir/held-out-scan.mjs" "$root/backend/src/mastra/evals/sets" "$tree")" ||
  die "the held-out scan failed"
while IFS= read -r rel; do
  [[ -n "$rel" ]] || continue
  if [[ "$rel" =~ $lever_re ]]; then
    die "the lever file $rel names a held-out case; fix it in $root first (the tree stays at $tree: git worktree remove --force $tree)"
  fi
  rm -f "${tree:?}/$rel"
  echo "Deleted from the tree (names a held-out case): $rel"
done <<<"$named"

rm -rf "${fixer:?}/export"
mkdir -p "$fixer/export"
cp -R "$export_src/." "$fixer/export/"

role="You are the fixer of the supervised improvement loop of the BI assistant's evals. \
The supervisor (the user and the lead session) chose this round's slice and one lever; every change you make is reviewed by the lead and accepted or reverted by the user. \
Read the failure export in $fixer/export first: README.md, then one file per failed dev question. It is all you get about the run. \
Make ONE change, for this round's ONE lever: the assistant's prompt (backend/src/mastra/agents/), its tool descriptions and error messages (backend/src/mastra/tools/, backend/src/mastra/tool-section.ts), its context blocks (backend/src/mastra/context-blocks.ts, backend/src/modules/sessions/sessions.service.ts), its skills (backend/src/mastra/skills/), or a domain sample's knowledge seed (backend/src/modules/testing-data/fixtures/knowledge/; the World Cup sample stays unseeded). \
Edit only those lever files. Never touch tests (*.spec.ts, __fixtures__), specs, docs, eval sets, checks, fixtures, the model or effort settings. \
Generalise the lesson behind the failures; never copy a question, a name, a number or a quoted value from the export into a lever file (the leak check rejects it). \
When done, list the files you changed and say in a few lines why the change should help; the lead collects it."

prompt="Round $round."
[[ -n "$lever" ]] && prompt="$prompt Lever: $lever."
[[ -n "$target" ]] && prompt="$prompt Target categories: $target."
prompt="$prompt Read $fixer/export/README.md and the failure files, then propose and make the one change."

cmd=(claude
  --settings "$settings"
  --tools Read,Edit,Write,Glob,Grep
  --permission-mode acceptEdits
  --strict-mcp-config
  --add-dir "$fixer/export"
  -n "eval-loop fixer $round"
  --append-system-prompt "$role"
  "$prompt")

echo "Fixer tree: $tree (held-out paths deleted)"
echo "Export:     $fixer/export"
if [[ $dry_run -eq 1 ]]; then
  printf 'cd %q && CLAUDE_CODE_DISABLE_AUTO_MEMORY=1' "$tree"
  printf ' %q' "${cmd[@]}"
  printf '\n'
  exit 0
fi
cd "$tree"
CLAUDE_CODE_DISABLE_AUTO_MEMORY=1 exec "${cmd[@]}"
