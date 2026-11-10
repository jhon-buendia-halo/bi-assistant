# 1.1.10 — World Cup golden set merged into the World Cup bank (BA-188)

2026-10-20. The 11 questions of `world-cup-golden.json` now close `world-cup.json`, and the golden file and its three sets are gone. Specs: agents-evals R109 (rewritten in place), R11, R126, R134; data-model 4.9.

| File | Shows |
|---|---|
| [merge-check.txt](merge-check.txt), [merge_golden.py](merge_golden.py) | The merge was a text splice whose assertions prove the 52 World Cup cases unchanged, the 11 golden cases identical apart from the origin sentence prefixed to their note, identical variants (fixtures, dialects, prefixes `""`, `rest-`, `dbx-`) in both files, and unique ids: 63 cases, 15 held out. |
| [eval-sets.json](eval-sets.json) | `GET /agents/assistant/evals` on the running web app: 15 sets, `world-cup`, `world-cup-rest` and `world-cup-databricks` at 63 questions, no golden set. |
| [evals-tab-set-list.png](evals-tab-set-list.png), [world-cup-set-last-11-questions.png](world-cup-set-last-11-questions.png) | The Evals tab of the web app: the set list, and the World Cup set opened on its last questions (53 onwards are the former golden set, each with the `run_readonly_sql` and no-tool-errors checks). |
| [validate-world-cup-postgres.txt](validate-world-cup-postgres.txt) | The validator (R110), no model call: 50 of 50 PostgreSQL references of the merged `world-cup` set pass, the 11 merged ones included. |
| [e2e-results.txt](e2e-results.txt) | `frontend/e2e/agents.spec.ts` on the web target: 12 passed. |
| [e2e-before-update.txt](e2e-before-update.txt) | The same spec before the step-7 update, on the same build: 7 passed and 6 failed. Every failure is a count or the removed golden set. Four of them (expecting 12 questions) were already stale since the 40-question slice of 1.1.10 (52 questions), so they would have failed before this change too. |
| [unit-lint-specs.txt](unit-lint-specs.txt) | Backend Jest 1886 passed; eslint 0 errors (8 warnings in untouched files); frontend `ng test` 345 passed; `check-specs.py` all passed; `build:all` exit 0. |

**E2E impact (step 6), Feature Agents (`agents.spec.ts`).** Updated: *Opens an agent… switches between its tabs*, *Offers the configured datasources and starts a run*, *Runs only the ticked questions*, *Separates the question suite from past executions* (63 questions), *Lists every question set, the former golden set inside the World Cup sets* (15 sets, no golden set, the last 11 World Cup questions with their checks). Deleted: *Starts a run of the golden set on the World Cup datasource* (the World Cup run scenario covers it). Re-run as-is: the other six. Each updated assertion fails on the base commit `588a716`, where the World Cup sets hold 52 questions and the Evals tab lists 18 sets.

**Not covered here.** The Features *Question sets from the command line* and *Databricks samples* have no Playwright spec (`E2E: none yet`); the set selection by id is covered by the unit tests in `eval-set-files.spec.ts`. The REST (SQLite) and Databricks references were not re-run: merge-check proves them byte-identical to the golden file's, so their validation status is the same as before the merge. No model eval was run: no agent input (prompt, skills, tools, context, model routing) changed. Desktop not run (web target only).
