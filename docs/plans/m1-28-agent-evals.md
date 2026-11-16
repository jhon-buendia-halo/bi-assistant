# M1-28 — Border-case evals for every agent of Answer a Business Question and Assess Data Readiness

Plan for [Milestone 1.28](../../roadmap.md) ([epic spec](../../specs/epics/M1-28/spec.md)). Requested on 2026-11-16: "solid evals with border cases that test each agent of the two workflows independently and find inconsistencies, given each agent's purpose". The user asked to go on with the recommendation.

## Facts (inventory of 2026-11-16)

- Agents per step (`workflow-catalog.ts` `stepAgents`): Answer a Business Question — `read-images` Zoe `image-reader`, `interpret-follow-up` Nathan `result-explorer`, `plan` Olivia `analysis-planner`, `analyse` Michael `insights-analyst` (tools), `check-data-quality` Sarah `data-readiness` (no tools, structured), `write-answer` Jessica `answer-writer`. Assess Data Readiness — `read-images` Zoe, `explain-report` Sarah (full agent with tools).
- Isolated model calls: `readImagesWithModel`, `interpretResultWithModel`, `planWithModel`, `checkDataQualityWithModel`, `writeAnswerWithModel` (each a plain function over a typed input); Analyse and Explain report run through the turn engine.
- Existing sets: `insights-analyst` (10, whole workflow, world-cup, never Check data quality, follow-up, images or Clarify resume), `data-readiness` (12, Sarah as a chat agent, never the workflow), `result-explorer` (13, isolated), `query-explainer` (8). No set for Olivia, Jessica, Sarah's check-data-quality call, Zoe, Sarah's explain-report in the workflow. No set uses `edge-cases`.
- A custom check sees only `answer` and `toolCalls`; isolated targets put the call's structured output as JSON text in `answer` (`result-explorer-eval-target.ts` is the pattern); `evalTargetFor` (`eval-sets.ts:60-70`) needs one branch per agent key.
- Known before any run: **A** `dr-no-sql` registers `checks.didNotCall` twice under one scorer id (one verdict lost); **B** Sarah's check-data-quality call is served her chat prompt (call tools, decline non-readiness, lead with the score) while the step has no tools and wants JSON; **C** the explain runtime streams the turn input and drops the workflow's `question`; **D** Validate's warning-only "Measures covered" reaches Jessica as `failed:`.

## Approach

One isolated set per agent with frozen, hand-built inputs (so a failure belongs to one agent), plus two whole-workflow sets on Edge Cases for cross-agent consistency. Code checks first; truth computed with live SQL against the fixture where a figure matters; the judge only where code cannot decide, with one pass condition per rubric.

## Stories

| Story | What | Model | Depends on |
|---|---|---|---|
| 1.28.1 | Eval infrastructure: a generic isolated-call target factory (agent key → call function, input from the case's `vars`, output JSON as `answer`), branches in `evalTargetFor`; a `sqlTruth` check helper (runs a reference SQL on the case's datasource at eval time and compares figures in the answer or JSON fields to it); edge-cases fixture support in the preflight; a `data-readiness-assessment` workflow target (runs the whole workflow on a dataset, scores Explain report's answer and tool calls); fix A; agents.md 8, agents-evals spec | Opus | – |
| 1.28.2 | `analysis-planner` set (Olivia), ~12 cases on Edge Cases catalog blocks | Sonnet | 1.28.1 |
| 1.28.3 | `answer-writer` set (Jessica), ~12 cases with frozen query rows | Sonnet | 1.28.1 |
| 1.28.4 | `data-quality-check` set (Sarah's step call), ~8 cases | Sonnet | 1.28.1 |
| 1.28.5 | `image-reader` set (Zoe), ~6 cases with generated PNG fixtures | Sonnet | 1.28.1 |
| 1.28.6 | `insights-analyst-edge` (whole workflow on Edge Cases, ~8) and `result-explorer` +5 Edge Cases cases | Sonnet | 1.28.1 |
| 1.28.7 | `readiness-workflow` set (Explain report inside the workflow on Edge Cases, ~6) | Sonnet | 1.28.1 |
| 1.28.8 | Baseline (3 runs per case), inconsistency report, fixes (B, C, D and whatever the baseline shows), re-run to green | Opus (lead) | 1.28.2–1.28.7 |

Every set: unique id prefix, every check unit-tested on one hand-written correct and one wrong output, agents.md 8.1 row, no model call in unit tests.
