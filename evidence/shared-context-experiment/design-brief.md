# Shared-context experiment (approach B) — the contract every unit codes against

Goal: a new Mastra workflow `answer-business-question-shared`, the same graph as
`answer-business-question`, where the large context (each entity's columns,
Read images' notes, the queries with their rows, the earlier attempt's queries)
is published once to a per-run **board** and the agents get a short **index**
plus two tools to read only what they need. Then measure it against the current
workflow with the `insights-analyst` evals (tokens, LLM calls, latency, pass rate).

Experiment only: registered in Mastra (`backend/src/mastra/index.ts`) and run by
an eval target. NOT in `CODE_WORKFLOWS`, no turn-engine wiring, no UI.

## Already written (by the lead) — use, do not rewrite

- `backend/src/mastra/workflows/run-context.ts` (framework-free):
  `RUN_CONTEXT_KEY`, `RUN_CONTEXT_PAGE_CHARS`, `RUN_CONTEXT_ROWS_CAP`, `RUN_CONTEXT_KEYS`
  (`catalog(entity)`, `imageNotes`, `query(n)` 1-based, `earlierQueries`),
  `RunContextBoard` (`write`, `has`, `get`, `remove(prefix)`, `list(prefix)`, `read(key, offset, limit)`, `reads[]`),
  `runContextOf(requestContext)`, `publishCatalog(board, catalog, columns)`,
  `publishImageNotes(board, notes)`, `publishQueries(board, queries)`, `queryEntryContent`,
  `runContextIndexBlock(board, prefixes?, max?)`.
- `backend/src/mastra/tools/run-context.tools.ts`: `list_run_context`, `read_run_context`,
  `RUN_CONTEXT_TOOLS` (a toolset object for `generate/stream({ toolsets: { runContext: RUN_CONTEXT_TOOLS } })`).

## Hard rule: the baseline does not change

`answer-business-question` and its agents must send byte-identical requests and call
options when the shared-context options are absent. Never edit an agent's
instructions (`PLAN_INSTRUCTIONS`, `WRITE_ANSWER_INSTRUCTIONS`, insights-analyst's prompt):
shared-mode guidance goes in the shared request/system blocks only. Adding
`export` to an existing symbol is fine.

## Unit A — shared step prompts and agents (files A owns)

- NEW `backend/src/mastra/workflows/answer-business-question-shared.prompts.ts` (framework-free):
  - `SHARED_CONTEXT_MAX_STEPS = 5` (tool-loop budget of Plan and Write answer in shared mode).
  - `SHARED_CONTEXT_TOOLS_LINE`: one short paragraph telling the agent this run's context is
    on the board, that it has `list_run_context` / `read_run_context`, to read an entity's
    columns before relying on them, that it may call several reads in one step, and that the
    final reply is still the JSON it is asked for.
  - `sharedCatalogIndexBlock(catalog, board): string` = `catalogBlock(catalog)` (no columns),
    a blank line, `runContextIndexBlock(board, ['catalog/', 'image-notes'])`.
  - `sharedPlanRequest(question, catalog, board): string` — like `planRequest` with the index
    block instead of the catalog block and NO inline image notes (they are an index entry),
    then `SHARED_CONTEXT_TOOLS_LINE`. Also `sharedPlanMessages(...)` mirroring `planMessages`
    (conversation before the question, clarification answered) if needed by the agent call.
  - `sharedAnalyseSystemBlocks({ catalog, board, planBlock, hasEarlier, visualFollows }): string[]`
    = [index block (`catalog/`, `image-notes`, `earlier-queries`), planBlock,
       when `hasEarlier` a line pointing at entry `earlier-queries`,
       `SHARED_CONTEXT_TOOLS_LINE` adapted for the analyst (no JSON sentence),
       `ANALYSE_VISUAL_LINE` when `visualFollows`].
  - `sharedWriteAnswerRequest({ question, plan, queries, findings, board, visualFollows })`:
    the question, the plan, a **query index** (per query: n, rationale, outcome facts
    (rows / failed), SQL, column names of its first row — NO rows), the findings as
    `writeAnswerRequest` writes them, `runContextIndexBlock(board, ['queries/', 'image-notes'])`,
    the tools line, the visual line last when `visualFollows`.
- `backend/src/mastra/workflows/answer-business-question.agents.ts` (A may edit):
  `planWithSharedContext(input: { messages, question, catalog, board, answered? }, options)` and
  `writeAnswerWithSharedContext(input: { question, plan, queries, findings, board, visualFollows? }, options & { onText? })`,
  same return types and same guards (`guardedCall`, `planOf`, `answerOf`, `answerWithRowTables`,
  `noteExchange`) as `planWithModel` / `writeAnswerWithModel`, but with
  `toolsets: { runContext: RUN_CONTEXT_TOOLS }`, `toolChoice: 'auto'`, `maxSteps: SHARED_CONTEXT_MAX_STEPS`.
  Refactor shared internals only if the baseline stays identical (prove it with a unit test).
  Check against Mastra 1.66.0 types that `structuredOutput` with `jsonPromptInjection: 'inline'`
  works together with tools and `maxSteps > 1` (`backend/node_modules/@mastra/core/dist/agent/*.d.ts`).
- Tests: `answer-business-question-shared.prompts.spec.ts`; extend `answer-business-question.agents.spec.ts`
  (how it mocks the agents is already there) for the two new functions and a baseline-unchanged test.

## Unit B — the workflow (files B owns)

- `backend/src/mastra/workflows/answer-business-question.workflow.ts`: only add `export` to the steps and
  nested workflows the new top-level chain needs. No other change.
- NEW `answer-business-question-shared.steps.ts` (framework-free):
  `ANSWER_BUSINESS_QUESTION_SHARED_WORKFLOW_ID = 'answer-business-question-shared'`,
  `PUBLISH_RUN_CONTEXT_STEP = { id: 'publish-run-context', title: 'Publish run context' }`,
  pure `publishRunContext(board, { catalog, columns, imageNotes })` (calls `publishCatalog` and `publishImageNotes`).
- NEW `answer-business-question-shared.workflow.ts`: `answerBusinessQuestionSharedWorkflow`, the same chain as
  `answerBusinessQuestionWorkflow` with `publishRunContextStep` right after `loadCatalogStep`
  (input and output = Load catalog's output schema, passed through unchanged; it reads the board with
  `runContextOf(requestContext)` and throws `The run context is missing` when absent). Same options
  (`validateInputs`, `shouldPersistSnapshot`). The runtime stays `ANSWER_BUSINESS_QUESTION_RUNTIME_KEY`.
- Register under its id in `workflows` of `backend/src/mastra/index.ts`.
- Test `answer-business-question-shared.workflow.spec.ts` with the stub
  (`jest.mock('@mastra/core/workflows', () => jest.requireActual('../testing/workflows.stub'))`), modelled on
  `answer-business-question.workflow.spec.ts`: a run with a stub runtime completes, Publish run context
  fills the board (catalog entries, image notes), and a run without a board fails with the message.
  Check no existing test asserts that every registered workflow is in `CODE_WORKFLOWS`; if one does, report it.

## Unit C — the eval target and set (files C owns)

- `backend/src/mastra/evals/insights-analyst-workflow-target.ts`: `workflowTurnAgent(agent, given?, mode: 'baseline' | 'shared' = 'baseline')`.
  Shared mode: the shared workflow; a fresh `RunContextBoard` per case set on the case's requestContext
  under `RUN_CONTEXT_KEY` before the run; `runtime.plan` → `planWithSharedContext`; `runtime.analyse` →
  publish image notes and (on a retry) the earlier block to the board, then `agent.generate` with
  `context` = `sharedAnalyseSystemBlocks(...)` and `toolsets: { runContext: RUN_CONTEXT_TOOLS }`;
  `runtime.writeAnswer` → `publishQueries(board, queries)` then `writeAnswerWithSharedContext`.
  The judge keeps reading the full catalog block (`judgeContext`), so both variants are judged on the same facts.
  Record in the case's eval details the board's reads (`board.reads`) so the report can count them.
- A new set `insights-analyst-shared-context` (agentKey `insights-analyst`, same fixture, the same cases with ids
  prefixed `shared-`, same checks and judge) on a new target id `insights-analyst-shared-context`
  registered in `EVAL_TARGET_FACTORIES` (`eval-sets.ts`). The baseline set and target stay as they are.
- Tests: extend `insights-analyst-workflow-target.spec.ts` and the eval-set tests that enumerate sets.
- CLI: `EVAL_SET=insights-analyst-shared-context` must run it (`run-assistant-evals.ts`).

## Unit D — measurement (files D owns; no backend code)

- NEW `scripts/llm-meter-proxy.mjs` + `scripts/llm-meter-proxy.test.mjs` (node:test, like the other `scripts/*.test.mjs`).
- NEW `scripts/compare-shared-context.mjs` + test.
- Details in D's brief.

## Rules for every unit

- Work in the lead's worktree directly (no new worktree, no branch, NO commit).
- Edit only the files your unit owns; other units edit the rest at the same time. Edit/Write tools only, never sed or scripted replaces.
- Check with `npx jest <your spec files> --silent > <your scratch>/jest.log 2>&1` and
  `npx tsc --noEmit -p tsconfig.json` in `backend/` (ignore errors in files you do not own; the one in
  `datasets.service.spec.ts` is pre-existing). Never run `nest build`, `npm run build*`, the app, evals or Playwright.
- `npx eslint <your changed files>` (never `npm run lint`), `npx prettier --write <your files>`.
- Scratch files only under `.context/shared-context/<unit letter>/`. Never kill a process you did not start.
- If a build or budget blocks you, report it; do not change build config.
- Report: files changed, tests added and their result, anything in the contract you had to change and why.
