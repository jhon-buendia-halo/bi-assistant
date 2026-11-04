# 1.1.20 (BA-242) — E2E impact analysis (workflow step 6)

Story: the supervised eval improvement loop, Phase 1 tooling (agents-evals R209 to R230), from commit `8a6f53a` on. Written on 2026-10-22 in the acceptance gate, before the Playwright edits of step 7.

What BA-242 changed that a Playwright spec can see (all in the agent's Evals tab, `agent-detail.html`, `eval-run-summary.html`, `eval-trace.html`, `eval-run.util.ts`):

- the open set's run controls gain the **Repeats** select (`eval-repeats`, R214), and the start request carries `repeats` (R19, R209);
- each held-out question row gains the chip `held-out` (`eval-split-<case id>`, R215);
- each execution gains `Repeat <k>` (`eval-run-repeats-<job>`), `<n> flaky` (`eval-run-flaky-<job>`) and its cost or `Not priced` with a title (`eval-run-cost-<job>`); expanded, the split line (`eval-run-splits-<job>`), the By category columns Dev, Held-out, Flaky, Not scored and Total (the Passed and Failed columns are removed), and on each result row the `held-out` chip (`eval-run-result-split-<job>-<case id>`) and `<passes>/<k>` (R152, R216);
- the Details panel gains the split (`eval-trace-split`), the attempts (`eval-trace-attempts`), the tokens per agent (`eval-trace-tokens-<agent>`) and the cost (`eval-trace-cost`) (R217);
- the Markdown report gains the Repeats, Dev, Held-out, Flaky, Tokens and Cost lines (R218).

Baseline before the step-7 edits (this worktree's build of `8ae3849`, web target): 11 passed, 1 failed (scenario 12, on the removed By category columns).

## Feature: Agents (`frontend/e2e/agents.spec.ts`)

| # | Gherkin scenario | Test (line at base) | Decision | Why |
|---|---|---|---|---|
| 1 | Opens an agent from the Agents list and switches between its tabs | `opens an agent…` (208) | **Update** | Gherkin changed: `champion-2022` shows "lookup" and no "held-out" chip; `shot-conversion-2022` shows the chip "held-out" (R215). The test passed at base but asserted neither. |
| 2 | Shows the stateless, no-tool agents accurately | `shows the stateless…` (302) | Re-run as-is | No BA-242 change on a System agent's tabs. |
| 3 | Offers the configured datasources and starts a run from the evals tab | `offers the configured datasources…` (326) | Re-run as-is | The Repeats select sits beside the run button and the request carries `repeats: 1`; the Gherkin asserts neither. |
| 4 | Runs only the ticked questions | `runs only the ticked questions` (355) | Re-run as-is | Ticks and Select all unchanged. |
| 5 | Refuses to run against a datasource with no datasets | `refuses to run…` (387) | Re-run as-is | R19 step 9 (repeats) comes after the dataset checks. |
| 6 | Explains an incomplete eval dataset without starting a run | `explains an incomplete eval dataset…` (404) | Re-run as-is | Preflight unchanged. |
| 7 | Opens a question in the right panel with what it is scored on | `opens a question in the right panel…` (424) | Re-run as-is | The panel's not-run state is unchanged; the split, attempts, tokens and cost show only on a result (R217). |
| 8 | Separates the question suite from past executions | `separates the question suite…` (453) | Re-run as-is | Its locator `[data-testid^="eval-run-"]` now also matches the new `eval-run-repeats-`, `-flaky-`, `-cost-`, `-splits-` and `-result-split-` ids, but those sit inside the run card, which stays first in DOM order. |
| 9 | Downloads an execution as a Markdown report | `downloads an execution…` (485) | **Update** | Gherkin changed: the report contains "Repeats: 1", "Dev:", "Held-out:" and "Cost:" (R218). |
| 10 | Lists every question set, the former golden set inside the World Cup sets | `lists every question set…` (554) | Re-run as-is | Set names and counts unchanged by BA-242. |
| 11 | Runs with the judge off by default | `runs with the judge off by default` (597) | Re-run as-is | The start request now also carries `repeats`; the test matches `{ judge: 'off' }` with `toMatchObject`. Its seeded run has no repeats, usage or split, so it reads as a run saved before BA-242. |
| 12 | Reports pass rate by category | `reports pass rate by category` (654) | **Update** (red at base) | Gherkin changed: the By category columns are Category, Dev, Held-out, Flaky, Not scored and Total; "lookup" shows "1/1" with its interval under Dev and "—" under Held-out (R152, R216). The seeded run stores no split, so the cells also prove the split is read from the question bank on read (R215) and the intervals computed on read (R212, R213). |
| 13 | Runs every question three times when Repeats is 3 | — | **Add** | New scenario (R209, R214). |
| 14 | Shows dev and held-out side by side, with repeats, flaky questions and cost | — | **Add** | New scenario (R211, R213, R216, R217, R221). |
| 15 | Says "Not priced" for a model with no price | — | **Add** | New scenario (R216, R217, R221). |

No scenario is deleted.

### How the new and updated scenarios get their state

- 13 starts a real run, as 3 and 11 do, with the LLM stub (`startLlmStub`, `saveLenaiSettings`) holding the first model call open (`stub.hold`), so the run is still going when the test checks that the Repeats select is disabled. Without the stub, whether the run is still going at that moment depends on how fast its questions fail without a model.
- 14 and 15 seed a finished run straight into `app.sqlite`, as 11 and 12 do (`appSql`): a run that reaches its end needs a model, which the suite does not have (spec *Flows*). The seeds are stored without a summary, so the split line, the By category cells and the run's flaky count are computed on read. Their costs and intervals were computed with the backend's own built code (`foldAttempts`, `costUsdOf`, `sumCostUsd`, `mergeUsage`, `ratesUsed`, `wilson95` from `backend/dist/mastra/evals/`), not by hand.
- 14 also runs the file's axe scan (both themes) on the expanded run with the Details panel open, as 12 does for the BA-184 parts; that scan is not a Gherkin step.

## Helpers and selectors the changed scenarios use

Retrospective lesson of 2026-10-14 (BA-211): grep the helpers for copy and test ids the change removed. BA-242 removed the By category table's `Passed` and `Failed` column headers and cells (`eval-run-summary.html`) and the four-argument `startEvalRun` call; it removed no test id.

| Helper or selector | Where | Used by | Touches removed copy or ids? |
|---|---|---|---|
| `openWorldCupSet`, `CASE_ROWS`, `isRunStart` | `agents.spec.ts` | 1, 9, 12, 13 | No. `CASE_ROWS` excludes `eval-case-category-`; the new `eval-split-` chips do not start with `eval-case-`, so the count of 63 stands. |
| `seededCheck`, `seededResult`, `seedFinishedRun` | `agents.spec.ts` | 11, 12 (and 14, 15 build on the first two) | No. The seed has no repeats, usage or split, by design (a run saved before BA-242). |
| `axeViolations` | `agents.spec.ts` | 12, 14 | No. |
| `createWorldCupDatasource`, `createWorldCupDataset`, `followOsTheme`, `WORLD_CUP_DATASET` | `helpers/app-actions.ts` | 9, 12, 13, 14 | No. |
| `appSql` | `helpers/app-db.ts` | 12, 14, 15 | No. |
| `saveLenaiSettings` | `helpers/agents-api.ts` | 1, 13 | No. |
| `startLlmStub` (`hold`) | `helpers/llm-stub.ts` | 1, 13 | No. |
| `test`, `appDataDir`, `page` | `fixtures/app.fixture.ts` | all | No. |

`grep -rn -e "'Passed'" -e "'Failed'" -e 'By category' -e 'eval-run-summary' -e 'held-out' -e 'Repeats'` over `frontend/e2e/helpers` and `frontend/e2e/fixtures` finds nothing. Only `agents.spec.ts` touches the Evals tab; no other spec file references an `eval-` test id.

## Other Features of agents-evals

BA-242 changed no scenario of "Agent Hub", "Agent skills", "Agents and evals behaviour not yet covered by Playwright", "Agent editor", "Skill library", "Built-in agent prompts", "Agent definitions (API)", "Question sets from the command line" or "Databricks samples". Their specs need no edit for this story.

## Outside agents-evals: re-run candidates

BA-242's loop rounds also changed what a chat turn sends: `context-blocks.ts` (every entity's columns and types in the orientation block, `0f576df`), `knowledge.service.ts` (the 7,000-character knowledge block, `5fb5660`), `sessions.service.ts`, `visualization.service.ts` (usage recording) and the Finance knowledge seed. No E2E spec asserts the orientation block's text; `assistant-skills.spec.ts` and `agent-sessions.spec.ts` assert where the knowledge block sits among the system messages, and the recording-stub chat specs (`agent-panel`, `chat-and-visuals`, `designer-skills`, `visual-tailoring`) drive the changed services. They are **re-run as-is** candidates for step 9; this step-7 pass covers `agents.spec.ts` only.

## Behaviour the spec states with no Gherkin step

Listed for the specs owner; no spec text was written here.

- R214 / R26: the progress line's ` · attempt <a>/<k>` while a question runs on a run with Repeats above 1.
- R216: the cost's title `No price for <models>` on a `Not priced` run (scenario 15 asserts it anyway, as part of "the run shows Not priced"); no `Repeat <k>`, no flaky count and no cost on a run saved before BA-242; the `held-out` result-row chip on a run with Repeats 1.
- R217: `Checks, steps and answer below are from attempt <r>.`, one line per attempt, `<n> calls reported no usage`, and a pre-BA-242 result showing its split and none of the rest.
- R218: the report's `Flaky:` and `Tokens:` lines, the `## Summary` table's Split column and ` <passes>/<k>`, each question's `**Split:**`, `**Attempts:**`, `**Tokens:**` and `**Cost:**` lines, `Cost: not priced (<models>)`, and `Note: the previous run used Repeats <k>.`.
- R209: the refusal `Repeats must be 1, 3 or 5 (got "<value>")` (API only; the select offers 1, 3 and 5).
- R222, R223 (`EVAL_REPEATS`, `EVAL_SPLIT`, `EVAL_CATEGORY`, a command-line run saved with source `cli`) and R225 to R230 (`eval:diff`, `eval:export-failures`, `eval:leak-check`): command-line only, with no scenario in "Question sets from the command line" or elsewhere; the Acceptance section names them.

## Step 7 results (2026-10-22)

Applied to `frontend/e2e/agents.spec.ts`: scenarios 1, 9 and 12 updated; 13, 14 and 15 added; new helpers `storeRun`, `usageEntry`, `seededAttempt`, `seedRepeatsRun` and `seedUnpricedRun` (the old `seedFinishedRun` now stores through `storeRun`). No helper under `frontend/e2e/helpers/` or `fixtures/` changed.

Checks, from `frontend/`, on this worktree's build of `8ae3849` (`npm run test:e2e:prepare`), with `E2E_SKIP_DOCKER=1` so the already-running compose Postgres on 55432 was used and not recreated:

| Command | Result |
|---|---|
| `npx tsc --noEmit -p e2e/tsconfig.json` | clean |
| `npx playwright test --list e2e/agents.spec.ts` | 15 tests per project |
| `npx playwright test --project=web e2e/agents.spec.ts` | 15 passed (twice) |
| the same, `-g "Repeats is 3\|dev and held-out side by side\|Not priced" --repeat-each=3` | 9 passed |
| the new `agents.spec.ts` against a build of the base `7176755` (a `git archive` copy) | 9 passed, 6 failed: exactly 1, 9, 12, 13, 14 and 15, each on the BA-242 assertion (no `eval-split-shot-conversion-2022` chip; no `Repeats: 1` line; the old By category columns; no Repeats select; no `Repeat 3` chip; no `Not priced` cost) |
| re-run as-is: `assistant-skills`, `agent-sessions`, `agent-panel`, `chat-and-visuals`, `designer-skills`, `visual-tailoring` | 34 passed; the screenshots they rewrote under `evidence/1.14.17/` and `evidence/1.14.18/` were restored with `git checkout` |

Desktop not run (web target only, as the Test target convention says).
