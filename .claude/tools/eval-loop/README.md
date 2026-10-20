# `eval-loop` — the improvement loop's fixer isolation

**Kind:** script (run from the shell; no server). **Skill:** [`eval-loop`](../../skills/eval-loop/SKILL.md). **Runbook:** [docs/evals/loop/program.md](../../../docs/evals/loop/program.md). **Spec:** [delivery.md](../../../specs/system/delivery.md) section 2, *Improvement loop*; agents-evals R228 to R230. Added 2026-10-20 (BA-242).

The fixer is the Claude Code session that proposes one change per round of the supervised improvement loop. It must never see a held-out question, so it gets a copy of the repository without them, a few tools and deny rules for whatever is left on the disk.

## Files

| File | What it does |
|---|---|
| `start-fixer.sh <round> [--export <dir>] [--lever "<lever>"] [--target <categories>] [--allow-dirty] [--dry-run]` | Adds a detached worktree at `.eval-loop/fixer/<round>/tree` (`git worktree add --detach … HEAD`, no branch). Deletes from its working copy, never committed, the held-out paths (`HELD_OUT_PATHS`: sets, checks and harness, planted facts, generators, the evals spec, domain policies, research, plans, evidence, E2E tests, the roadmap, work-unit proposals, the leak check's allowlist, any `dist/`), then any other file that names a held-out case (`held-out-scan.mjs`); a lever file that does stops the start. Copies the export (default `.eval-loop/exports/<round>`) to `.eval-loop/fixer/<round>/export/` and starts `claude` inside the tree. Refuses to start while the lever files have uncommitted changes, since the tree is `HEAD` without them (`--allow-dirty` overrides). Exit 2 on a refusal. |
| `collect-fixer.sh <round> [--keep]` | Writes the tree's change to the lever files (R229; unit tests and `__fixtures__` left out, new files included) as `.eval-loop/fixer/<round>/change.patch`, names any other file the fixer changed (left out of the patch), and removes the worktree (`--keep` keeps it). Then the lead runs `eval:leak-check --diff-file` on the patch and `git apply`. |
| `fixer-settings.json` | The second layer: `permissions.deny` rules that forbid editing the forbidden paths (sets, checks, scripts, fixtures, docs, specs, `.claude/`, package files, tests, the frontend, the model routing files) and reading the held-out paths, and `autoMemoryEnabled: false`. |
| `held-out-scan.mjs <sets dir> <folder>` | Lists the files of a folder that name a held-out case id (also prefixed, `rest-<id>`) or quote a held-out question word for word. |

The `claude` command `start-fixer.sh` runs, from inside the tree:

```bash
CLAUDE_CODE_DISABLE_AUTO_MEMORY=1 claude \
  --settings <absolute path of fixer-settings.json> \
  --tools Read,Edit,Write,Glob,Grep \
  --permission-mode acceptEdits \
  --strict-mcp-config \
  --add-dir .eval-loop/fixer/<round>/export \
  -n "eval-loop fixer <round>" \
  --append-system-prompt "<the fixer's role>" \
  "<the round, its lever and target, and where the export is>"
```

- No Bash: read and edit rules do not stop a `node` or `python` subprocess.
- `--strict-mcp-config` with no `--mcp-config`: no MCP server (the repo's `jira`, the account's connectors) reaches the fixer.
- Auto-memory off, twice (the variable and the setting), and the memory folders Read-denied: the lead's memory may name held-out cases.

### How the deny rules match (checked on Claude Code 2.1.211)

- A rule written `**/<path>` is relative to the session's working directory, the tree: it covers the tree's files and nothing outside it.
- A rule written `//**/<path>` is absolute: it covers that path anywhere on the disk, such as the epic worktree's own `backend/src/mastra/evals/` or another checkout's. The Read rules come in both forms. Without the absolute form, reading the epic worktree's question bank by its absolute path is only a permission prompt, which a person could approve.
- An absolute `.claude` rule must never be added: the tree sits under `.claude/worktrees/`, so `//**/.claude/**` would deny every file of it.
- Any read or edit outside the tree and the export asks for permission; in the fixer's session, answer no.

## Tests

- **Guard (Jest):** `cd backend && npx jest src/mastra/evals/loop/fixer-settings.spec.ts`. It holds the deny list to every forbidden and held-out path, checks no rule denies a lever file (also by the tree's real absolute path under `.claude/worktrees/`), that `start-fixer.sh` deletes every held-out path of the spec and each one it deletes is Read-denied, that both scripts know the leak check's lever files, and that the `claude` flags are the locked ones.
- **Smoke run (headless `claude -p`):** proves Claude Code applies the rules. From the worktree root, with a throwaway export:

  ```bash
  mkdir -p .eval-loop/exports/smoke
  printf '# Failure export: smoke\n' > .eval-loop/exports/smoke/README.md
  printf '{"run":"smoke","files":["README.md"]}\n' > .eval-loop/exports/smoke/.eval-export
  .claude/tools/eval-loop/start-fixer.sh smoke --dry-run      # prints the claude command
  R=$PWD; T=$R/.eval-loop/fixer/smoke/tree
  mkdir -p "$T/docs/plans" && echo probe > "$T/docs/plans/smoke-probe.md"
  (cd "$T" && CLAUDE_CODE_DISABLE_AUTO_MEMORY=1 claude -p \
     --settings "$R/.claude/tools/eval-loop/fixer-settings.json" \
     --tools Read,Edit,Write,Glob,Grep --permission-mode acceptEdits --strict-mcp-config \
     --model haiku --max-budget-usd 0.30 --no-session-persistence \
     --output-format stream-json --verbose \
     "One tool call per step, absolute paths; a refused step is expected, go on. \
      1. Read $T/docs/plans/smoke-probe.md 2. Write $T/specs/smoke-probe.md 3. Edit $T/backend/src/mastra/model-compat.ts \
      4. Read $R/backend/src/mastra/evals/sets/finance.json 5. Edit $T/backend/src/mastra/tool-section.ts")
  .claude/tools/eval-loop/collect-fixer.sh smoke && rm -rf .eval-loop/fixer/smoke .eval-loop/exports/smoke
  ```

  Read the tool results, not only `permission_denials`: a Read, Edit or Write refused by a deny rule comes back as the tool error `File is in a directory that is denied by your permission settings.` and is **not** listed in `permission_denials`; a Grep or Glob on a denied folder, and anything outside the tree waiting for a permission, are listed there. Expected: steps 1 to 4 refused, step 5 done, and `collect-fixer.sh` writes a patch of that one line. Result of 2026-10-20 (Claude Code 2.1.211, haiku, $0.05 a run): exactly that; with only the `**/` rules, step 4 fell to a permission prompt instead of a deny rule, which is why the absolute rules exist.
