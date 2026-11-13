# Mastra workflows — reference

Longer material for the [`mastra-workflows`](SKILL.md) skill: the docs pages to read, an API cheat-sheet checked against the installed `@mastra/core` 1.66.0, where the docs and 1.66.0 disagree, and the inventory of what the app already has.

**Everything here is a snapshot of 2026-11-13.** The docs describe Mastra's latest release, not the pinned one, and the folders change. Re-read the pages and re-list the folders every time; use this file to know what to look for, not as the answer.

## 1. Docs pages

Read the overview, then every page the change touches.

| Page | Read it when |
|---|---|
| [Overview](https://mastra.ai/docs/workflows/overview) | always |
| [Control flow](https://mastra.ai/docs/workflows/control-flow) | the shape changes: `.then`, `.parallel`, `.branch`, `.dowhile`, `.dountil`, `.foreach`, `.map`, nested workflows |
| [Workflow state](https://mastra.ai/docs/workflows/workflow-state) | steps share a value that is not passed step to step |
| [Suspend and resume](https://mastra.ai/docs/workflows/suspend-and-resume) | a step waits for anything |
| [Human-in-the-loop](https://mastra.ai/docs/workflows/human-in-the-loop) | a step waits for the user (approve, reject, answer) |
| [Agents and tools](https://mastra.ai/docs/workflows/agents-and-tools) | a step runs an agent or a tool |
| [Error handling](https://mastra.ai/docs/workflows/error-handling) | retries, `bail`, failures, `onFinish` / `onError` |
| [Snapshots](https://mastra.ai/docs/workflows/snapshots) | anything is persisted or resumed |
| [Workflow streaming](https://mastra.ai/docs/streaming/workflow-streaming) | the run's events or a step's own output reach the UI |
| [Step reference](https://mastra.ai/reference/workflows/step), [Workflow reference](https://mastra.ai/reference/workflows/workflow) | exact parameter names |

Also linked from the overview and not summarised below: [Time travel](https://mastra.ai/docs/workflows/time-travel), [Request context](https://mastra.ai/docs/server/request-context), and the docs index <https://mastra.ai/llms.txt>.

## 2. Confirm against the installed types

The types are in `backend/node_modules/@mastra/core/dist/workflows/`. Quote the glob: zsh expands an unquoted `*.d.ts`.

```
grep -rnE --include='*.d.ts' '<name>' backend/node_modules/@mastra/core/dist/workflows | cut -c1-240
```

| File | Holds |
|---|---|
| `step.d.ts` | `ExecuteFunctionParams` (what `execute` receives), the condition function types, `Step` |
| `workflow.d.ts` | the builder methods and the `Run` methods (839 lines: grep, then read the range) |
| `types.d.ts` | `WorkflowOptions`, the result and status types, `ForeachOptions` (1174 lines: grep) |
| `create.d.ts`, `step-factories.d.ts` | `createWorkflow`, `cloneWorkflow`, `createStep` from an agent or a tool |
| `state-reader.d.ts` | `createWorkflowStateReader` |

A name that is in the docs and not in these files does not exist in 1.66.0: say so in the proposal and design without it.

## 3. Cheat-sheet (docs, checked against 1.66.0)

### Steps and workflows

- `createStep({ id, description?, inputSchema, outputSchema, resumeSchema?, suspendSchema?, stateSchema?, requestContextSchema?, retries?, scorers?, metadata?, execute })`.
- `execute` receives, in 1.66.0: `inputData`, `state`, `setState`, `resumeData?`, `suspendData?`, `suspend`, `bail`, `abort`, `abortSignal`, `getInitData`, `getStepResult`, `mastra`, `requestContext`, `writer`, `runId`, `workflowId`, `retryCount`.
- `createWorkflow({ id, description?, inputSchema, outputSchema, stateSchema?, requestContextSchema?, retryConfig?: { attempts, delay }, options? })`, then the control flow, then `.commit()`.
- `options` (`WorkflowOptions`): `validateInputs` (true when omitted, per the 1.66.0 code), `shouldPersistSnapshot({ stepResults, workflowStatus })`, `pruneSnapshot`, `onStart`, `onFinish`, `onError`, `tracingPolicy`, `autoRestartActiveRuns`.
- Schema rule: the first step's input is the workflow's input, the last step's output is the workflow's output, and each step's output must fit the next step's input; where it does not, put a `.map()` between them.
- `cloneWorkflow(workflow, { id })` copies a workflow under a new id.
- Register with `new Mastra({ workflows: { <key>: workflow } })`; read it back with `mastra.getWorkflow(<key>)`.

### Control flow

| Method | Next step receives | Notes |
|---|---|---|
| `.then(step)` | the step's output | sequential; takes a step or a committed workflow (nested) |
| `.parallel([a, b])` | `{ [a.id]: …, [b.id]: … }` | waits for all; one throwing fails the block, so catch inside a step that may fail |
| `.branch([[cond, step], …])` | an object keyed by the id of each step that ran | **every** true condition runs its step: make conditions mutually exclusive; the next input schema makes the keys optional |
| `.dountil(step, cond)` / `.dowhile(step, cond)` | the last iteration's output | `cond({ inputData, iterationCount })`; each iteration's input is the previous output, validated against the body's input schema (undeclared keys are stripped); abort by throwing in `cond` |
| `.foreach(step, { concurrency })` | an array, in input order | previous output must be an array; `concurrency` defaults to 1; nest a workflow instead of chaining two `.foreach()` |
| `.map(fn \| config, { id? })` | what `fn` returns | reshapes between steps; `fn` gets `inputData`, `getStepResult`, `getInitData` |
| `.sleep(ms)` / `.sleepUntil(date)` | unchanged | run status `waiting`, not `suspended` |

A nested workflow's steps are reported as `<workflow id>.<step id>`. Every control-flow method takes a last argument `{ id, description, metadata }` that labels the entry and does not change execution.

### State

`stateSchema` on the workflow (all keys) and on a step (the keys it uses); `state` and `await setState({ ...state, key })` in `execute`; `initialState` on `run.start` / `run.stream`. State survives suspend and resume and is visible inside nested workflows.

### Suspend, resume, bail

- In `execute`: `if (!resumeData) return await suspend(payload)`. On resume the step runs again with `resumeData` (shape `resumeSchema`) and `suspendData` (what it passed to `suspend`, shape `suspendSchema`).
- The result is `{ status: 'suspended', suspended: [path, …], steps: { <id>: { suspendPayload } } }`. A `path` is the step ids from the top workflow down to the suspended step; treat it as opaque and pass it back unchanged: `run.resume({ step: path, resumeData })` or `run.resumeStream({ step: path, resumeData })`.
- Resume works only from a persisted snapshot: the `Mastra` instance needs `storage`, and the snapshot must be written while the run is suspended.
- `return bail(value)` ends the sequence the step is in as a success with `value`, with no error. A thrown error fails the step and the run (`status: 'failed'`, `error`).
- `retries` on a step overrides the workflow's `retryConfig`.

### Agents and tools as steps

| Way | Use it when |
|---|---|
| Call the agent inside `execute` (`agent.generate` / `agent.stream`) | the call needs options, memory, streaming to the chat or its own error handling |
| `createStep(agent, { structuredOutput?: { schema } })` | the default call is enough: input `{ prompt }`, output `{ text }` or the schema; `.map()` to `{ prompt }` first |
| `createStep(tool)` | the previous output is the tool's input (else `.map()` first) |
| `.agent(agent \| id, options)` / `.tool(tool \| id, options)` | the same as a declarative graph entry |

Inside `execute`, `writer` carries a step's own output into the run's stream (`stream.textStream.pipeTo(writer)` for an agent's text).

### Running

- `const run = await workflow.createRun()`; `run.start({ inputData, initialState?, requestContext? })` resolves to the result.
- `run.stream({ inputData, requestContext })` returns `{ fullStream, result }`: iterate `fullStream` for events, await `result`.
- Result `status`: `success` (`result`), `failed` (`error`), `suspended` (`suspended`, `suspendPayload`), `tripwire`, `paused`; always `input` and `steps`.
- `workflow.getWorkflowRunById(runId)`, `listWorkflowRuns()`, `deleteWorkflowRunById(runId)`.
- Snapshots must be JSON-serialisable and small: keep ids in them, not objects.

## 4. Where the docs and 1.66.0 disagree

Found on 2026-11-13. Check again; the list grows with every Mastra release.

| Docs say | 1.66.0 has |
|---|---|
| Use `getStepResultAsync`; `getStepResult` is deprecated | only `getStepResult` (synchronous). `getStepResultAsync` is nowhere in the package. |
| `options.storageVersion` (`1 \| 2`) | not present |
| `run.resumeStream()` returns a `ReadableStream` to iterate directly | it returns the same object as `run.stream()`: `{ fullStream, result }` |
| The step reference lists no `bail`, `abort`, `abortSignal` or `writer` | all four are in `ExecuteFunctionParams` |
| The workflow reference lists no `retryConfig` and no default for `validateInputs` | `retryConfig` is a `createWorkflow` parameter; `validateInputs` is true when omitted |
| The streaming page names no event types | the app reads `workflow-step-start`, `workflow-step-result` and `workflow-step-suspended` (see the stub's header) |
| (not mentioned) | `.waitForEvent()` is still typed but marked removed: use suspend and resume |

## 5. Inventory (snapshot — re-list the folders)

```
ls backend/src/mastra/workflows backend/src/mastra/agents backend/src/mastra/tools backend/src/mastra/testing
grep -nE "^\s+'?[a-z0-9-]+'?: " backend/src/mastra/index.ts
```

### Workflows (`backend/src/mastra/workflows/`)

| Registered key | Files | What it is |
|---|---|---|
| `qti-v2-turn` | `qti-v2-turn.workflow.ts` (Mastra objects), `.steps.ts` (catalogue entries, edges, runtime interface, pure step code), `.schemas.ts` (Zod contracts), `.prompts.ts`, `.agents.ts` (the two model-only calls) | *Answer a Business Question*, the one catalogue workflow. Eight steps: `.then` ×2, `.dountil` over a nested plan round (`.branch` to Clarify, `.map`), `.branch` into a nested analysis path (`.dountil` over Analyse then Validate), `.branch` into Write answer then Wrap up. Two steps suspend. agents.md 5.11. |
| `agent-turn` | `agent-turn.workflow.ts`, `agent-turn.steps.ts` | The engine of a turn bound to one agent: one `answer` step that calls the runtime handed in on the `RequestContext`. Never snapshotted. agents.md 5.12. |

Shared modules, all without a framework import:

| File | Holds |
|---|---|
| `workflow-catalog.ts` | `CODE_WORKFLOWS` (the catalogue: id, name, `primaryFor`, `stepAgents`, input fields, steps, edges, `contractHash`), the `agent:<key>` ids and the session's workflow rule |
| `agent-workflows.ts` | `agentWorkflow(agentKey)`: the steps as an agent's detail returns them; `STEP_AGENTS` |
| `workflow-contract.ts` | the contract check when the catalogue loads, `contractHash`, `withContract`, `engineInputSchema`, `ContractViolationError` |
| `workflow-input.ts` | the typed input fields and `validateWorkflowInput` |
| `workflow-run.ts` | `runErrorMessage` |

Who runs them: `MastraService.streamWorkflow` (`backend/src/mastra/mastra.service.ts`: `createRun`, `stream`, `resume`, `discard`), called by `backend/src/modules/sessions/turn/turn-engine.ts`, which puts the runtime on the `RequestContext`; `backend/src/modules/workflows/workflows.service.ts` builds the API's catalogue; `backend/src/mastra/evals/analyst-v2-workflow-target.ts` runs the whole `qti-v2-turn` for each `assistant-v2` eval case.

### Agents (`backend/src/mastra/agents/`, keys from `index.ts`)

| Key | File | Role | agents.md |
|---|---|---|---|
| `assistant` | `assistant.agent.ts` | Questions to Insights Assistant; its turns run on `agent-turn` | 2.1 |
| `assistant-v2` | `assistant-v2.agent.ts` (data: `assistant-v2-catalog.ts`) | the Analyse step of `qti-v2-turn`, with tools | 2.11 |
| `analysis-planner` | `analysis-planner.agent.ts` | the Plan step: one model call, no tools | 2.11, 5.11 |
| `answer-writer` | `answer-writer.agent.ts` | the Write answer step: one model call, no tools | 2.11, 5.11 |
| `data-readiness` | `data-readiness.agent.ts` | Data Readiness Agent; runs on `agent-turn` | 2.10 |
| `visualization` | `visualization.agent.ts` | Interactive Visual Designer | 2.2, 6 |
| `sql-fixer` | `sql-fixer.agent.ts` | repairs a failed query | 2.3, 5.3 |
| `sql-verifier` | `sql-verifier.agent.ts` | careful mode's cross-check | 2.4, 5.8 |
| `knowledge-bootstrap` | `knowledge-bootstrap.agent.ts` | Ontology Bootstrap | 2.5 |
| `assistant-eval-judge` | `eval-judge.agent.ts` | judges eval answers | 2.6 |

### Tools (`backend/src/mastra/tools/`)

| File | Tool ids |
|---|---|
| `dataset.tools.ts` | `list_entities`, `describe_entity`, `sample_rows`, `run_readonly_sql` |
| `clarification.tool.ts` | `ask_clarification` |
| `visual.tools.ts` | `create_visual`, `update_visual` |
| `panel.tool.ts` | `show_in_panel` |
| `workflow.tool.ts` | `update_workflow` |
| `readiness.tools.ts` | `assess_data_readiness`, `get_readiness_report`, `list_readiness_reports` |
| `synthetic-data.tools.ts` | `profile_data_sample`, `generate_synthetic_data` |

Which agent has which tool: the `tools:` of each agent file, and agents.md 2 and 3.

### Test stand-ins (`backend/src/mastra/testing/`)

| File | Stands in for |
|---|---|
| `workflows.stub.ts` | `@mastra/core/workflows` under Jest. Runs `.then`, `.branch`, `.dountil`, `.map`, nested workflows, `bail`, `suspend` and `resumeStream`, with the engine's step events. **Not** `.parallel`, `.foreach`, `.dowhile`, `.sleep`, state, retries or schema validation. |
| `turn-workflow.stub.ts` | `MastraService.streamWorkflow` (`streamTurnWorkflow` for `agent-turn`, `streamStubWorkflow` with `resume` and `discard`) |
| `mastra-skills.stub.ts` | `@mastra/core/skills` (mapped in the Jest config in `backend/package.json`) |
