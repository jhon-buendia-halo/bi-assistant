# 1.1.23 (BA-245) — E2E impact analysis (workflow step 6)

Story: cover with Gherkin and tests the agents-evals behaviour that BA-242 shipped with no scenario, the list in [evidence/1.1.20/e2e-impact.md](../1.1.20/e2e-impact.md), section "Behaviour the spec states with no Gherkin step". Written on 2026-10-23 from the epic branch at `05d28f8`. No production code changes: the story adds Gherkin to [specs/capabilities/agents-evals/spec.md](../../specs/capabilities/agents-evals/spec.md), Playwright scenarios to `frontend/e2e/agents.spec.ts` and three backend unit tests under `backend/src/mastra/evals/loop/`. No rule's meaning changed; each new or changed scenario cites its rules in a Gherkin comment line (`# R…`) above it.

## Feature: Agents (`frontend/e2e/agents.spec.ts`)

| # | Gherkin scenario | Test (line) | Decision | Why |
|---|---|---|---|---|
| 1 | Opens an agent from the Agents list and switches between its tabs | 596 | Re-run as-is | Unchanged. |
| 2 | Shows the stateless, no-tool agents accurately | 698 | Re-run as-is | Unchanged. |
| 3 | Offers the configured datasources and starts a run from the evals tab | 722 | Re-run as-is | Unchanged. |
| 4 | Runs only the ticked questions | 751 | Re-run as-is | Unchanged. |
| 5 | Refuses to run against a datasource with no datasets | 783 | Re-run as-is | Unchanged. |
| 6 | Explains an incomplete eval dataset without starting a run | 800 | Re-run as-is | Unchanged. |
| 7 | Opens a question in the right panel with what it is scored on | 820 | Re-run as-is | Unchanged. |
| 8 | Separates the question suite from past executions | 849 | Re-run as-is | Unchanged. |
| 9 | Downloads an execution as a Markdown report | 881 | Re-run as-is | Unchanged; the new report lines are asserted on seeded runs in 15, 17 and 18, where their values are fixed. |
| 10 | Lists every question set, the former golden set inside the World Cup sets | 962 | Re-run as-is | Unchanged. |
| 11 | Runs with the judge off by default | 1005 | Re-run as-is | Unchanged; its seed `seedFinishedRun` is also the earlier run of 17. |
| 12 | Reports pass rate by category | 1062 | Re-run as-is | Unchanged. |
| 13 | Runs every question three times when Repeats is 3 | 1153 | Re-run as-is | Unchanged; 16 covers the progress line. |
| 14 | Shows dev and held-out side by side, with repeats, flaky questions and cost | 1203 | **Update** | Gherkin changed: one line per attempt with its verdict and duration, `Checks, steps and answer below are from attempt 2.`, and "Why it failed" from attempt 2 (R211, R217). The Given now says which attempt failed. |
| 15 | Says "Not priced" for a model with no price | 1305 | **Update** | Gherkin changed: the cost's title `No price for <model>` (R216; the test already asserted it), `1 call reported no usage` in the Details panel (R217, R219), and the report's `Cost: not priced (<model>)` and `Tokens: … · 3 calls · 1 without usage` (R218, R221). Its seed now has one call without usage. |
| 16 | Shows which attempt of a question is running when Repeats is 3 | 1351 | **Add** | R26, R210, R214: the progress line's ` · attempt <a>/<k>`. |
| 17 | Downloads the report of a command-line run with Repeats 3, compared with a run of Repeats 1 | 1391 | **Add** | R218 (`Flaky:`, `Tokens:`, the `## Summary` Split column and ` <passes>/<k>`, each question's `**Split:**`, `**Attempts:**`, `**Tokens:**` and `**Cost:**`, `Note: the previous run used Repeats <k>.`), R40, R41, and R223 (a run with the source `cli` is listed and downloadable by an app on the same data directory). |
| 18 | Shows a run saved before repeats and costs with its splits and nothing it did not record | 1451 | **Add** | R216 (no `Repeat <k>`, flaky count or cost on a pre-BA-242 run; the `held-out` result-row chip on a Repeats 1 run, with no `<passes>/<k>`), R217 (its split and none of the rest), R215 (the split read from the question bank), R218 and R221 (`Repeats: 1`, `Tokens: not recorded`, `Cost: not recorded`). |
| 19 | Refuses repeats other than 1, 3 or 5 from the API | 1524 | **Add** | R19 step 9, R209: `Repeats must be 1, 3 or 5 (got "<value>")` for `2`, `"3"` and `true`, through the real endpoint, with no run recorded. |

No scenario is deleted.

### How the new and updated scenarios get their state

- **16** starts a real run with the LLM stub (`startLlmStub`, `saveLenaiSettings`), as 13 does, but its `hold` answers the run's first model call and holds every later one. An attempt with the stub's text answer makes exactly one model call (the assistant's generate; no tool call, so no tool-only synthesis, and the judge is off), so the first attempt of `champion-2022` finishes and the second is the call held: the progress line reads `0/63 done · 0 passed · attempt 2/3`, and the test also checks the stub saw exactly two calls. This is deterministic: no real model, and the only wait is for one attempt's checks (its reference query runs on the compose Postgres) and the 1.5-second poll. No component-level fallback was needed; the frontend unit test `agent-detail.spec.ts` "disables Repeats while a run is in flight and shows its attempt" covers the same line on a stubbed poll.
- **17** seeds two runs straight into `app.sqlite` (`appSql`), as 11, 12, 14 and 15 do: the earlier `seedFinishedRun` (no repeats, so Repeats 1) and `seedRepeatsRun` with `source: 'cli'` and a `comparison` naming the earlier run. The report's figures are the stored usage and costs of 14's seed, summed by the backend's own `tokensText` and `costText`: 35,410 in (15,360 cached), 1,325 out, 17 calls; $0.004954 over 2 questions, `$0.0050 · $0.0025 per question`.
- **18** seeds a run in the shape runs had before BA-242 (`seedBeforeRepeatsRun`): no repeats, model, source, usage or cost on the run, and no split, attempt counts, usage or cost on its results. The split line and the `held-out` chip come from the read-time defaults (data-model 3.8).
- **19** creates the datasource and the full World Cup dataset through the UI (as 3 and 9 do), reads the datasource id from `GET /datasources`, and posts to `POST /agents/assistant/evals/run` with `apiJson` (`helpers/api.ts`; the app has no authentication). It then checks `GET /agents/assistant/evals/runs` is empty and the Executions sub-tab says "No eval runs yet".

## Helpers and selectors the changed scenarios use

Retrospective lesson of 2026-10-14 (BA-211): list the helpers with the scenarios. No production copy or test id changed, so no helper can be stale.

| Helper | Change | Used by |
|---|---|---|
| `usageEntry` | gains an optional `unreportedCalls` (default 0) | 14, 15, 17 (callers unchanged) |
| `seedRepeatsRun` | gains optional `source` (default `'app'`) and `comparedWith` | 14 (defaults, unchanged), 17 |
| `seedUnpricedRun` | one of its three calls reports no usage | 15 only |
| `seedBeforeRepeatsRun` | new | 18 |
| `downloadReport`, `openAssistantExecutions` | new | 15, 17, 18; 17, 18, 19 |
| `seedFinishedRun`, `storeRun`, `seededResult`, `seededCheck`, `seededAttempt`, `openWorldCupSet` | unchanged | 11, 12, 16, 17, 18 |
| `apiJson` (`helpers/api.ts`) | unchanged, newly imported | 19 |
| `startLlmStub` (`hold`), `saveLenaiSettings` | unchanged | 16 |

No file under `frontend/e2e/helpers/` or `fixtures/` changed.

## Feature: Question sets from the command line (E2E: none yet; backend unit tests)

| Gherkin scenario | Decision | Covered by |
|---|---|---|
| Validates a question set without a model, … Chooses the judge option from the command line (6 scenarios) | Re-run as-is | unchanged |
| Refuses bad repeats, a bad split or category, or a filter that leaves no question (R209, R222) | **Add** | `run-assistant-evals.spec.ts` "refuses … before the backend boots" (5 cases) and "refuses a set the split leaves empty, naming the set"; `repeats-option.spec.ts`; `eval-cli-selection.spec.ts` |
| Repeats each question and narrows the set from the command line (R154, R211, R222) | **Add** | `run-assistant-evals.spec.ts` "runs the narrowed selection through the run service, prints the lines and writes the run file" |
| Saves a command-line run like a run started in the app (R40, R41, R218, R223) | **Add** | `run-assistant-evals.spec.ts` "prints the comparison as the report writes it, noting other repeats, …" and "writes relative run files where npm was started (INIT_CWD), …"; `eval-runs.service.spec.ts` "saves the run with the source cli and the datasource of the named datasets, and waits for it"; the last step by Agents scenario 17 |

These existed and already proved the behaviour with the real entry point `main` (no backend boot, no model); the story adds the scenarios only.

## Feature: Improvement loop tools (new; E2E: none yet; backend unit tests)

| Gherkin scenario | Decision | Covered by (`backend/src/mastra/evals/loop/`) |
|---|---|---|
| Compares the runs before and after a change with eval:diff (R224 to R226) | **Add** | `eval-diff.spec.ts` "reads both sides by 8-character prefix without writing, and exits 0 when the accept rule is met" (**new**: `evalDiffMain` on an `app.sqlite` in a temp data dir, the rows, flips, one-side questions and costs, the database byte for byte unchanged), "eval:diff rows", "eval:diff flips, sides, cost and warnings"; `run-source.spec.ts` |
| Warns when the two sides cannot be compared, and drafts the round's records (R226) | **Add** | `eval-diff.spec.ts` "warns when sets, model, repeats or judge differ, …", "eval:diff drafts", "exits 0 without --target, and prints the --tsv row" |
| Checks the accept rule for the target categories (R227) | **Add** | `eval-diff.spec.ts` "the accept rule" (5 tests), "evalDiffMain exit codes", and the new test above (rule met through `evalDiffMain`, exit 0) |
| Refuses a run it cannot read (R224, R225) | **Add** | `run-source.spec.ts` "refuses a prefix that matches several runs, and an unknown id", "refuses anything else", "reads a value that names a file as a file, …"; `eval-diff.spec.ts` "combines the runs of a side and refuses a question in two of them", "exits 2 on a bad argument, a missing run or an unknown category"; `cli-args.spec.ts` |
| Exports a run's dev failures for the fixer, with only the counts of the held-out questions (R224, R228) | **Add** | `failure-export.spec.ts` (7 tests) and "exports a run saved in app.sqlite before splits, taking each split from the question bank (R224)" (**new**: `exportFailuresMain` on a pre-BA-242 run of real World Cup cases; the held-out case is kept out only because its split is read from the bank, and the dev case's notes and reference query are not written) |
| Rejects a lever change that quotes a question bank (R229, R230) | **Add** | `leak-check.spec.ts` "leakCheckMain against a git repository" (3 tests) and "rejects a held-out question, and with --fixer names no held-out case" (**new**: a held-out question of the real World Cup bank, `--json` sources and `--fixer` redaction), "leak check report" |
| Lets through what is not a leak (R229, R230) | **Add** | `leak-check.spec.ts` "leak check false-positive guards" (7 tests), "only warns on a string literal of a reference query"; `common-words.spec.ts` |

## Behaviour from the 1.1.20 list, and where each is covered

| Behaviour (1.1.20 list) | Scenario | Test |
|---|---|---|
| R214 / R26 ` · attempt <a>/<k>` on the progress line | Agents 16 | `agents.spec.ts:1351` |
| R216 cost title `No price for <models>` | Agents 15 | `agents.spec.ts:1305` |
| R216 no `Repeat <k>`, flaky count or cost on a pre-BA-242 run | Agents 18 | `agents.spec.ts:1451` |
| R216 `held-out` result-row chip on a Repeats 1 run | Agents 18 | `agents.spec.ts:1451` |
| R217 `Checks, steps and answer below are from attempt <r>.` and one line per attempt | Agents 14 | `agents.spec.ts:1203` |
| R217 `<n> calls reported no usage` | Agents 15 | `agents.spec.ts:1305` |
| R217 a pre-BA-242 result shows its split and none of the rest | Agents 18 | `agents.spec.ts:1451` |
| R218 `Flaky:`, `Tokens:`, Summary Split column and ` <passes>/<k>`, `**Split:**`, `**Attempts:**`, `**Tokens:**`, `**Cost:**`, `Note: the previous run used Repeats <k>.` | Agents 17 (and 18 for the not-recorded forms) | `agents.spec.ts:1391`, `:1451` |
| R218 `Cost: not priced (<models>)` | Agents 15 | `agents.spec.ts:1305` |
| R209 `Repeats must be 1, 3 or 5 (got "<value>")` (API) | Agents 19 | `agents.spec.ts:1524` |
| R222 `EVAL_REPEATS`, `EVAL_SPLIT`, `EVAL_CATEGORY` | Command line: "Refuses bad repeats, …", "Repeats each question and narrows …" | `run-assistant-evals.spec.ts` |
| R223 a command-line run saved with source `cli` | Command line: "Saves a command-line run like a run started in the app"; Agents 17 | `eval-runs.service.spec.ts`, `run-assistant-evals.spec.ts`, `agents.spec.ts:1391` |
| R225 to R227 `eval:diff` | Loop tools: the first four scenarios | `eval-diff.spec.ts`, `run-source.spec.ts`, `cli-args.spec.ts` |
| R228 `eval:export-failures` | Loop tools: "Exports a run's dev failures …" | `failure-export.spec.ts` |
| R229, R230 `eval:leak-check` | Loop tools: the last two scenarios | `leak-check.spec.ts`, `common-words.spec.ts` |

## Gaps and notes

- No behaviour of the list is left without a scenario and a passing test, and none needed a production change or a test hook.
- Not covered by a new test (not in the 1.1.20 list): the report leaves out the repeats note when the compared run has been deleted (R218); `eval-report.spec.ts` covers the note itself.
- The new and updated Playwright scenarios were not run against a build from before BA-242: this story adds tests for behaviour already on the epic branch, and 1.1.20's step 7 already showed 13 to 15 red on the base `7176755`. Each new assertion checks a fixed value (a line, a count, a test id present or absent) that the pre-BA-242 build does not render.
- Desktop not run (web target only, as the Test target convention says).
- Found while writing the leak-check test: the held-out question `shot-conversion-2022` shares four-word runs with dev questions (such as `shot-accuracy-by-team-2022`), so the text report prints a dev case as the first source, `(and 6 more)` after it. That is R230 as written (dev sources first); the test reads the held-out source from `--json`, and checks `--fixer` prints no held-out case id.

## Step 7 and 9 results (2026-10-23)

Commands and counts: [checks.txt](checks.txt) and [e2e-results.txt](e2e-results.txt).
