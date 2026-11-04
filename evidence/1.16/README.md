# Evidence — 1.16.1 to 1.16.12 Data Readiness Agent (epic BA-251)

Acceptance gate run on 2026-11-03 on branch `feat/BA-251-data-readiness`, web target, Postgres on 127.0.0.1:55432 (`E2E_SKIP_DOCKER=1`). Desktop not run (not requested).

## Files

| File | What it shows |
|---|---|
| [e2e-results.txt](e2e-results.txt) | Playwright, web project: 114 passed, 0 failed, over the 13 impacted spec files (table below). |
| [data-readiness-scorecard.png](data-readiness-scorecard.png) | A Data Readiness session after "Assess the readiness of this dataset": the readiness card with Open scorecard, and the scorecard (92/100 Managed, ten dimension rows, Accuracy and Currency "Not assessed", findings table and filters). From `data-readiness.spec.ts`, LLM stub, real engine over World Cup. |
| [evals/](evals/) | The `data-readiness` eval set, 3 runs on the final branch, each 8/8: logs with every check, and JSON with the answers, check results and tool names. |
| [smoke/smoke-output.txt](smoke/smoke-output.txt), [smoke/reports.json](smoke/reports.json) | `backend/scripts/data-readiness-smoke` against an embedded Postgres (PG_PORT 55471, APP_PORT 3311): the engine's scores match the hand-computed spec numbers; API 400/404 paths. ALL CHECKS PASSED. |
| [unit-results.txt](unit-results.txt) | Backend Jest 114 suites / 1704 tests; frontend Karma 354 tests. |

## Per feature

| Feature | Story | Evidence |
|---|---|---|
| 1.16.1 Scoring and check engine | BA-252 | Backend Jest (engine and scoring specs); smoke: per-dimension and overall scores equal the formulas |
| 1.16.2 Completeness, validity, consistency, uniqueness | BA-253 | Backend Jest (per-check specs); smoke per-dimension table |
| 1.16.3 Integrity, accessibility, timeliness, reasonability, join inference | BA-254 | Backend Jest; smoke per-dimension table |
| 1.16.4 Golden conformance suite | BA-255 | Backend Jest (gold-scorer suite over the Postgres and Databricks fixtures) |
| 1.16.5 Postgres profiling | BA-256 | Backend Jest; smoke (real Postgres); E2E assessments over World Cup |
| 1.16.6 Databricks profiling | BA-257 | Backend Jest against a fake session (no live Databricks in this gate) |
| 1.16.7 Source profile adapters | BA-258 | Backend Jest; smoke |
| 1.16.8 Saved reports and API | BA-259 | Smoke (POST, GET list, GET by id, 400 and 404); E2E "The scorecard shows the same numbers as the API" |
| 1.16.9 Agent, prompt, skill and tools | BA-260 | Evals 8/8 × 3; backend Jest (prompt fixtures, tools) |
| 1.16.10 Catalogue and session wiring | BA-261 | E2E "Start chat is blocked…", "Assessing a dataset…"; agent-hub and session-management specs |
| 1.16.11 Scorecard panel and chat card | BA-262 | E2E "Assessing…", "Filtering findings…"; screenshot |
| 1.16.12 Past assessments | BA-263 | E2E "Past assessments lists and reopens earlier reports" |

## Step 6 — E2E impact decisions

| Spec | Decision | Result |
|---|---|---|
| `data-readiness.spec.ts` (Feature "Data readiness", 5 scenarios) | Add | 5 passed. The draft's 11 UI assumptions all held against the integrated app. |
| `agent-hub.spec.ts` "filters limit the hub…", "the showcase agents are Official cards…" | Update: 7 Official cards, Data Readiness first, its Start chat enabled | 12 passed |
| `session-management.spec.ts` "the Agent field lists the showcase agents disabled" | Update: Data Readiness Agent listed after Assistant (sessions-chat R64), enabled; wait for the listbox before reading it | 10 passed |
| `agents`, `agent-panel`, `agent-sessions`, `builtin-agent-prompts`, `agent-editor`, `agent-skills`, `skill-library`, `rfp-builder`, `chat-and-visuals`, `chat-clarification` | Re-run as-is | all passed |

`rfp-builder.spec.ts` first failed 9 tests on the environment: `intellify_mercer_demo` did not exist on the shared Postgres. It was seeded through the app's Testing Data endpoint from a throwaway instance (see the `intellify-api` skill), then all 10 passed. Not an epic regression.

## Step 9 — evals

- Set `data-readiness` (8 cases), model `anthropic/claude-sonnet-4-6` through a local Anthropic-compatible proxy (`ANTHROPIC_BASE_URL=…/v1`), World Cup dataset, throwaway data dir. Final round: 8/8, 8/8, 8/8 (100 %, every case 3 of 3).
- No `main` baseline: the set is new in this epic.
- Rounds before the final one, and what each fixed:
  1. 5/8. Check faults: the numbers check refused a true count of the summary's findings ("6 of them high"); the `dr-explain-weakest` rubric demanded fixes from the weakest dimension where D9 orders the most severe findings. The judge now reads the summary the model was handed (`readinessModelOutput`), not the raw `{ report, summary }`.
  2. 7/8. The judge read a contradiction into "worst is Timeliness, fix Completeness first"; the rubric now says that is correct.
  3. 7/8. "nearly 4 years ago" flagged as a score; ages in years, months or weeks are skipped (days stay checked).
  4. 6/8. A clock time ("23:21:22") flagged (now skipped, as dates are), and an **agent fault**: it called Completeness (81, most severe findings) the worst over Timeliness (60). Fixed in the prompt and D9: the weakest dimension is the lowest assessed score.
  5. 8/8 × 3.
- The assistant's and RFP Builder's sets were not run: their compiled instructions and tool sets hash identically on `main` and the branch (assistant `4b5bffd8cf3692c3`, 9 tools; RFP `464bf0fd05d1cb6d`, 23 tools), and the session changes touch only post-turn persistence and the new agent's path.

## Known, not fixed here

- With the right panel open, an agent-bound session header squeezes its chips: the agent chip shows empty and the datasource name overlaps the session ID (visible in the screenshot). The same squeeze predates this epic for one chip (`evidence/1.14.18/panel-table.png`, "W. PostgreSQL"). Cosmetic; a follow-up story.
