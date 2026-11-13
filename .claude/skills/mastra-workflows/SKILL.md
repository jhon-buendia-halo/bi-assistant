---
name: mastra-workflows
description: Use when designing, adding or changing a Mastra workflow in this app, its steps or control flow (branch, loop, parallel, suspend and resume), or how agents and tools are composed into one — before any design or code. Grounds the session in Mastra's docs and the installed 1.66.0 types, inventories what already exists, offers exactly three approaches with one recommendation, and builds only after the user picks.
---

# Mastra workflows — design, then build

For a new workflow or a change to an existing one (`backend/src/mastra/workflows/`). It carries out the rule *New or changed workflows start from Mastra's docs* of [CLAUDE.md](../../../CLAUDE.md). It sits inside the session's workflow, not beside it: steps 1 to 3 below belong to understanding and clarifying the change ([`workflow-start`](../workflow-start/SKILL.md), or steps 1 and 2 of [`workflow-free-style`](../workflow-free-style/SKILL.md)), step 4 is the implementation ([`workflow-implement`](../workflow-implement/SKILL.md)) and step 5 the checks ([`verify`](../verify/SKILL.md)).

**Nothing is built, and no file under `backend/` is edited, until the user has picked one of the three approaches.**

The API cheat-sheet, the docs pages, where the docs and 1.66.0 disagree, and the inventory are in [reference.md](reference.md).

## 1. Ground in Mastra's docs and the installed version

1. Read <https://mastra.ai/docs/workflows/overview>, then each linked page the change touches: control flow (`.then`, `.parallel`, `.branch`, `.dowhile`, `.dountil`, `.foreach`, `.map`, nested workflows), workflow state, suspend and resume, human-in-the-loop, agents and tools as steps, error handling and retries, snapshots, streaming, running a workflow. The URLs and when each applies: [reference.md](reference.md) 1. Read the pages now; do not design from memory or from the cheat-sheet alone.
2. The docs describe Mastra's latest release; the app pins `@mastra/core` **1.66.0** (`backend/package.json`). Confirm every API you plan to use against the installed types before proposing it:

   ```
   grep -rnE --include='*.d.ts' '<name>' backend/node_modules/@mastra/core/dist/workflows | cut -c1-240
   ```

   `step.d.ts` holds what `execute` receives, `workflow.d.ts` the builder and run methods, `types.d.ts` the options and result types (the last two are over 500 lines: grep, then read the range).
3. Where the docs and 1.66.0 disagree, say so in the proposal and design with what is installed. Known cases: [reference.md](reference.md) 4 (for one, the docs' `getStepResultAsync` does not exist in 1.66.0; the code uses `getStepResult`). Never propose upgrading Mastra as a side effect of a workflow change.

## 2. Inventory what exists and decide reuse

Re-list the folders every time; the inventory in [reference.md](reference.md) 5 is a snapshot.

```
ls backend/src/mastra/workflows backend/src/mastra/agents backend/src/mastra/tools backend/src/mastra/testing
```

Read, in this order, only what the change can touch:

- **Workflows.** [agent-turn.workflow.ts](../../../backend/src/mastra/workflows/agent-turn.workflow.ts) with [agent-turn.steps.ts](../../../backend/src/mastra/workflows/agent-turn.steps.ts) (the smallest complete example), then `qti-v2-turn.*` (branches, loops, nested workflows, suspend and resume; its header comment in [qti-v2-turn.workflow.ts](../../../backend/src/mastra/workflows/qti-v2-turn.workflow.ts) is the flow), the catalogue [workflow-catalog.ts](../../../backend/src/mastra/workflows/workflow-catalog.ts) and [agent-workflows.ts](../../../backend/src/mastra/workflows/agent-workflows.ts), and the contract helpers in `workflow-contract.ts`.
- **Agents** in `backend/src/mastra/agents/`, **tools** in `backend/src/mastra/tools/`, and what is registered in [index.ts](../../../backend/src/mastra/index.ts).
- **The test stand-in** [workflows.stub.ts](../../../backend/src/mastra/testing/workflows.stub.ts): its header lists the control flow it can run.
- **The specs** (both large: `grep -n`, then read the range): [workflows/spec.md](../../../specs/capabilities/workflows/spec.md) (rules R1 to R28) and [agents.md](../../../specs/system/agents.md) (2 for the agents, 3 for the tools, 5.11 and 5.12 for the workflows).

The output of this step is a short **reuse table**, shown to the user with the approaches:

| Existing piece | Kind | Decision | Why |
|---|---|---|---|
| e.g. `analysis-planner` | agent | reused as-is / reference pattern / not applicable | one line |

Then one line, **Genuinely new:** the steps, schemas, agents or tools no existing piece covers. Prefer reusing an agent, a tool, a pure step function or a schema over writing a second one; a new agent is a cost (prompt, evals, an agents.md entry), so say why an existing one will not do.

## 3. Offer exactly three approaches, recommend one, ask

Always three, and really different: in the primitives they use, in what they reuse, or in where the work happens (one step or several, code or a model call, one workflow or a nested one). Not one design with two straw men. Present them with this template, in the user's language:

```
## Reuse
<the reuse table>
Genuinely new: <…>
Docs vs 1.66.0: <what differs for this change, or "nothing that affects it">

## Approach A — <name>
Shape: <primitives: .then / .branch / .dountil / nested workflow / suspend…>
  start → step-a → step-b ─┬─ <condition> → step-c
                           └─ <otherwise> → step-d → end
Reuses: <agents, tools, steps, schemas, helpers>
Trade-offs:
- Complexity: <new files, new steps, nested workflows>
- Latency and LLM calls: <model calls per run, sequential or parallel>
- Testability: <what the stub already runs; what would have to be added to it>
- UI and graph: <catalogue steps and edges that change; workflow page, Run panel, stored runs>
- Evals: <which agent's input changes, so which eval set must run; or none>
Size: <S / M / L>

## Approach B — <name>
…
## Approach C — <name>
…

## Recommendation
<A, B or C>, because <the one or two reasons that decide it>.
```

Sizes are those of [`workflow-strict`](../workflow-strict/SKILL.md). Then ask with **one** picker question (the AskUserQuestion tool): the three approaches as options, the recommended one first and marked `(recommended)`. Put any other question that has no safe default in the same call. Wait for the answer. If the user picks something else or mixes two, restate the resulting shape in two lines before building.

## 4. Build rules for this repo

Each rule is visible in the code named beside it; when the code has moved on, follow the code and fix this skill.

**Files and names** (`backend/src/mastra/workflows/`, kebab-case, one prefix per workflow)

- `<name>.steps.ts`: the workflow id constant, the `RequestContext` key, the step catalogue entries (`WorkflowStepEntry`: id, title, kind `code` or `agent`, summary, input, output, exits), the edges, the runtime interface and the pure code of the deterministic steps. **No framework import.**
- `<name>.workflow.ts`: the only file that imports `@mastra/core/workflows`. It builds `createStep` and `createWorkflow` from the ids and titles of `.steps.ts` (`id: STEP.id`, `description: STEP.title`), so nothing is written twice.
- When the workflow grows, as `qti-v2-turn` did: `<name>.schemas.ts` (the Zod schema of every step, used by both the Mastra steps and the catalogue), `<name>.prompts.ts`, `<name>.agents.ts` (model calls).
- Step ids are kebab-case and unique in the whole workflow, nested ones included: the engine reports a nested step as `<workflow id>.<step id>` and the session code reads the last segment. Nested workflows and `.map()` steps are not catalogue steps.

This split exists because Jest cannot load Mastra's ESM: catalogue data lives in a module with no framework import, and the Mastra objects are built in a second file ([lessons.md](../../../lessons.md), *Evals and agents*).

**Registration**

- The Mastra object goes in `workflows` of [index.ts](../../../backend/src/mastra/index.ts), under a key equal to its id.
- A workflow the user can run goes in `CODE_WORKFLOWS` of `workflow-catalog.ts`, with `primaryFor`, `stepAgents` for a step that runs its own agent, its typed `input`, `steps` and `edges`. The catalogue refuses to load when a step's required input is given neither by the input nor by an earlier step (`assertWorkflowContracts`). An engine that is not a catalogue workflow (`agent-turn`) is registered in `index.ts` only.
- Runs go through `MastraService.streamWorkflow` ([mastra.service.ts](../../../backend/src/mastra/mastra.service.ts)); the caller hands the per-run runtime (functions) to the steps on the `RequestContext`, and a step throws when it is missing.

**Steps**

- A catalogue step declares its input and output schema once and wraps `execute` in `withContract`, with `inputSchema: engineInputSchema(<schema>)`, so a violation reads `Contract violation in <Step title>…`.
- Snapshots: the runtime on the `RequestContext` must never be serialised. `shouldPersistSnapshot: () => false` when the run never waits; only while `workflowStatus === 'suspended'` when a step suspends, on the workflow and on every nested workflow.
- A step that waits declares `suspendSchema` and `resumeSchema`, returns `suspend(payload)`, and reads `resumeData` and `suspendData` when it runs again; the suspended path is passed back to `resumeStream` unchanged.
- A step that ends the run early returns `bail(output)`; it ends only the sequence it is in, so the conditions after a nested workflow must read the stop from its output.

**Agents and tools**

- A new agent is a file in `backend/src/mastra/agents/`, registered in `index.ts`, with an entry in agents.md. Its `model` is `async () => resolveAgentModel()`; never a hardcoded provider. Its instructions go through `agentInstructions(<key>, <shipped text>)` as in [analysis-planner.agent.ts](../../../backend/src/mastra/agents/analysis-planner.agent.ts).
- An agent's catalogue data (key, name, tool names, step limit) lives in a framework-free module, as `assistant-v2-catalog.ts` does.
- The existing workflows call their agents through the runtime or a function in `<name>.agents.ts`, inside `execute`. `createStep(agent)`, `.agent()` and `.tool()` exist in 1.66.0 but nothing here uses them, and the stub does not run them: choosing one is part of an approach, with its cost.

**Tests**

- A workflow spec starts with `jest.mock('@mastra/core/workflows', () => jest.requireActual('../testing/workflows.stub'))` and drives `createRun().stream({ inputData, requestContext })`, as [agent-turn.workflow.spec.ts](../../../backend/src/mastra/workflows/agent-turn.workflow.spec.ts) does. A spec that mocks `MastraService.streamWorkflow` uses `turn-workflow.stub.ts`.
- The stub runs `.then`, `.branch`, `.dountil`, `.map`, nested workflows, `bail`, `suspend` and resume. A design that needs anything else (`.parallel`, `.foreach`, `.dowhile`, state, retries) must extend the stub in the same change and check the new behaviour against the real engine once; count that in the approach's size.
- Pure step code is tested without the stub (`qti-v2-turn.steps.spec.ts`). Changing a step schema changes the workflow's `contractHash` and the snapshot of `workflow-contracts.spec.ts`: update it on purpose, never blindly.
- The stub validates no schema: a contract is only proven by `withContract` and by the catalogue check.

**Specs, on the same branch**

- Update the lines the change makes false in [workflows/spec.md](../../../specs/capabilities/workflows/spec.md) (the rules, the catalogue in R1 and R2, the flow in R27) and in [agents.md](../../../specs/system/agents.md) (5.11 steps table and catalogue table, 5.12, 1.2 and 2 for an agent, 3 for a tool). Copy endpoints and shapes from [api.md](../../../specs/system/api.md), never from memory.
- A new way of running or resuming workflows is architectural: record an ADR ([`workflow-start`](../workflow-start/SKILL.md)).

**Evals**

- A workflow change that alters what an agent receives (its prompt, tools, context blocks, the messages a step builds) needs that agent's evals. Decide by hashing `getInstructions()` and the tool list on base and branch ([lessons.md](../../../lessons.md)); the `assistant-v2` eval target runs the whole `qti-v2-turn` (`backend/src/mastra/evals/analyst-v2-workflow-target.ts`), so a change to its steps reaches those evals even when no prompt changed.
- How to run and the pass bar: [`verify`](../verify/SKILL.md), *Evals*.

## 5. Checks

Load [`verify`](../verify/SKILL.md) and run what it says: `node scripts/qa.mjs --free` in Free style, `node scripts/qa.mjs <roadmap-id> --gate` in Strict. While coding, `npx jest --findRelatedTests <files> --silent` in `backend/`, output to a log file.
