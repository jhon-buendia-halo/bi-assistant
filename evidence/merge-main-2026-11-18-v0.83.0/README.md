# BA-9 evals after merging main v0.83.0 (2026-11-18)

Why: main moved from v0.73.0 to v0.83.0 (M1-29 per-agent evals, the workflow-first
Answer a Business Question, dashboards), so the branch's eval baseline (round 17,
2026-10-27) no longer described the code. These runs answer one question: **with
main's changes in, is this branch worse than main?** Plan: section 8 of the brief
artifact (claude.ai/artifact/VUWmQypCD6t9BSNdq7gzM1).

## Setup

| | |
|---|---|
| Branch build | `feat/BA-9-golden-dataset-evals` at `1f1dcf57` (main v0.83.0 merged as `e6c765dd`) |
| Main build | main `cfcc3722` (v0.83.0) **with the branch's eval harness, question banks, checks and samples laid over it** (see below) |
| Model | `openai/gpt-5.6-luna`, reasoning effort `low`, saved in each data dir (the loop's model since 2026-10-21). The user's choice of 2026-11-18: no Anthropic key, and Claude through the API was estimated at $42–79 for these runs |
| Repeats | 3 per question per build; judge off for World Cup sets, on for the M1-29 sets (as their 2026-11-16 baseline) |
| Data | a fresh copy of a per-build template data dir per run; samples on the shared PostgreSQL 55432 (World Cup with 10 entities on both builds) |
| Cost | **$1.56** for all 16 runs |

**Why main carries the branch's harness.** Plain main has 12 `world-cup` questions;
the other 51 and the checks they use exist only on this branch. So "main" is main's
app code plus the branch's `backend/src/mastra/evals/`, `modules/memory/`,
`mastra/usage-sink.ts`, the eval-runs service, report and repository,
`modules/testing-data/` and a type-only widening of `KnowledgeUseKind`. Emily's
compiled instructions and tool list hash the same on that build as on plain main
(`fa7344056914e06e`, 9,344 characters; the branch's: `088ba897e8ca3626`, 10,616),
so the comparison measures the branch's agent changes on the same questions
([scripts/assistant-hash.cjs](scripts/assistant-hash.cjs)). Main does not count the
visual designer's tokens, so its cost is slightly low.

## Step 1 — World Cup (63) and World Cup Excel (8): main vs branch

Full output: [diffs/step1-world-cup-and-excel.txt](diffs/step1-world-cup-and-excel.txt).

| Split | Main (3 of 3) | Branch (3 of 3) | eval:diff |
|---|---|---|---|
| dev (56) | 28/56 | **44/56** | `up` (+29 pts, 95% interval +11 to +44) |
| held-out (15) | 6/15 | 6/15 | within |
| cost per question | $0.0054 | **$0.0040** | −24% |

- **No category is `down`** in either split. Up: dev `aggregate` (1/5 → 5/5) and
  the Excel questions (1/8 → 5/8); everything else within the interval.
- **Out-of-scope questions at 3 of 3: not met, on both builds alike.**
  `group-stage-goals-2022` 2/3 on both (a number not grounded in a query once);
  `referee-2022-final` 0/3 on main, 1/3 on the branch. The branch is not worse here,
  but this condition of decision 7 is not met by either build on this model.
- **Now failing on the branch, read one by one:**
  - `goals-by-defenders` (3/3 → 1/3) and `goals-by-defenders-reworded` (3/3 → 0/3):
    **check fault.** The branch answers correctly (11 of 47 goals) with one query
    that groups by position and adds the total across rows
    (`SUM(COUNT(*)) OVER ()`), which is what the branch's new `run_readonly_sql`
    rule asks; `check-sql-matches` only accepts a query containing `'DF'`. Fix: let
    the check accept a grouped result that holds the `DF` row (result-set match)
    instead of the literal.
  - `busiest-stadium`, `most-fouls-team`, `extra-time-goals`,
    `top-scorer-both-tournaments` (+ reworded), `argentina-draws-2022-reworded`:
    3/3 → 2/3, a different check each time; the flaky tail the loop already saw
    (round 16: every dev failure 1–2 of 3).

## Step 2 — the M1-29 sets whose input changed

Which sets: a hash of each set's agents' instructions, tool list and step prompts on
the 2026-11-16 baseline (`02566c0f`), main and the branch
([scripts/eval-set-hashes.cjs](scripts/eval-set-hashes.cjs)). Against main only the
`run_readonly_sql` tool description differs (the branch's sentence on figures across
rows), in 4 sets. `answer-writer` changed against the baseline only through v0.83's
visual line, which its isolated target never sends. Run on both builds:

| Set | Main | Branch | eval:diff |
|---|---|---|---|
| insights-analyst (10) | 2/10 | 4/10 | within |
| insights-analyst-edge (8) | 7/8 | 6/8 | within |
| data-readiness (12) | 6/12 | 8/12 | within |
| readiness-workflow (6) | 4/6 | 4/6 | within |

No set is `down`. Now failing: `iae-top-five-tie`, `iae-legacy-orders-mixed-case`,
`rw-out-of-scope-revenue` (each 3/3 → 2/3, one attempt) and the judged
`v2-share-penalty-goals-2022` (3/3 → 1/3). That case was run 5 more times on each
build: **3/5 on both**, so 4/8 on the branch and 6/8 on main; the judge fails it for
the claim that shoot-outs are not recorded, the same reason the 2026-11-16 report
gives for it on main. Not a regression.

These sets were tuned on Claude Sonnet 5.5 (2026-11-16: every set ≥ 28/30 runs);
on gpt-5.6-luna both builds score lower, so the numbers compare the builds, not the
model with that report.

## Step 3 — Emily vs the whole workflow, same 25 questions

The 15 held-out World Cup questions and the 10 `insights-analyst` questions, on the
branch, each run on the assistant and on the `answer-business-question` workflow
(`EVAL_TARGET`, agents-evals R252). Full table and per-question differences:
[head-to-head.md](head-to-head.md).

| | Emily | Workflow |
|---|---|---|
| Questions 3 of 3 | 9/25 | 10/25 |
| Attempts passed | 46/75 (61%) | 49/75 (65%) |
| Median seconds per attempt | **11.0** | 25.6 |
| Cost per attempt | **$0.0017** | $0.0036 |

The workflow is not measurably more accurate (4 points, well inside the noise of 75
attempts), and it takes 2.3× the time and 2× the cost. It wins the questions that
need a plan or a clarification (`v2-clarify-most-dominant-team` 0/3 → 3/3, the
`third-place-*` questions); Emily wins single-query lookups and shares
(`best-defence` 3/3 vs 0/3, `v2-share-penalty-goals-2022` 3/3 vs 1/3).

## Verdict for PR #81

- **Not worse than main:** no category `down` in step 1 or step 2; the branch is
  better on dev (`up`) and 24% cheaper per question.
- **Open:** the out-of-scope 3-of-3 condition fails on both builds; the
  `goals-by-defenders` check needs the fix above; decision 7 asks for these runs on
  the beta's Claude model, still to do when a key is available.

## Reproduce

`scripts/ba9-save-llm.mjs <url>` saves the model into a running instance's data dir;
`scripts/ba9-run.sh scripts/ba9-jobs.tsv` runs the jobs (paths point at the
worktree's `.eval-loop/`); `eval:diff --before <main runs> --after <branch runs>`;
`python3 -I scripts/ba9-h2h.py <runs dir>`. Run ids: main a17efc62, 3915d526,
ceed621a, b0a5b256, 40ba868e, 93bb6e65; branch 261964fa, a8de25b3, 866bcd96,
3eeb316c, 98a5dca8, d015d839; head-to-head 8d36499c, 162fd9d6; extra 58e13b6d,
14e2199d.
