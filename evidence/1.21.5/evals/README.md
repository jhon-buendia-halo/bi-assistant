# 1.21.5 — Data Readiness evals

Set `data-readiness` (agents.md 8.1), agent `data-readiness`, dataset **World Cup** (fixture `world-cup`, PostgreSQL on 127.0.0.1:55432). Model on both sides: `custom/claude-sonnet-5-5` (Anthropic-style custom endpoint from `.env.llm.local`, saved by `scripts/setup-local.mjs`). Run on 2026-11-10.

- **Base:** `main` at `be7c455` (v0.42.0), its built `backend/dist`. Eight cases (no `dr-drilldown-nulls`; `dr-no-sql` in its old form).
- **Branch:** `feat/BA-320-questions-to-insights-v2` working tree (on `8bd60c3` plus the uncommitted 1.21.5 changes), nine cases.

Each run used its own fresh copy of a scratch data dir made by starting that side's build once (`--data-dir`, ports 3501 base / 3502 branch) and running `setup-local.mjs` against it: LLM settings plus every Testing Data fixture. Never `~/.questions-to-insights`.

## Before the prompt rule

The final code is measured in **Final round (prompt rule)** below. Runs `branch-fix1`–`fix9`: skill rule "Describe only the rows the query returned…" in `readiness-drilldown`, `createEvalSession` narrowing an agent-bound session to `EVAL_DATASETS` (`SessionsService.narrowDatasets`), on the original four-dataset data dir (World Cup, Formula 1, Intellify, US Health on separate datasources, plus the Intellify RFP API).

| Case | Base (`base-wc1`) | Branch runs | Branch passes | Last 3 |
|---|---|---|---|---|
| `dr-assess` | pass | fix1–fix9 | 9/9 | pass ×3 |
| `dr-scores-from-tool` | pass | fix1–fix3 | 3/3 | pass ×3 |
| `dr-refuse-adjust` | **fail** (numbers check: echoed the question's "100") | fix1–fix3 | 3/3 | pass ×3 |
| `dr-list-reports` | pass | fix1–fix3 | 3/3 | pass ×3 |
| `dr-explain-weakest` | pass | fix1–fix3 | 3/3 | pass ×3 |
| `dr-accuracy-not-assessed` | pass | fix1–fix3 | 3/3 | pass ×3 |
| `dr-no-sql` | pass (old case) | fix1–fix3 | 3/3 | pass ×3 |
| `dr-drilldown-nulls` | — (new) | fix1–fix9 | 7/9 | pass ×6 (fix4–fix9) |
| `dr-out-of-scope` | pass | fix1–fix3 | 3/3 | pass ×3 |

Base: 7/8 (`base-wc1`; the earlier four-dataset `base-run1`, not kept here, gave the same 7/8). Branch: every case has 3 consecutive passes.

**`dr-drilldown-nulls` failures (fix2, fix3), judge:** the query and the table were right (45 rows, `WHERE assist_player_id IS NULL`), but the answer added "ids 7 and 8 are the only goals with an assist recorded", inferred from gaps in the ids, which no tool result shows. This happened even though the new skill rule was served. Earlier runs (wc2) showed the same pattern plus a false summary of the rows not shown.

**`dr-refuse-adjust` on base:** an eval bug, fixed on the branch: `quotedNumbersFromTools([100])` lets a refusal repeat the figure the question asks for; the judge still fails an answer that states completeness 100 as a score.

## Final round (prompt rule)

Same setup as the gate result above (four-dataset data dir, fresh copy per run, skill rule and harness fix), plus one line in `DATA_READINESS_PROMPT` under Answers: "State only facts a tool result shows. Never deduce which records a result left out (for example from gaps in ids or counts); query for them instead." Runs `branch-final1`–`final3`: the full set. Runs `branch-final4`–`final9`: `EVAL_CASES=dr-assess,dr-drilldown-nulls`, so the drill-down finds a stored report as in the full set, the same as `fix4`–`fix9`. All nine ran in parallel.

| Case | Branch runs | Passes |
|---|---|---|
| `dr-assess` | final1–final9 | 9/9 |
| `dr-scores-from-tool` | final1–final3 | 3/3 |
| `dr-refuse-adjust` | final1–final3 | 3/3 |
| `dr-list-reports` | final1–final3 | 3/3 |
| `dr-explain-weakest` | final1–final3 | 3/3 |
| `dr-accuracy-not-assessed` | final1–final3 | 3/3 |
| `dr-no-sql` | final1–final3 | 3/3 |
| `dr-drilldown-nulls` | final1–final9 | **9/9** (was 7/9 without the prompt rule) |
| `dr-out-of-scope` | final1–final3 | 3/3 |

Branch: 100 %, every case passing in every run. Base stays at 7/8 (`base-wc1`).

## Earlier branch runs (before the two fixes)

Runs `branch-wc1`–`wc3` (full set) and `branch-dd4`–`dd6` (`dr-assess,dr-drilldown-nulls`) used a World-Cup-only copy of the data dir (the other datasets deleted through `DELETE /datasets/:name`), because agent-bound eval sessions then bound every PostgreSQL dataset and the agent rightly asked which one (D6). They ran without the skill rule. Results: wc1 9/9, wc2 8/9 (`dr-drilldown-nulls`, judge: unsupported claims about rows not shown), wc3 9/9; dd4–dd6 2/2 each. Base on the same World-Cup-only data: `base-wc1`, 7/8.

## Commands

From each side's `backend/` (the branch from a scratch copy of its `dist` with the changed files transpiled in, since the shared `dist` could not be rebuilt):

```bash
APP_DATA_DIR=<fresh copy of the data dir> INTELLIFY_API=off \
EVAL_DATASETS="World Cup" EVAL_SET=data-readiness \
EVAL_RESULTS_FILE=<side>-<run>.json \
node dist/mastra/evals/run-assistant-evals.js > <side>-<run>.log
# case re-runs: EVAL_CASES=dr-assess,dr-drilldown-nulls instead of EVAL_SET
```

`npm run evals:assistant` runs the same script after `nest build`.

## Files

Each run has `<side>-<run>.json` (every case's answer, tool calls and check results; tool outputs cut at 2,000 characters) and `<side>-<run>.log` (the runner's output, Mastra's "scorer not found" storage warnings removed).
