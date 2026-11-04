# 1.1.4 — E2E impact analysis (BA-182, Step 1a)

Workflow step 6 for roadmap 1.1.4: the eval questions move from TypeScript into question bank files with a validating loader, a validator and a set option on the eval CLI; the golden-set harness is retired. Rules: [agents-evals](../../specs/capabilities/agents-evals/spec.md) R11 (now four sets), R42, R63-R67.

## What the change touches

| Component | Change | E2E-visible effect |
|---|---|---|
| Eval set definitions (`backend/src/mastra/evals/`) | Read from `sets/*.json` by a loader instead of TypeScript constants | The Evals tab lists a fourth set, `world-cup-golden` ("World Cup (golden set)", 11 questions). The three existing sets keep their ids, names, case ids, questions, intents and checks. |
| `GET /agents/:key/evals` (`agents.service.ts`) | Same shape, built from the loaded sets | One more entry in `sets`. |
| Run start (`POST /agents/:key/evals/run`, preflight) | Same logic; the set's fixture now comes from its variant | None for the existing sets; the golden set runs on the World Cup PostgreSQL sample. |
| Eval CLI (`npm run evals:assistant`) | Gains `EVAL_SET` | Not in Playwright (command line). |
| Validator (`npm run eval:validate`) | New | Not in Playwright (command line). |
| `backend/eval/`, `scripts/run-eval.ts`, `npm run eval` | Removed | None; no E2E used them. |
| Frontend | No change | The Evals tab renders whatever sets the endpoint returns (`eval-set-<set id>`, `eval-case-<case id>`). |

## Collisions checked

- `grep` of `frontend/e2e/` for `eval-set-`, `eval-case-`, `World Cup`, `Formula 1`, `questions`: every set-level assertion is in `agents.spec.ts` and targets the `world-cup` set (lines 14, 70-73, 84, 87-88, 136, 142, 156-171, 241, 254, 257).
- `getByTestId('eval-set-world-cup')` matches the test id exactly, so the new `eval-set-world-cup-golden` (like the existing `eval-set-world-cup-rest`) cannot match it.
- `[data-testid^="eval-case-"]` counts only the rows of the open set (R13), so opening `world-cup` still shows 10.
- `[data-testid^="eval-set-"]` matches only the set buttons: the frontend has no other test id starting with `eval-set-` (`agent-detail.html` line 482 is the only one; `eval-select-*` lacks the `-set-` prefix).
- Check chip text is the Mastra helper description: `calledTool('run_readonly_sql')` reads `Checks that "run_readonly_sql" was called`, `noToolErrors()` reads `Checks that no tool calls resulted in errors`. Neither the result-set match nor the judge is listed before a run (api.md endpoint 35), so the golden rows are asserted on those two chips only.
- The contract did not fix the golden case ids (the file in progress names the two answer-quality cases `pass-completion-by-team` and `yellow-card-share`), so the new test matches golden questions by text, not by `eval-case-<id>`; renaming a case id does not break it, changing a question's wording does.

## Decision per scenario

### agents-evals — Feature "Agents" (`frontend/e2e/agents.spec.ts`)

| Scenario | Decision | Why |
|---|---|---|
| Opens an agent from the Agents list and switches between its tabs | Re-run as-is | Asserts `eval-set-world-cup` with "10 questions" and 10 rows when open; the exact test id and the open-set count are unaffected by the fourth set. |
| Shows the stateless, no-tool agents accurately | Re-run as-is | R10 unchanged: only the assistant has sets. |
| Offers the configured datasources and starts a run from the evals tab | Re-run as-is | `world-cup` still has 10 questions on the World Cup PostgreSQL fixture; "Run 10 selected", "0/10 done" hold. Guards the move against a lost case. |
| Runs only the ticked questions | Re-run as-is | Case ids `champion-2022` and `shootouts` are unchanged (the World Cup variant has no prefix). |
| Refuses to run against a datasource with no datasets | Re-run as-is | R19 step 4 unchanged. |
| Explains an incomplete eval dataset without starting a run | Re-run as-is | R20 unchanged; the fixture now comes from the variant, the required entities from the same registry. |
| Opens a question in the right panel with what it is scored on | Re-run as-is | Guards "no change in behaviour" of the move: intent "Single-hop lookup…" and the chip `Checks if output includes "Argentina"` must survive the TypeScript-to-JSON move. |
| Separates the question suite from past executions | Re-run as-is | Counts are of the open `world-cup` set (10). |
| Downloads an execution as a Markdown report | Re-run as-is | Report format unchanged (R38). |
| Lists every question set, the golden set among them | **Add** | New: the tab lists exactly 4 sets with their names and counts, "World Cup (golden set)" shows "11 questions", and its 11 rows include a golden-set question and an answer-quality question, each with the two scorer chips (R11, R63, R65). |
| Starts a run of the golden set on the World Cup datasource | **Add** | New: the golden variant is bound to the World Cup PostgreSQL sample, so the World Cup saved scope passes its preflight and the run starts ("Run 11 selected", "0/11 done"; R19, R20, R65). |

### agents-evals — Feature "Question sets from the command line" (new, `E2E: none yet`)

| Scenario | Decision | Why |
|---|---|---|
| Validates a question set without a model | **Add** (backend unit test) | Command line, not the app. Covered by `backend/src/mastra/evals/validate-eval-sets.spec.ts` (R66). |
| A broken reference query fails the validator, naming the case | **Add** (backend unit test) | Same file; the "one reference broken on purpose" acceptance of 1.1.4. |
| The validator stops at the dataset preflight | **Add** (backend unit test) | Same file; R66 with R20. |
| Refuses a question bank file with an incomplete case | **Add** (backend unit test) | The loader's unit tests beside it in `backend/src/mastra/evals/` (R64). |
| Runs one set from the command line | **Add** (backend unit test) | The set option of R67; a full CLI run needs a model, so the unit test covers the selection and the refusal without `EVAL_SET`. |

### agents-evals — other Features

| Feature / scenario | Decision | Why |
|---|---|---|
| Agent Hub (`agent-hub.spec.ts`), all nine | Re-run as-is | Never open the Evals tab. |
| Agent editor (`agent-editor.spec.ts`), all eight | Re-run as-is | Never open the Evals tab. |
| Agents and evals behaviour not yet covered by Playwright (`E2E: none yet`): Runs the Formula 1 set…; Refuses a REST set on a PostgreSQL datasource; the others | Re-run as-is (no E2E) | Behaviour unchanged; the Formula 1 and REST sets now come from files with the same ids and counts. |
| Agent definitions (API) (`backend/test/user-agents.e2e-spec.ts`) | Re-run as-is | Not about evals. |

### Other capability specs

| Feature / scenario | Decision | Why |
|---|---|---|
| admin — "Each private collection is isolated between two users" (`backend/test/owner-isolation.e2e-spec.ts`) | Re-run as-is | Writes an `eval_runs` document directly (`caseIds: []`); does not read the sets. |
| admin — permission table (`backend/test/org-auth.e2e-spec.ts`, `GET /agents/assistant/evals` needs `use-agents`) | Re-run as-is | Route and shape unchanged. |
| testing-data | Not impacted | No scenario starts an eval; the fixture registry is unchanged. |

## Status of the E2E change (step 7)

- `frontend/e2e/agents.spec.ts` gains the two **Add** tests above; every existing assertion is kept.
- Not run here: no build was allowed while the baseline eval runs from `backend/dist`. `tsc -p frontend/e2e/tsconfig.json --noEmit` passes.
- Expected failure until the backend lands: "lists every question set…" fails on the set count (3, not 4) and on the missing `eval-set-world-cup-golden`; "starts a run of the golden set…" fails on the missing `eval-set-world-cup-golden`.
- Desktop: not run (web target only, per the Test target convention).
