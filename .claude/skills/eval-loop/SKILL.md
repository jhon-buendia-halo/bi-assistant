---
name: eval-loop
description: Run one round of the supervised improvement loop of the assistant's evals (BA-242) — the loop's data dir and build snapshot, the baseline runs, the dev-only failure export, starting and collecting the isolated fixer, the leak check, the target slice, the full run, eval:diff with the accept rule, and the results.tsv row. Use when asked to run, continue or record a loop round, to baseline the loop, or to start or collect the fixer.
---

# One round of the improvement loop

The rules (roles, the split rule, levers, what is forbidden, the accept and stop rules, the budget) are in [docs/evals/loop/program.md](../../../docs/evals/loop/program.md); read it first. This file is the commands. The tools are specified in [agents-evals](../../../specs/capabilities/agents-evals/spec.md) R222 to R230 and [delivery.md](../../../specs/system/delivery.md) section 2, *Improvement loop*; the fixer's locks in [the eval-loop tool](../../tools/eval-loop/README.md).

Run everything from the worktree root of the epic branch, never from `main`. Set these once per shell:

```bash
LOOP=$PWD/.eval-loop          # gitignored working folder
R=r1                          # this round
B=r0                          # the baseline: the last accepted round (r0 at first)
SNAP=$LOOP/build/$R/backend   # this round's build snapshot
```

Every path below is absolute, so every command reads it the same wherever it runs: the npm scripts run in `backend/`, and they and the CLI read a relative path against the folder npm was started from (`INIT_CWD`), else the working directory.

## 1. Data dir, build, snapshot

Once, before a baseline: one data dir per set (since 2026-10-21), so the three sets run at once and the loop never touches `~/.questions-to-insights` or `backend/data`. (`$LOOP/data/gpt-4o-mini/` keeps the first model's single data dir, rounds 0 to 2.)

```bash
mkdir -p "$LOOP/data/world-cup" "$LOOP/data/finance" "$LOOP/data/marketing-analytics" "$LOOP/runs" "$LOOP/exports"
```

Build once per round, and never while a run or a served app uses `backend/dist` (`nest build` clears it):

```bash
npm --prefix backend run build:all    # when the app will be started from the snapshot (step 1b)
npm --prefix backend run build        # otherwise
```

When another session's app serves this worktree's `backend/dist`, build in a scratch copy instead and snapshot from there: `rsync -a --delete --exclude node_modules --exclude dist --exclude data --exclude public backend/ <scratch>/backend/`, link `backend/node_modules` into it, copy `frontend/dist/frontend/browser/` into its `public/`, and run `npx nest build` inside it.

Snapshot the build, so a later build never changes a running round:

```bash
rm -rf "$SNAP" && mkdir -p "$SNAP"
cp -R backend/dist "$SNAP/dist"
cp -R backend/public "$SNAP/public"
cp backend/package.json "$SNAP/"
ln -s "$PWD/backend/node_modules" "$SNAP/node_modules"
```

### 1b. Samples and model, from the snapshot's app

For the baseline, and again after a knowledge-seed change. Follow the worktree deploy convention of [workflow-implement](../workflow-implement/SKILL.md): ask the user whether the samples go into the shared compose Postgres on 55432 or an isolated one, check the ports, stop by PID.

Once per set, with that set's data dir:

```bash
lsof -nP -iTCP -sTCP:LISTEN | grep -E ':(3000|3310|55432|55433) '
node "$SNAP/dist/cli.js" --data-dir "$LOOP/data/finance" --port 3310 --no-open --no-intellify-api >"$LOOP/app-finance.log" 2>&1 &
echo "app PID $!"     # report it; stop with kill <PID>, never pkill -f
```

Then, at `http://127.0.0.1:3310`: Settings → LLM, OpenAI with the model `gpt-5.6-luna`, reasoning effort `low` (the loop's model since 2026-10-21; program.md), and the key. The user types the key, or the lead saves it with `PUT /llm/settings` from a script that reads `OPENAI_API_KEY` from the main checkout's `.env` and never prints it. Settings → Testing Data: **Load** that set's sample only (World Cup, Finance or Marketing Analytics, into its own database, such as `loop_finance`), which creates its dataset. After a knowledge-seed change, delete the changed Finance entries on the Knowledge screen of the finance data dir first, then Load Finance again: a reload never overwrites an entry of the same title (testing-data R26). Stop the app by its PID before the next set.

Before the baseline, confirm the OpenAI account has credit for the runs (program.md, *The budget*).

## 2. Runs: the three sets at once

Each set from its own data dir; never two runs at once on one data dir, since they share its database (R223). On macOS, run the whole step under `caffeinate -i -s -m` so the machine does not sleep.

```bash
for set in world-cup finance marketing-analytics; do
  case "$set" in world-cup) dataset="World Cup" ;; finance) dataset="Finance" ;; *) dataset="Marketing Analytics" ;; esac
  APP_DATA_DIR="$LOOP/data/$set" EVAL_DATASETS="$dataset" EVAL_SET="$set" \
  EVAL_REPEATS=3 EVAL_JUDGE=off EVAL_RUN_FILE="$LOOP/runs/$R-$set.json" \
    node "$SNAP/dist/mastra/evals/run-assistant-evals.js" </dev/null >"$LOOP/runs/$R-$set.log" 2>&1 &
done
wait
```

Each run prints `Run id: <jobId>`, the dev and held-out lines and its cost into its log, and is saved in its set's data dir. A failing question makes the command exit 1; that is normal. For the baseline (`R=r0`), write the run ids into row 0 of `docs/evals/loop/results.tsv` and stop here.

## 3. The slice and its failures (supervisor)

Pick the worst slice from the runs' By category tables (program.md, step 1). Then export the dev failures of each run that holds it, for the fixer:

```bash
npm --prefix backend run --silent eval:export-failures -- --run "$LOOP/runs/$B-finance.json" --out "$LOOP/exports/$R"
```

One export per round: when two sets hold the slice, export the one with the most failures of it, or export each to its own folder and pass `--export` below. Read the export, group the failures, and write the hypothesis in one sentence. Choose one lever.

## 4. The fixer

Since 2026-10-21 the lead runs the fixer headless, in the background, from the worktree root:

```bash
.claude/tools/eval-loop/start-fixer.sh "$R" --headless --lever "<lever>" --target <category>
```

It refuses while the lever files have uncommitted changes (commit or revert them first). When it ends, read `$LOOP/fixer/$R/report.md` (its final report) and, when something looks off, its transcript `fixer.jsonl`. The user may still run it interactively instead, without `--headless`, in a terminal outside VS Code; they exit it (`/exit`) when it says it is done. Then collect and check its change:

```bash
.claude/tools/eval-loop/collect-fixer.sh "$R"
npm --prefix backend run --silent eval:leak-check -- --diff-file "$LOOP/fixer/$R/change.patch"
```

On a rejection (exit 1): either start a new fixer with the report written by `--fixer` (it names no held-out case), or, for a false positive, add `<literal> | <reason>` to `docs/evals/loop/leak-allowlist.txt`. Review the patch, then apply it:

```bash
git apply "$LOOP/fixer/$R/change.patch"
```

## 5. Target slice, then the full run

Rebuild and snapshot as in step 1 (`build`, then the snapshot commands), then run the slice on dev only, in each set that holds the category:

```bash
APP_DATA_DIR="$LOOP/data/finance" EVAL_DATASETS="Finance" EVAL_SET=finance \
EVAL_SPLIT=dev EVAL_CATEGORY=<category> EVAL_REPEATS=3 EVAL_JUDGE=off \
EVAL_RUN_FILE="$LOOP/runs/$R-slice-finance.json" \
  node "$SNAP/dist/mastra/evals/run-assistant-evals.js" 2>&1 | tee "$LOOP/runs/$R-slice-finance.log"
npm --prefix backend run --silent eval:diff -- --before "$LOOP/runs/$B-finance.json" --after "$LOOP/runs/$R-slice-finance.json"
```

Read the slice's dev row and its per-attempt numbers, then run every set again, as in step 2, whether or not the row is `up` (since 2026-10-21; program.md, *The accept rule*, **Kept**).

## 6. The accept rule

```bash
npm --prefix backend run --silent eval:diff -- \
  --before "$LOOP/runs/$B-world-cup.json,$LOOP/runs/$B-finance.json,$LOOP/runs/$B-marketing-analytics.json" \
  --after "$LOOP/runs/$R-world-cup.json,$LOOP/runs/$R-finance.json,$LOOP/runs/$R-marketing-analytics.json" \
  --target <category> --round 1 --lever "<lever>" --hypothesis "<hypothesis>" --tsv | tee "$LOOP/runs/$R-diff.txt"
```

It prints `Accept rule: met` (exit 0) or `Accept rule: not met (<reasons>)` (exit 1); exit 2 is a bad argument or run. Show the user the table, the flips, the cost and the verdict.

## 7. Record

Since 2026-10-21 (program.md, *Roles*), the lead reverts on its own a round that fails any of conditions 2 to 5 of the accept rule, records it and goes on to the next hypothesis; it asks the user about a round that meets the accept rule (`accepted`) or meets conditions 2 to 5 only (`kept`).

- **The user accepts:** update the specs and tests the change affects (the prompt in `specs/system/agents.md` Appendix A, `backend/src/mastra/agents/__fixtures__/`, pinned unit tests), run those tests, and commit the lever files with them, the `eval:diff` output (`$LOOP/runs/$R-diff.txt`) in the commit message. The after runs become the next baseline: `B=$R`.
- **Not accepted, or `tried`:** revert the change: `git restore -- <the lever files the patch changed>` (listed by `git apply --stat "$LOOP/fixer/$R/change.patch"`), and delete any lever file it created.
- **Either way:** append the draft row `eval:diff --tsv` printed to `docs/evals/loop/results.tsv`, with `files`, `decision` (`accepted`, `reverted` or `tried`), `reason` and the target slice's cost added. Never write held-out content into it.

Then the stop rule (program.md): the money spent so far is

```bash
awk -F'\t' 'NR > 1 { s += $14 } END { printf "$%.2f\n", s }' docs/evals/loop/results.tsv
```

Stop at $22, or on 2026-10-31.
