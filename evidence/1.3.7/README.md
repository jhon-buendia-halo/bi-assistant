# 1.3.7 (BA-81) — memory of past sessions, "Mastra only", and ADR-0031's decision

Evidence for roadmap 1.3.7, 2026-11-02. The implementation is commit `90931c0`, accepted by the user by hand the same day. The acceptance gate's E2E files are in this folder. The decision runs used BA-190's memory arms and memory set (roadmap 1.1.13 and 1.1.14, commit `1458eac` on the BA-9 branch). They ran from a local build that merges both branches and was never pushed.

## The decision (ADR-0031, Outcome)

| | gpt-5.6-luna, low effort | gpt-6-luna, low effort |
|---|---|---|
| Learning categories, no memory (A + B) | 24/48 | 22/48 |
| Learning categories, Mastra only (A + B) | 48/48 | 43/48 |
| A/A noise (larger gap of the two arms) | 0.0 pts | 16.7 pts |
| Mastra only minus no memory | +50.0 pts (95% interval +34.5 to +63.6) | +43.8 pts (+25.6 to +58.3) |
| `memory-abstain`, no memory → Mastra only | 12/12 → 0/12 | 12/12 → 0/12 |
| `memory-vs-curated`, no memory → Mastra only | 10/12 → 7/12 | 8/12 → 10/12 |
| M1, no row value retained (Mastra only attempts) | 216/216 | 216/216 |
| Rule 2: may memory be on by default? | no (`memory-abstain`) | no (`memory-abstain`) |
| Rule 3: build Hindsight + Mastra? | no (100% ≥ 80%) | no (89.6% ≥ 80%) |
| Cost per question, no memory → Mastra only | $0.0040 → $0.0092 | $0.0016 → $0.0043 |

A question counts as passed when all 3 attempts pass (pass^3). Each side is three runs, one per memory set: memory-world-cup with 30 questions, memory-finance with 3 and memory-marketing-analytics with 3.

Under Mastra only, `memory-abstain` fails for two reasons:
- In 5 of its 6 questions the answer is right, but the probe recalled the unrelated teach signal (M3).
- In `yellow-cards-latest-tournament-rule-abstain` nothing was recalled, but the summary, sent on every turn, carried the rule into the answer.

## Files

- `decide.mjs`: the script that applies the decision rule.
  - It was written and fixed before the first run; sha256 `f437975d1d7b444b820182ab113808d9039002055642168012368e9c49b4222f`.
  - To recompute a model's report, untar `<model>/runs.tgz` and write a `runs.json` listing `noneA`, `noneB`, `mastraA` and `mastraB`, each with the files of its three sets. Then run `node decide.mjs runs.json`.
- `gpt-5.6-luna/` and `gpt-6-luna/`:
  - `decision.md`: the script's report.
  - `eval-diff-*.txt`: the repo's `eval:diff` of each pair, the A/A pairs and none against Mastra only.
  - `runs.tgz`: the 12 run files (`EVAL_RUN_FILE`), with every attempt's checks, SQL and memory record.
- `recalibration/`: the dev-only threshold check.
  - `similarity.mjs` embedded every probe and teach signal with `text-embedding-3-small` (79 texts, 6,119 tokens).
  - `scores.json` holds the cosine scores. They match what the runs recalled, which cut off near 0.39 to 0.40.
  - `threshold-sweep.txt` shows the trade-off per threshold. No threshold separates the dev abstain signals from the dev lessons, so the threshold stays 0.4.
- `e2e-impact.md`, `e2e-results.txt`: the acceptance gate's E2E impact analysis and results, web target.

## How the runs were made

- **Build:** a detached local worktree, BA-9 `1458eac` merged with BA-4 `90931c0` as `6226b07`. The doc conflicts took the BA-9 side; the code merged cleanly. Backend unit tests: 147 suites, 2,432 tests.
- **Data:** each run used its own APFS clone of the loop's data directories, `.eval-loop/data/<set>`, with the samples on the `loop_*` databases. The LLM was set to `openai/gpt-5.6-luna` or `openai/gpt-6-luna`, low effort.
- **Run settings:** `EVAL_REPEATS=3`, `EVAL_JUDGE=off`, `EVAL_MEMORY=none` or `mastra`. The 12 runs of each model ran at once.
- **Validator before the runs:** memory-world-cup 30/30, memory-finance 3/3, memory-marketing-analytics 3/3.
- **OpenAI spend:**

  | Item | USD |
  |---|---|
  | Smoke (2 questions per arm) | 0.0113 |
  | gpt-5.6-luna runs | 0.9524 |
  | gpt-6-luna runs | 0.4236 |
  | Recalibration embeddings | about 0.0001 |
