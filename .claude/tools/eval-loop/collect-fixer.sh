#!/usr/bin/env bash
# Collect the improvement loop fixer's change for one round and remove its
# worktree (delivery.md section 2, *Improvement loop*).
#
# Usage:
#   .claude/tools/eval-loop/collect-fixer.sh <round> [--keep]
#
#   --keep  keep the fixer's worktree after writing the patch
#
# Writes the tree's change to the lever files (agents-evals R229; unit test
# files and their fixtures left out) as .eval-loop/fixer/<round>/change.patch,
# names any other file the fixer changed (left out of the patch), and removes
# the worktree. Then: eval:leak-check --diff-file on the patch, git apply.
set -euo pipefail

# The lever files (agents-evals R229); the guard test checks they match
# LEVER_PATHS in backend/src/mastra/evals/loop/leak-check.ts.
LEVER_PATHS=(
  backend/src/mastra/agents
  backend/src/mastra/skills
  backend/src/mastra/tools
  backend/src/mastra/context-blocks.ts
  backend/src/mastra/tool-section.ts
  backend/src/modules/sessions/sessions.service.ts
  backend/src/modules/testing-data/fixtures/knowledge
)
EXCLUDES=(':(exclude,glob)**/*.spec.ts' ':(exclude,glob)**/__fixtures__/**')

die() {
  echo "collect-fixer: $*" >&2
  exit 2
}

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(git -C "$script_dir" rev-parse --show-toplevel)"

round="${1:-}"
[[ -n "$round" && "$round" != --* ]] || die "usage: collect-fixer.sh <round> [--keep]"
[[ "$round" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || die "a round is letters, digits, dots, dashes and underscores (got \"$round\")"
shift
keep=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --keep) keep=1; shift ;;
    *) die "unknown argument \"$1\"" ;;
  esac
done

fixer="$root/.eval-loop/fixer/$round"
tree="$fixer/tree"
[[ -d "$tree" ]] || die "no fixer tree at $tree"
patch="$fixer/change.patch"

# A lever file the fixer created is untracked: mark it so the diff shows it.
# This writes only the throwaway tree's own index.
git -C "$tree" add --intent-to-add -- "${LEVER_PATHS[@]}" 2>/dev/null || true
git -C "$tree" diff --binary -- "${LEVER_PATHS[@]}" "${EXCLUDES[@]}" >"$patch"

# Anything else the fixer changed is left out. Deleted files are the
# held-out paths start-fixer.sh removed (the fixer cannot delete).
others="$(git -C "$tree" status --porcelain --untracked-files=all |
  grep -v '^ D ' |
  awk '{ print $NF }' |
  grep -v -E '^backend/src/mastra/(agents|skills|tools)/|^backend/src/mastra/(context-blocks|tool-section)\.ts$|^backend/src/modules/sessions/sessions\.service\.ts$|^backend/src/modules/testing-data/fixtures/knowledge/' || true)"
excluded="$(git -C "$tree" status --porcelain --untracked-files=all -- "${LEVER_PATHS[@]}" |
  awk '{ print $NF }' |
  grep -E '\.spec\.ts$|/__fixtures__/' || true)"

if [[ -s "$patch" ]]; then
  echo "Wrote $patch:"
  git -C "$root" apply --stat "$patch" | sed 's/^/  /'
else
  echo "The fixer changed no lever file; $patch is empty."
fi
if [[ -n "$others$excluded" ]]; then
  echo "Left out of the patch (not lever files, or tests):"
  printf '%s\n%s\n' "$others" "$excluded" | sed '/^$/d; s/^/  /'
fi

if [[ $keep -eq 0 ]]; then
  git -C "$root" worktree remove --force "$tree"
  echo "Removed the worktree $tree."
fi
echo "Next: npm --prefix backend run eval:leak-check -- --diff-file $patch"
echo "Then: git apply $patch"
