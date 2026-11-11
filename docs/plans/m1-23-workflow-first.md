# M1-23 — Workflow-first: implementation plan

- **Epic:** M1-23 (repo only, no Jira key) · **Roadmap:** Milestone 1.23 · **Branch:** `feat/M1-23-workflow-first` (renamed from `feat/M1-23-v2-workflow-graph` on 2026-11-11; one PR) · **Epic spec:** [specs/epics/M1-23/spec.md](../../specs/epics/M1-23/spec.md)
- **Status:** Draft, written 2026-11-11 by the planning model. Once the user confirms it, this file is the **contract** every builder works from. Change it through the lead, never inside a unit.
- **Size:** L (architectural): a new ADR, a change to what every session is bound to, and one turn path for every agent.

## 1. Summary

Today a chat is started from an **agent**. After this epic a chat is started from a **workflow**, and agents are the building blocks that workflow steps call: `workflows -> agents -> skills -> tools`.

What the user sees:

- A new **Workflows** item on the navigation rail, above **Agents**. It lists every workflow the app ships:
  - the code-defined ones (today only *Questions to Insights v2*, 4 steps);
  - a one-step workflow for each agent that has no workflow of its own: *Assistant*, *RFP Builder*, *Data Readiness Agent*, and every Live user agent.
- A workflow's page shows what happens on each message (the 1.23.1 drawing), the agents its steps call, and **Start chat**.
- The **New conversation** screen asks for a **Workflow** instead of an Agent.
- A chat's header and its row in the Sessions list name the workflow it runs.
- **Agents** stays the library of building blocks (prompt, skills, tools, evals, LLM config). Agents lose **Start chat**, and each agent's page says which workflows use it.

What does not change: what any agent receives or answers, the workflow bar of the assistant and the RFP Builder, existing sessions (no data migration), evals, and the agent editor's preview chat.

## 2. Decisions already made

Made by the user on 2026-11-11. Not to be re-litigated:

1. **Workflows are defined only in code** for this version, like `qti-v2-turn`, and ship with the app. The app shows them, lets you pick and run them, and never edits them. There is no workflow editor and no persisted workflow definition.
2. **Every agent that has no workflow today gets an automatic one-step workflow** whose single step runs that agent: the assistant, the RFP Builder, the Data Readiness Agent and every user agent. So every session runs a workflow, the Workflows section lists all of them, and the backend has one turn path.
3. **A chat starts from a workflow.**
   - The new-session screen asks for a Workflow instead of an Agent.
   - **Start chat** moves to the workflow's page.
   - A new **Workflows** rail item lists the workflows.
   - **Agents** stays as the library of building blocks, and each agent shows which workflows use it.

Answers to the plan's open questions, given by the user on 2026-11-11:

4. **The four showcase agents (Benchmarking, Survey, LAD COE, Strategy) are removed from the app**, not only from the picker (story 1.23.8, built right after 1.23.2). Later stories therefore have no showcase case to handle.
5. **The Official agents' Chat Box tab is removed.** Their default tab becomes System Prompt. User agents keep Chat Box for the draft preview.
6. **Every chat's header shows its `Workflow` chip**, plain Assistant chats included.
7. **The branch is renamed** to `feat/M1-23-workflow-first`.

Defaults stated by the session model, kept here:

- **No data migration.** An existing session's workflow is derived at read time from its stored `agentKey` / `agentId` ([data-model.md](../../specs/system/data-model.md) 3.4). A new session stores its `workflowId`.
- **The epic M1-23 is widened** to "workflow-first". It keeps 1.23.1 (committed: the Graph tab draws v2's workflow, and `GET /agents/:key` returns `workflow`) as its first story, on the same branch, in one PR.
- **Reuse:** the 1.23.1 drawing component (`frontend/src/app/features/agents/components/agent-workflow/`) and the step catalogue (`backend/src/mastra/workflows/qti-v2-turn.steps.ts`, `agent-workflows.ts`) are reused for the workflow's own page.

Further defaults chosen by the planner (section 8 holds the few that need the user's answer):

- **Wrapper names:** a one-step workflow takes its agent's display name and description. The one exception is the assistant's, which keeps the picker's name `Assistant` and description `Answers questions over the datasets you pick.`, so the Sessions list chip `Assistant` and the composer copy do not change.
- **Rail order:** Datasets, **Workflows**, Agents, Context, Sessions, Monitoring. The icon is lucide `workflow`.
- **Start chat sits on the workflow card and on the workflow's page,** as it sat on the agent card and the agent's page.
- **The agent detail's `workflow` field and v2's Graph drawing (1.23.1) stay.**
- **Evals are unchanged.** They call agents directly ([agents.md](../../specs/system/agents.md) 8.3), never a workflow. No agent's prompt or tools change, so no eval run is required. Story 1.23.4 records the `getInstructions()` and tool-list hashes on base and branch to show this ([lessons.md](../../lessons.md)).
- **The non-streamed turn** (`POST /sessions/:id/messages`, legacy, not called by the UI) stays a direct agent call, as it is for v2 today.

## 3. ADR draft

Take the number from `main` at the moment of writing ([lessons.md](../../lessons.md)): `git show origin/main:specs/system/architecture.md | grep '#### ADR-'`. On 2026-11-11 the last is ADR-0039 on both `origin/main` and this branch, so this is **ADR-0040**. Re-check after merging `origin/main` at the start of 1.23.2, and renumber (then grep every reference) if `main` has moved.

Place it under **Level 3 — Components**, after ADR-0039.

The earlier ADRs keep their substance. Only their **Status** line gains a pointer, as ADR-0008's already does: ADR-0008 "amended by ADR-0040", ADR-0028 "amended by ADR-0040", ADR-0029 "amended by ADR-0040", ADR-0034 "amended by ADR-0040".

```markdown
#### ADR-0040 — Workflow-first: a session runs a workflow defined in code; agents are the steps' building blocks; an agent without a workflow gets a one-step workflow, never registered per agent
- **Status:** Proposed (Accepted when the user confirms the widened M1-23 epic spec)
- **Date:** 2026-11-11
- **Context:**
  - A session is bound to an agent. A user agent is bound by `agentId` and runs the `assistant` with its configuration (ADR-0008). A built-in agent is bound by `agentKey` and runs that agent (ADR-0028).
  - Questions to Insights v2 runs each streamed turn as a Mastra workflow defined in code (ADR-0034). That gave the session service a second turn path, used for v2 only.
  - The workflow bar is fed in one of two ways:
    - from the agent's prompt (`## Workflow`, `update_workflow`, the RFP stage auto-drive; ADR-0029);
    - from the code-defined workflow's step events (v2, ADR-0034).
  - On 2026-11-11 the user decided that the app becomes **workflow-first**, with the hierarchy workflows → agents → skills → tools:
    - workflows are defined only in code and are never edited in the app;
    - every agent without a workflow is wrapped in an automatic one-step workflow, so every session runs a workflow and there is one turn path;
    - a chat starts from a workflow (a Workflows rail item, Start chat on the workflow's page, a Workflow field on the new-session screen);
    - agents stay as a library and show which workflows use them.
  - ADR-0008 explains why agents are not registered per user definition: it would mean re-registering on every edit, and it would bypass the assistant's tools, memory and guards.
- **Decision:**
  - **A session is bound to a workflow.** A workflow is a fixed sequence of steps defined in code. Each step is deterministic code or one bounded call to an agent.
  - **Workflow ids:**
    - a code-defined workflow keeps its own id (`qti-v2-turn`);
    - the one-step workflow of a built-in agent is `agent:<registry key>` (`agent:assistant`, `agent:rfp`, `agent:data-readiness`);
    - the one-step workflow of a user agent is `agent:<user-agent id>`.
  - **Which agents get a one-step workflow:** the agents a session can run that have no code-defined workflow of their own (the assistant, the RFP Builder, the Data Readiness Agent and every Live user agent). System agents have none. (The showcase agents, which never ran, are removed from the app in the same epic.)
  - **One registered engine for every one-step workflow.** The Mastra instance registers a single workflow, `agent-turn`, with one agent step, `answer`. The orchestrator picks the agent for each run and passes it through the run's request context. A one-step workflow is a descriptor, computed at read time from the agent registry and the `agents` collection. Nothing is registered per agent or per user agent, so publishing, editing or deleting a user agent needs no re-registration.
  - **One turn path.** Every streamed turn is one run of the session's workflow. Its agent step runs today's agent turn unchanged: the context blocks, request context, tools, memory thread, clarification interception, tool-only synthesis, the assistant-only grounding guard and careful mode, the RFP stage tracking, visuals and panel items. Which of these apply still depends on the agent the step runs, never on the workflow.
  - **The workflow bar keeps its two sources.**
    - A code-defined workflow's steps drive the bar from its step events (ADR-0034).
    - A one-step workflow never writes the bar. The agent's prompt-defined phases, `update_workflow` and the RFP stage auto-drive keep driving it, exactly as before (ADR-0029).
  - **Storage.** A new session stores `workflowId`, plus the agent fields it stores today (`agentKey`, or `agentId` and `agentName`) for the workflow's agent. A session without `workflowId` derives it at read time from those fields. There is no migration.
  - **Read-only catalogue.** The app lists workflows, shows each one's steps and agents, and starts chats from them. It never creates, edits, reorders or deletes a workflow.
- **Rejected:**
  - **One registered Mastra workflow per agent** (built-in agents at startup, user agents at runtime). User agents would be registered and re-registered on every publish and delete, for the same reason ADR-0008 rejects registering agents, and there would be two kinds of wrapper.
  - **No Mastra run for one-step workflows** (the orchestrator treats "one agent step" as a workflow by itself). That keeps two engines: step events and run results would exist only for code-defined workflows, and each turn feature would still need its own branch per engine.
  - **Showing the one-step workflow's single step in the workflow bar.** A lone `Answer` step would replace the assistant's and the RFP Builder's phases and fight the RFP stage auto-drive.
  - **Persisted or user-edited workflows.** Out of this version, by the user's choice.
  - **A migration that writes `workflowId` into existing sessions.** Deriving the id is deterministic and cheap, and a migration adds risk for no gain.
- **Consequences:**
  - **Amends ADR-0008.** A user agent's session runs its one-step workflow `agent:<id>`. The agent still runs on the `assistant` and is still not registered. Deleting the agent removes its workflow, and its sessions continue with the plain assistant, as before.
  - **Amends ADR-0028.** Sessions bind to a workflow, and `agentKey` records the workflow's agent. Start chat moves from the agent to the workflow.
  - **Amends ADR-0029.** The bar's sources gain the rule above. No behaviour changes.
  - **Amends ADR-0034.** Its "second turn path" becomes the only path, and `qti-v2-turn` becomes one entry of the workflow catalogue.
  - **Amends ADR-0004:** the Mastra instance registers two workflows.
  - **Cost per turn.** Every turn runs one more Mastra workflow, with snapshot persistence off. The trace store may record workflow spans around the agent run, and Monitoring must keep showing one turn per question.
  - **Adding a code-defined workflow** takes its Mastra workflow, its step catalogue and one catalogue entry. It then appears in the Workflows list and the new-session picker with no UI change.
  - **Evals keep calling agents directly.** The legacy non-streamed turn stays a direct agent call.
  - **Stack-neutral:** any rebuild needs an engine that runs typed steps in a fixed order and reports each step's start and end, a catalogue of workflows built from code and from stored agents, and the rule that derives a session's workflow from its stored agent binding.
```

## 4. Architecture

### 4.1 The turn path, before and after

```
BEFORE
POST /sessions/:id/messages/stream
  SessionsService.streamTurn(session)
    agentKey = session.agentKey ?? 'assistant'           (user agents: 'assistant' + Live config)
    ├─ agentKey === 'assistant-v2' ─▶ runAssistantV2Workflow ─▶ Mastra run 'qti-v2-turn'
    │                                    analyse step ─▶ consume(agent.stream(input, options + catalog block))
    └─ otherwise ──────────────────▶ consume(agent.stream(input, options))
    then: final text · tool-only synthesis · grounding guard* · persist · careful mode* · done
                                                                    (* assistant and user agents only)

AFTER
POST /sessions/:id/messages/stream
  SessionsService.streamTurn(session)
    wf       = sessionWorkflow(session)                  (stored workflowId, else derived; 4.3)
    agentKey = session.agentKey ?? 'assistant'           (unchanged: the workflow's agent; a deleted
                                                          user agent's session runs the plain assistant)
    runTurnWorkflow(wf, runtime) ─▶ Mastra run wf.engine
      ├─ 'qti-v2-turn'  4 steps · bar from steps  ─▶ analyse ─▶ consume(agent.stream(… + catalog block))
      └─ 'agent-turn'   1 step  · bar from agent  ─▶ answer  ─▶ consume(agent.stream(input, options))
    then: unchanged (final text · synthesis · grounding guard* · persist · careful mode* · done)
```

`consume`, `agentInput` and `agentOptions`, and everything after the run, are not changed. The only differences:
- `consume` is called from inside a Mastra step for every agent, not only for v2;
- step events reach the workflow state only when the workflow's `bar` is `steps`.

### 4.2 The workflow registry

Two layers. The data layer stays free of framework imports because Jest cannot load Mastra's ESM ([lessons.md](../../lessons.md)).

1. **`backend/src/mastra/workflows/workflow-catalog.ts`** (new, framework-free). Its constants:
   - `CODE_WORKFLOWS`: one entry per code-defined workflow. Today:
     `{ id: 'qti-v2-turn', name: 'Questions to Insights v2', description: <v2's catalogue description>, primaryFor: 'assistant-v2', steps: QTI_V2_TURN_STEPS, bar: 'steps' }`.
     `primaryFor` names the agent whose chats this workflow runs, so that agent gets no one-step workflow.
   - `WRAPPED_AGENT_KEYS = ['assistant', 'rfp', 'data-readiness']`: the built-in agents that get a one-step workflow.
   - `ASSISTANT_WORKFLOW_ID = 'agent:assistant'`, `AGENT_WORKFLOW_PREFIX = 'agent:'`.

   Its pure functions (4.3 and 5.1 give their contracts): `agentWorkflowId`, `parseWorkflowId`, `sessionWorkflowId`, `workflowsUsingAgent`, `oneStepWorkflowSteps`.

   A unit test fails when a registered Official agent is neither in `WRAPPED_AGENT_KEYS` nor the `primaryFor` of a code workflow. A second test fails when a code workflow's `primaryFor` is also wrapped. Neither test imports Mastra: they read the agent keys from the framework-free catalogues.
2. **`backend/src/mastra/workflows/agent-turn.steps.ts`** (new, framework-free): `AGENT_TURN_WORKFLOW_ID = 'agent-turn'`, `AGENT_TURN_STEPS` (the one `answer` step, 5.1), `AGENT_TURN_RUNTIME_KEY`, `AgentTurnRuntime`.
3. **`backend/src/mastra/workflows/agent-turn.workflow.ts`** (new, Mastra): `createWorkflow({ id: 'agent-turn', options: { shouldPersistSnapshot: () => false } }).then(answerStep).commit()`, registered in `mastra/index.ts` next to `qtiV2TurnWorkflow`.
4. **`WorkflowsService`** (new Nest module `backend/src/modules/workflows/`). It builds the catalogue for the API from `CODE_WORKFLOWS`, `AgentsService.list()` and `agentWorkflow()`. `AgentsModule` gains `exports: [AgentsService]`.

   `SessionsService` **does not** depend on `WorkflowsService`: `AgentsModule` already imports `SessionsModule`, so that would be a cycle. `SessionsService` resolves workflows from the pure catalogue, with the `MastraService` and `UserAgentsService` it already has.

`agent-workflows.ts` (1.23.1) keeps its export `agentWorkflow(agentKey)`. It now reads its source from `CODE_WORKFLOWS` (by `primaryFor`), so v2's steps are written once.

Max steps, from framework-free modules:
- `ASSISTANT_MAX_STEPS` (15) is already in `mastra/agent-constants.ts`.
- `RFP_MAX_STEPS` (15) and `DATA_READINESS_MAX_STEPS` (10) live in `rfp.agent.ts` and `data-readiness.agent.ts`, which import Mastra. Move both constants into `agent-constants.ts`, and have the agent files import them from there.
- A user agent's one-step workflow uses `ASSISTANT_MAX_STEPS`.

### 4.3 Workflow identity and derivation

| Session stored | Derived `workflowId` | Turn runs |
|---|---|---|
| `workflowId` set and resolvable | that id | that workflow |
| `agentKey: 'assistant-v2'` | `qti-v2-turn` (the code workflow whose `primaryFor` is the key) | v2's 4 steps |
| `agentKey: 'rfp'` / `'data-readiness'` | `agent:rfp` / `agent:data-readiness` | `agent-turn` with that agent |
| `agentId: <id>`, agent exists | `agent:<id>` | `agent-turn` with the assistant + the agent's Live config (a preview: the draft) |
| `agentId: <id>`, agent deleted | `agent:<id>` (view `deleted: true`) | `agent-turn` with the plain assistant (sessions-chat R59, unchanged) |
| neither | `agent:assistant` | `agent-turn` with the assistant |

The rules:
- `sessionWorkflowId(session)` applies this table.
- A stored `workflowId` that no longer resolves (a code workflow removed in a later version) is ignored: the session derives its workflow from its agent fields, as if `workflowId` were absent.
- An invariant test checks that, for every way a session can be created today, the stored `workflowId` equals the id derived from its agent fields. So for now `workflowId` is redundant, and it is what future workflows rely on: several workflows may call the same agent.

**Draft and Live user agents.**
- A user agent's one-step workflow is **listed** (`GET /workflows`) and **startable** only while the agent has a Live version, with its name, description, datasets and starters taken from the Live version.
- A draft-only agent has no listed workflow: `GET /workflows/agent:<id>` answers 404.
- The **agent editor's preview** and the **Chat Box** tab keep starting through `POST /sessions { agentId, preview: true }` (agents-evals R60, R61), unchanged. A preview session derives `agent:<id>` and runs the one-step path with the **draft**, through the existing `runningConfig` rule. Its `workflowRef.name` is the draft's name.

**Deleted user agent** (sessions-chat R57–R59). Its workflow leaves the catalogue. Its sessions keep `workflowRef = { id: 'agent:<id>', name: <stored agentName>, kind: 'agent', deleted: true }`, and their turns run the plain assistant, exactly as today.

## 5. Contract

Two builders working in parallel must agree on this section. Names are exact.

After 1.23.8 the showcase agents no longer exist. Where this section names "showcase" keys or agents, read it as "unknown": the rule still holds, and no code needs a showcase branch.

### 5.1 Backend types (framework-free modules)

```ts
// backend/src/mastra/workflows/agent-turn.steps.ts            (owned by 1.23.3)
export const AGENT_TURN_WORKFLOW_ID = 'agent-turn';
export const AGENT_TURN_RUNTIME_KEY = 'agent-turn-runtime';
export const AGENT_TURN_STEPS = [
  {
    id: 'answer',
    title: 'Answer',
    kind: 'agent',
    summary: 'The agent answers with its tools, streamed to the chat.',
    input: ['question', 'datasets'],
    output: ['calls', 'stopped'],
    exits: [
      { label: 'Model error', outcome: 'fails' },
      { label: 'Stop', outcome: 'stops' },
    ],
  },
] as const satisfies readonly WorkflowStepEntry[];   // WorkflowStepEntry from qti-v2-turn.steps.ts
export interface AgentTurnRuntime {
  /** Runs the session's agent turn (agents.md 5.1 steps 2-3); never throws for a stream error that 5.1 swallows. */
  answer(): Promise<AnalyseOutcome>;                  // AnalyseOutcome from qti-v2-turn.steps.ts: { calls, stopped }
}

// backend/src/mastra/workflows/workflow-catalog.ts             (owned by 1.23.3)
export type WorkflowBar = 'steps' | 'agent';
export interface CodeWorkflowSource {
  id: string; name: string; description: string;
  primaryFor: string;                                 // registry key of the agent its agent step runs
  steps: readonly WorkflowStepEntry[];
  bar: WorkflowBar;                                   // 'steps' for every code workflow today
}
export const CODE_WORKFLOWS: readonly CodeWorkflowSource[];
export const WRAPPED_AGENT_KEYS: readonly string[];  // ['assistant', 'rfp', 'data-readiness']
export const ASSISTANT_WORKFLOW_ID = 'agent:assistant';
export const ASSISTANT_WORKFLOW_NAME = 'Assistant';
export const ASSISTANT_WORKFLOW_DESCRIPTION = 'Answers questions over the datasets you pick.';
export function agentWorkflowId(agentKeyOrId: string): string;          // 'agent:' + key
export type ParsedWorkflowId =
  | { kind: 'code'; source: CodeWorkflowSource }
  | { kind: 'builtin-agent'; agentKey: string }       // key in WRAPPED_AGENT_KEYS
  | { kind: 'user-agent'; agentId: string };          // 'agent:' + anything else; the caller checks the collection
export function parseWorkflowId(id: string): ParsedWorkflowId | undefined; // undefined: unknown, a system/showcase key, or the primaryFor agent of a code workflow
export function sessionWorkflowId(s: Pick<SessionDoc, 'workflowId' | 'agentKey' | 'agentId'>): string;   // 4.3
export function workflowsUsingAgent(agentKey: string, opts: { userAgentLive?: boolean; builtin: boolean }): string[]; // ids in catalogue order
export function oneStepWorkflowSteps(agent: { name: string; tools: string[]; maxSteps: number }): AgentWorkflow['steps'];
```

`oneStepWorkflowSteps` returns the `answer` step with:
- `agent` set to the given agent;
- one more exit, `{ label: 'Clarifying question', outcome: 'stops' }`, appended when `tools` includes `ask_clarification`.

### 5.2 Routes and shapes

These endpoints are new. Number them **116** and **117** in [api.md](../../specs/system/api.md); 115 is the highest today. Put them in a new section **2.6.2 Workflows** after 2.6.1 Skills: controller prefix `/workflows`, capability [workflows](../../specs/capabilities/workflows/spec.md).

```ts
// 116. GET /workflows → 200 { workflows: WorkflowSummary[] }
type WorkflowSummary = {
  id: string;                       // 'qti-v2-turn' | 'agent:<registry key>' | 'agent:<user-agent id>'
  name: string;
  description: string;
  kind: 'code' | 'agent';           // code-defined, or the one-step workflow of an agent
  owner: 'Official' | 'You';        // 'You' for a user agent's workflow
  agents: { key: string; name: string }[];   // the agents its steps call, in step order, each once
  stepCount: number;
  bar: 'steps' | 'agent';           // what drives a chat's workflow bar: these steps, or the agent's own phases
  picksDatasets: boolean;           // the session takes the datasets the user picks (Assistant, Questions to Insights v2)
  datasets: string[];               // the datasets a session would take; [] when picksDatasets
  missingDatasets: string[];        // named datasets that don't exist (as AgentSummary.missingDatasets)
  starterQuestions: string[];       // the agent's, as AgentSummary.starterQuestions
  chatRequirement?: string;         // why a chat can't start now; absent when it can
};

// 117. GET /workflows/:id → 200 WorkflowDetail, or 404 (Style B) "Workflow \"<id>\" not found"
type WorkflowDetail = WorkflowSummary & {
  steps: AgentWorkflow['steps'];    // AgentWorkflow exactly as api.md 34 defines it (copied below)
};
// AgentWorkflow = { id: string; steps: { id: string; title: string; kind: 'code' | 'agent'; summary: string;
//   input: string[]; output: string[]; agent?: { name: string; tools: string[]; maxSteps: number };
//   exits: { label: string; outcome: 'fails' | 'stops' }[] }[] }
```

A `WorkflowDetail` is structurally an `AgentWorkflow` (it has `id` and `steps`), so the 1.23.1 component takes it as its `workflow` input unchanged.

**Catalogue values.**

| id | name | kind | agents | stepCount | bar | picksDatasets | datasets / requirement |
|---|---|---|---|---|---|---|---|
| `agent:assistant` | `Assistant` | agent | `assistant` (Questions to Insights Assistant) | 1 | agent | true | none |
| `qti-v2-turn` | `Questions to Insights v2` | code | `assistant-v2` | 4 | steps | true | none |
| `agent:data-readiness` | `Data Readiness Agent` | agent | `data-readiness` | 1 | agent | false | as its AgentSummary (`Add a PostgreSQL or Databricks dataset first`) |
| `agent:rfp` | `RFP Builder` | agent | `rfp` | 1 | agent | false | as its AgentSummary (`Load the "Intellify RFP API" sample in Settings → Testing Data first`) |
| `agent:<id>` (each Live user agent) | its Live name | agent | the user agent (`key` = id, `name` = Live name) | 1 | agent | false | its Live datasets that exist; `chatRequirement` `None of this agent's datasets exist` when none do |

Description, starter questions and missing datasets come from the agent's catalogue entry. The two exceptions are the Assistant's description (5.1) and v2's starter questions, which are empty, as in its AgentSummary.

**Order:** `agent:assistant`, `qti-v2-turn`, then the other Official workflows by name, then the user agents' workflows by name. Showcase agents, System agents and draft-only user agents are never listed.

**Steps of a one-step workflow:** `oneStepWorkflowSteps({ name: <agent name>, tools: <AgentSummary.tools>, maxSteps })`.
- `maxSteps` is 15 for `assistant`, `rfp` and user agents, and 10 for `data-readiness`.
- For `qti-v2-turn`, `steps` equals `agentWorkflow('assistant-v2').steps`.

**Amended endpoints.**

- **3. `POST /sessions`** also takes `{ workflowId: string; name?: string; datasets?: string[] }`.
  - With a `picksDatasets` workflow (`agent:assistant`, `qti-v2-turn`), `name` and `datasets` are required and validated as without `agentId` (`"session name is required"`, `"select at least one dataset"`).
  - With any other workflow, `datasets` is ignored and `name` is optional, as with `agentId` today.
  - Resolution: `agent:assistant` creates a plain session; `qti-v2-turn` creates it as `agentId: "assistant-v2"` does; `agent:<key|id>` creates it as `agentId: <key|id>` does. The refusals are the same texts (requirement text, `Publish "<name>" before starting a chat`, `None of this agent's datasets exist`).
  - An unknown id, a draft-only agent's id, or the id of a System, showcase or `primaryFor` agent fails with `"Workflow \"<id>\" not found"` (Style A).
  - `workflowId` together with `agentId` fails with `"Send workflowId or agentId, not both"`. With `workflowId`, `preview` is ignored.
  - **Every** session created from this version on stores `workflowId`, whichever body form created it. `agentId`, a plain body and a preview all store their derived id.
  - `agentId` bodies keep working unchanged: evals, backend e2e and previews use them.
- **2.1 the session on the wire** gains an always-present, derived `workflowRef: { id: string; name: string; kind: 'code' | 'agent'; deleted: boolean }`.
  - `name` is the workflow's catalogue name. For a user agent's workflow it is the agent's Live name; for a preview, the draft's name; for a deleted agent, the stored `agentName`, with `deleted: true`.
  - It is computed on every read, never stored.
  - The existing `agent` and `workflow` (the bar's `WorkflowView`) fields are unchanged. `workflow` keeps its meaning: it is not renamed.
- **34. `GET /agents/:key`** gains an always-present `usedInWorkflows: { id: string; name: string }[]`, in catalogue order:
  - `assistant` → `[agent:assistant]`, `assistant-v2` → `[qti-v2-turn]`, `rfp` → `[agent:rfp]`, `data-readiness` → `[agent:data-readiness]`;
  - a Live user agent → `[agent:<id>]`;
  - a draft-only user agent, System agents and showcase agents → `[]`.

### 5.3 Persisted fields

`sessions` ([data-model.md](../../specs/system/data-model.md) 3.4) gains one optional field: `workflowId` (string). Its meaning: the workflow the session runs (api.md 116).
- It is set at creation from this version on and never changed.
- When it is absent (sessions saved before), the workflow is derived at read time from `agentKey` / `agentId` (agents.md 5.12).
- No migration.

Nothing else changes: `agentKey`, `agentId`, `agentName`, `workflowState` and `panelItems` are written exactly as today. No new collection.

### 5.4 Mastra

`agent-turn` (owned by 1.23.4):
- `inputSchema` `{ question: string, datasets: string[] }`;
- one step `answer` with the same input and the output `{ calls: { tool, rowCount?, failed }[], stopped: boolean }` (the `analyseOutcome` schema of `qti-v2-turn`);
- workflow `outputSchema` = the step's output;
- `shouldPersistSnapshot: () => false`.

The step reads `AgentTurnRuntime` from the request context and returns `runtime.answer()`. It never bails, because one step has nothing after it. A unit test checks the step's schema field names against `AGENT_TURN_STEPS`, as `qti-v2-turn.workflow.spec.ts` does.

### 5.5 Orchestrator rules (1.23.4)

- `runAssistantV2Workflow` becomes `runTurnWorkflow(session, workflow, emit, runtime)`.
  - It starts `mastra.streamWorkflow(engineId, { question, datasets }, requestContext)`, where `engineId` is the code workflow's id or `agent-turn`.
  - It reads the step events.
  - **Only when the workflow's `bar` is `steps`**, it maps them through `workflowRunState`, saves the state and emits `workflow`, exactly as today.
- The agent step's error rule:
  - The `answer` runtime is today's `consume(await agent.stream(input, options))`.
  - After `consume`, it throws only when `chatTurnError(streamError)` returns a different error (a custom endpoint, llm-settings R50/R51). That is 5.1's rule, moved into the step.
  - Any error thrown by `agent.stream()` itself propagates as the step's error.
  - `runTurnWorkflow` rethrows the step's **own** error object when the run fails (the `analyseError` capture, generalised), so the `error` event's text is the same as today.
- Clarification and Stop abort the agent stream, and the step returns `stopped: true`. Persisting the clarification, and skipping `done` on a client abort, happen after the run as today.
- `workflowSourceOf(session)` returns `'workflow'` when the session's workflow `bar` is `steps`, else `'prompt'`. `effectiveWorkflowFor` is otherwise unchanged.
- The Analyse step of v2 keeps its own rule ("any model error fails the step") and its catalog block.

### 5.6 Frontend types (owned as marked)

```ts
// frontend/src/app/features/workflows/services/workflows-api.service.ts   (1.23.5)
export interface WorkflowSummary { /* exactly 5.2 */ }
export interface WorkflowDetail extends WorkflowSummary { steps: AgentWorkflow['steps']; }
// WorkflowsApiService: getWorkflows(): Observable<{ workflows: WorkflowSummary[] }>;
//                      getWorkflow(id: string): Observable<WorkflowDetail>   (id passed through encodeURIComponent)
// SessionsApiService gains createFromWorkflow(workflowId: string, name?: string, datasets?: string[]) (1.23.5)

// frontend/src/app/features/sessions/models/session.model.ts               (1.23.6)
export interface SessionWorkflowRef { id: string; name: string; kind: 'code' | 'agent'; deleted: boolean; }
// Session gains workflowRef?: SessionWorkflowRef
export function sessionWorkflowLabel(ref: SessionWorkflowRef): string;   // deleted → `${name} · agent deleted`

// frontend/src/app/features/agents/services/agents-api.service.ts         (1.23.7)
// AgentDetail gains usedInWorkflows: { id: string; name: string }[]
```

### 5.7 Navigation state (app.ts)

- `MainView` gains `'workflows'` and `'workflow-detail'`; `Area` gains `'workflows'`; `AREA_ROOT.workflows = 'workflows'`; and `AREA_OF_VIEW` maps both views to `'workflows'`. Owned by 1.23.5.
- New members, owned by 1.23.5:
  - `openWorkflow(id: string)` opens `workflow-detail`, from the list, from an agent's Used-in chip or from a session chip;
  - `startChatWithWorkflow(w: WorkflowSummary)`.
- `openComposer(preselect?: string)`:
  - 1.23.5 calls it with today's meaning, an **agent key** (for `picksDatasets` workflows: `undefined` for `agent:assistant`, `'assistant-v2'` for `qti-v2-turn`);
  - 1.23.6 changes the parameter to a **workflow id** and updates that one call site.
- `startChatWithAgent` and its helpers are removed by 1.23.7, not before.

### 5.8 Test ids and copy

| Where | Element | Test id | Copy |
|---|---|---|---|
| Rail | button | (title/aria) | `Workflows`, lucide `workflow` icon, between Datasets and Agents |
| Workflows page | `h2` | `workflows-page` (on the page root) | `Workflows` |
| | note | — | `Each chat runs a workflow. Its steps call agents, and agents use skills and tools.` |
| | search | `workflow-search` | placeholder and aria-label `Search workflows by name or description` |
| | sections | `workflow-section-official`, `workflow-section-mine` | `Official`, `Mine` (Mine omitted when empty) |
| | card | `workflow-card-<id>` | — |
| | open control | `workflow-<id>` | name, description (2 lines), chip, `Uses <agent names, comma-separated>` (`workflow-uses-<id>`) |
| | kind chip | `workflow-kind-<id>` | code: `<n> steps` (`chip-info`); one-step: `One step` (`chip-neutral`) |
| | missing datasets | — | `Missing dataset: <names>` (`chip-warning`, as agent cards) |
| | Start chat | `workflow-start-chat-<id>` | `Start chat`, aria-label `Start chat with <name>`; disabled with `chatRequirement` as title |
| | states | — | `Loading workflows…`; `No workflows match "<query>"`; inline error or `Backend unreachable` |
| Workflow page | back | `workflow-back` | `All workflows` |
| | header | `workflow-detail-name`, `workflow-detail-id` | name `h2`, id monospace, description |
| | Start chat | `workflow-start-chat` | `Start chat` / `Starting…`; disabled with `chatRequirement` as title, and the same text at its left in 12 px `fg-muted` (`workflow-chat-requirement`) |
| | drawing | `agent-workflow` (the 1.23.1 component, unchanged) | `h3` `What happens on each message` |
| | bar note | `workflow-bar-note` | steps: `In a chat, the workflow bar shows these steps as they run.` · agent: `In a chat, the workflow bar shows the agent's own steps as it sets them.` |
| | agents | `workflow-agent-<agent key>` (buttons) | `h3` `Agents`; each row: agent name and `Official`/`You`; aria-label `Open agent <name>` |
| New conversation | field | `new-session-workflow` (replaces `new-session-agent`) | label `Workflow`; listbox `aria-label="Workflow"` |
| | description | `new-session-workflow-description` | the workflow's description (Assistant: `Answers questions over the datasets you pick.`) |
| | datasets | `new-session-workflow-datasets` | caption `Datasets` + chips |
| | Create title | — | picks datasets: `Name the session and select at least one dataset` (unchanged); other: `Start a session with this workflow` |
| Chat header | chip | `session-workflow` (replaces `session-agent`) | label `Workflow`, chip `workflowRef` label; shown for **every** session |
| Sessions list | row chip | `row-session-workflow` (replaces `row-session-agent`) | the workflow label; tooltip `Workflow: <name>` |
| Agent page | used in | `agent-used-in`, chips `agent-used-in-<workflow id>` (buttons opening the workflow) | label `Used in`; empty: user draft `Not used in any workflow yet. Publish it to get its one-step workflow.`; System `Not used in any workflow. The app calls this agent itself.`; showcase `Not used in any workflow.` |

Ids contain `:` (`agent:rfp`). That is valid in `data-testid` and in URL path segments. The frontend always sends ids through `encodeURIComponent`, and NestJS decodes `:id`.

## 6. Spec changes

Each story updates the specs of its own change, before its code (workflow step 5). 1.23.2 changes only the decision documents. A rule number in **bold** is new.

| File | Story | Change |
|---|---|---|
| [architecture.md](../../specs/system/architecture.md) | 1.23.2 | ADR-0040 (section 3). The Status line of ADR-0008, 0028, 0029 and 0034 gains "amended by ADR-0040". 1.23.4 adds `agent-turn` to the Level 3 component prose where `qti-v2-turn` is named. |
| [epics/M1-23/spec.md](../../specs/epics/M1-23/spec.md) | 1.23.2 | Retitled `M1-23 — Workflow-first: chats start from a workflow`; `Status: Draft` until the user confirms; Goal, Scope, Out of scope, Stories (1.23.1–1.23.7), Specs touched, Acceptance (section 7's acceptance, summarised) and Risks rewritten; 1.23.1 kept as the first story. The old "No ADR" line goes. |
| [specs/README.md](../../specs/README.md) | 1.23.2, 1.23.3 | 1.23.2: the epic row's title. 1.23.3: a capability row `[workflows](capabilities/workflows/spec.md) \| The workflow catalogue: code-defined and one-step workflows, the Workflows pages, starting a chat from a workflow \| Workflows (E2E: none yet)`, which becomes `workflows.spec.ts` in 1.23.5. |
| [roadmap.md](../../roadmap.md) | 1.23.2 | Milestone heading `### Milestone 1.23 — Workflow-first: chats start from a workflow (M1-23)`, the intro rewritten, and features 1.23.2–1.23.7 (section 7), linked to this plan. |
| [product/glossary.md](../../specs/product/glossary.md) | 1.23.2 | New: **Workflow** (a fixed sequence of steps defined in code that a chat runs on each message; each step is code or calls an agent), **One-step workflow** (the workflow the app makes for an agent with no workflow of its own: one step that runs the agent), **Code-defined workflow**. Amended: **Session** (runs one workflow), **Agent** (a building block that workflow steps call). |
| capabilities/**workflows**/spec.md (new) | 1.23.3, 1.23.5 | All required sections (Concepts, Rules, Edge cases and errors, Contracts, UI, Flows, Acceptance). 1.23.3 writes R1–R4 and Contracts; 1.23.5 writes R5–R10, UI and the Feature. The rules are listed below the table. |
| [sessions-chat](../../specs/capabilities/sessions-chat/spec.md) | 1.23.3, 1.23.4, 1.23.6, 1.23.7 | 1.23.3: **R65**, a session runs one workflow; R61 says a bound built-in agent's session runs its workflow. 1.23.4: R61's turn wording (every streamed turn is a workflow run; nothing else changes). 1.23.6: R64 rewritten for the Workflow field; R57/R63 chips name the workflow, shown for every session. 1.23.7: R52 reworded "Start chat on a workflow" (creation semantics unchanged, keyed by workflow); the UI lines 259/267/269. |
| [agents-evals](../../specs/capabilities/agents-evals/spec.md) | 1.23.7 | R5 (Official agents lose Chat Box and Start chat; the default tab for an Official agent is System Prompt), R53 rewritten (Start chat is offered on workflows, workflows R6, never on agents), R90 (Chat Box: user agents only), R106 (showcase: no workflow, no Start chat anywhere), **R109** (Used in workflows, with its empty texts). The Agent Hub Feature: Start chat scenarios move to the workflows Feature; a new scenario for R109. |
| [app-shell](../../specs/capabilities/app-shell/spec.md) | 1.23.5 | R3 (six items; Workflows stays current on the workflow page; choosing it there returns to the list), R36/R37 (names), the Navigation rail Feature (a step for Workflows). |
| [agent-panel](../../specs/capabilities/agent-panel/spec.md) | 1.23.4 | R8a (a workflow-backed agent is the agent of a code-defined workflow), R15 (a one-step workflow never writes the state; the bar's sources are unchanged). |
| [rfp](../../specs/capabilities/rfp/spec.md) | 1.23.7 | R1/R2: the RFP Builder's **workflow** offers Start chat, not the agent; UI line 77; scenarios "Start chat is blocked…" and "Start chat opens…" go through the Workflows page. |
| [data-readiness](../../specs/capabilities/data-readiness/spec.md) | 1.23.7 | R2 as rfp. |
| [api.md](../../specs/system/api.md) | 1.23.3 | Section 2.6.2 with 116 and 117; 3 (`workflowId`); 2.1 (`workflowRef`); 34 (`usedInWorkflows`); the table in 2.1 notes "capability: workflows". |
| [data-model.md](../../specs/system/data-model.md) | 1.23.3 | 3.4 `workflowId` row; 3.13 the relationships (session → workflow, derived). |
| [agents.md](../../specs/system/agents.md) | 1.23.3, 1.23.4 | 1.23.3: a new **5.12 Workflows: the catalogue, ids and the one-step workflow** (sections 4.2–4.3 and 5.1 of this plan, in spec words). 1.23.4: 1.2's implementation note (two registered workflows); 5.1 "Per-agent turn" (every streamed turn is one workflow run, and the steps above happen inside its agent step); 5.11 (v2 is one entry of the catalogue); the "Invoked by" tables of 2.1, 2.8 and 2.10 (the `Answer` step of `agent-turn`). |
| [ui.md](../../specs/system/ui.md) | 1.23.5, 1.23.6, 1.23.7 | 1.23.5: 1.3 rail item, 1.4 the two views, a new **4.4a Workflows** and **4.4b Workflow detail**. 1.23.6: 4.7 composer (Workflow field), 4.12 header chip, 4.7.1 row chip. 1.23.7: 4.4 card (no Start chat), 4.5 actions (no Start chat; Used in line), 4.5.8 (Official branch removed). |

**Rules of the new `workflows` capability.**
- **R1:** the catalogue lists the code-defined workflows and the one-step workflows of the assistant, the RFP Builder, the Data Readiness Agent and each Live user agent, in the order of 5.2; nothing else.
- **R2:** workflow ids (4.3).
- **R3:** workflows are defined in code. The app SHALL NOT offer any control that creates, edits, reorders or deletes a workflow or a step, and the API has no write route for workflows.
- **R4:** a session's workflow is stored at creation, and derived from its agent binding for older sessions.
- **R5:** the Workflows page.
- **R6:** Start chat on a workflow (picks datasets → composer preselected; else created at once, with the toast; disabled with `chatRequirement`).
- **R7:** the workflow page.
- **R8:** the agents list opens the agent.
- **R9:** a deleted or unpublished user agent's workflow leaves the list.
- **R10:** the bar note.

**What `check-specs.py` will require, and in which story:**
- `GET /workflows` and `GET /workflows/:id` written in api.md as `` `GET /workflows` `` and `` `GET /workflows/:id` `` (1.23.3);
- the `workflows` capability folder with all seven sections and its README row (1.23.3);
- `frontend/e2e/workflows.spec.ts` named on exactly one Feature's `E2E:` line, in the workflows spec (1.23.5);
- the epic spec with a Status (1.23.2);
- `evidence/<id>/` existing before the roadmap links it (every story);
- no new collection and no new registered agent. `agent-turn` is a workflow, so the agent count is unchanged.

## 7. Stories

These entries are ready to paste under Milestone 1.23, in dependency order. 1.23.1 keeps its entry. Their links are relative to `roadmap.md`, where they are pasted.

**Can run in parallel:**
- 1.23.4 and 1.23.5, once 1.23.3 is merged.
- 1.23.6 and 1.23.7, once 1.23.5 is merged. Both edit `app.ts`/`app.html`, in disjoint regions: 1.23.6 owns `openComposer`, `createSession`, the composer template, the header chip and the Sessions list chip; 1.23.7 owns `startChatWithAgent`, the agent-card, agent-detail and agent-chat-box components and `agent-hub.util.ts`. Merge 1.23.6 first and re-run 1.23.7's gates after.
- 1.23.4 touches no frontend file.

#### 1.23.2 — Workflow-first: ADR, epic spec, glossary and roadmap  `📋 Planned`
- **Intent:** the move to workflow-first is decided and scoped before any code, so each later story can be built and reviewed on its own.
- **Scope:**
  - ADR-0040 in `specs/system/architecture.md`, with the Status pointers on ADR-0008, 0028, 0029 and 0034;
  - `specs/epics/M1-23/spec.md` widened and set back to `Draft`;
  - the README epic row;
  - this milestone's heading, intro and features 1.23.2–1.23.7;
  - the glossary terms (section 6).
- **Out of scope:** product code; capability, api, data-model, agents and ui specs (each later story updates its own).
- **Acceptance:**
  - ADR-0040 is `Accepted`, and the user has confirmed the epic spec (`Status: Confirmed (<date>)`).
  - `python3 scripts/check-specs.py` passes.
  - `origin/main` was merged first and the ADR number re-checked.
- **Notes:** S-size docs story. Plan: [docs/plans/m1-23-workflow-first.md](docs/plans/m1-23-workflow-first.md).

#### 1.23.8 — Remove the showcase agents  `📋 Planned`
- **Intent:** the four showcase agents, which never run, are gone from the app, so the Agents library and the workflow catalogue only hold agents that do something.
- **Scope:**
  - Remove the Benchmarking, Survey, LAD COE and Strategy agents: `showcase.agents.ts`, `showcase-catalog.ts`, their registration in `mastra/index.ts`, their shipped prompts in `shipped-agent-prompts.ts`, and every showcase branch in `agents.service.ts`, `sessions.service.ts` and the agent hub, card, detail and page utilities (the Showcase chip, the reason text, `showcase` on `AgentSummary`).
  - Data left by them is ignored, never an error: a saved pin or a prompt override for one of their keys is skipped when the hub and the prompt endpoints read it. No migration.
  - Specs: agents-evals R106 is retired (kept as `R106. Retired (1.23.8): …`), with R1, R3, R5 and R90–R91 lines that name showcase agents; agents.md 2.9 and its registry lines; api.md 33 (`showcase`, its `chatRequirement`); sessions-chat R64's list; ui.md's showcase lines; the glossary entry. Past epic specs (BA-233, BA-305) stay as history.
- **Out of scope:** the System agents; any other agent; the workflow catalogue (1.23.3), which then has no showcase case.
- **Acceptance:**
  - The hub shows no showcase agent and no Showcase chip; `GET /agents/benchmarking` answers 404 `Agent "benchmarking" not found`.
  - The new-session picker lists no showcase agent.
  - With a pin and a prompt override saved for `strategy` in the data dir, the hub and `GET /agents` still load, and neither lists it.
  - `agent-hub.spec.ts` and `session-management.spec.ts` are updated in the same story; a grep for `showcase`, `benchmarking`, `lad-coe`, `survey` and `strategy` in `backend/src`, `frontend/src` and `frontend/e2e` finds no live code path.
  - Builds, unit tests, lint and check-specs are green.
- **Notes:** requested by the user on 2026-11-11 (answer to the plan's open question 1). Built right after 1.23.2 so 1.23.3–1.23.7 have no showcase case. UI story: its demo is recorded in the fast loop.

#### 1.23.3 — The workflow catalogue: list, detail, and sessions bound to a workflow  `📋 Planned`
- **Intent:** the backend knows every workflow a chat can run, can say which one a session runs and which workflows use an agent, and can start a session from a workflow id. No UI yet.
- **Scope:**
  - The framework-free modules `workflow-catalog.ts` and `agent-turn.steps.ts` (5.1). `agent-workflows.ts` reads v2 from `CODE_WORKFLOWS`.
  - `RFP_MAX_STEPS` and `DATA_READINESS_MAX_STEPS` move to `agent-constants.ts`.
  - `WorkflowsModule` / `WorkflowsService` / `WorkflowsController`: `GET /workflows`, `GET /workflows/:id` (5.2). `AgentsModule` exports `AgentsService`.
  - `POST /sessions { workflowId, name?, datasets? }`, with the resolution and refusals of 5.2. Every new session stores `workflowId`.
  - The session view's `workflowRef`; the agent detail's `usedInWorkflows`.
  - Specs: api.md (2.6.2, 3, 2.1, 34); data-model 3.4 and 3.13; agents.md 5.12; the new `workflows` capability (R1–R4, Contracts, other sections stubbed with `E2E: none yet`) and its README row; sessions-chat R65 and R61.
- **Out of scope:**
  - the turn path (1.23.4);
  - every UI change;
  - showcase and System agents in the catalogue;
  - editing workflows.
- **Acceptance:**
  - Unit tests:
    - `sessionWorkflowId` follows the table of 4.3, the deleted and unresolvable cases included;
    - `parseWorkflowId` refuses System, showcase and `primaryFor` keys;
    - the drift tests of 4.2;
    - the invariant that every creation path stores the id that its agent fields derive;
    - the catalogue order and values of 5.2 (with a mocked registry and agents collection);
    - `qti-v2-turn`'s detail steps equal `agentWorkflow('assistant-v2').steps`.
  - A backend e2e, `backend/test/workflows.e2e-spec.ts`:
    - `GET /workflows` on a fresh data dir lists `agent:assistant`, `qti-v2-turn`, `agent:data-readiness`, `agent:rfp` in that order, the last two with their `chatRequirement`;
    - a published user agent adds `agent:<id>`, and a draft-only one does not;
    - `GET /workflows/agent:sql-fixer` and `GET /workflows/agent:<draft id>` answer 404;
    - `POST /sessions { workflowId: 'qti-v2-turn', name, datasets }` creates a session with `agentKey: 'assistant-v2'`, `workflowId: 'qti-v2-turn'` and `workflowRef.name` `Questions to Insights v2`;
    - `{ workflowId, agentId }` and an unknown id are refused with the 5.2 texts;
    - a session created with a plain body reads `workflowRef.id` `agent:assistant`;
    - `GET /agents/assistant-v2` returns `usedInWorkflows: [{ id: 'qti-v2-turn', name: 'Questions to Insights v2' }]`.
  - The existing `agent-sessions.e2e-spec.ts` and `user-agents.e2e-spec.ts` pass unchanged.
  - check-specs, lint, builds and backend unit tests are green.
- **Notes:** API-only story: its demo is `evidence/1.23.3/demo.txt` (curl transcript). It owns `workflow-catalog.ts` and `agent-turn.steps.ts`; 1.23.4 only reads them.

#### 1.23.4 — Every streamed turn runs the session's workflow  `📋 Planned`
- **Intent:** there is one turn path. A turn of the assistant, the RFP Builder, the Data Readiness Agent or a user agent is a run of its one-step workflow, with exactly the same answer, events, bar and stored message as before.
- **Scope:**
  - `agent-turn.workflow.ts` (5.4), registered in `mastra/index.ts`.
  - `runTurnWorkflow` replaces `runAssistantV2Workflow` and the direct `agent.stream` branch (5.5).
  - The step error rule; the bar rule (`bar: 'agent'` never writes `workflowState`); `workflowSourceOf` from the catalogue.
  - A captured real trace of one wrapper turn and one v2 turn, read through Monitoring's queries. If the turn now carries workflow spans, Monitoring classifies the `workflow_run` and `workflow_step` span types as Framework spans (monitoring R39), so the waterfall, turn counts and agent column read as before.
  - Specs: agents.md 1.2, 5.1, 5.11 and the "Invoked by" tables; agent-panel R8a and R15; sessions-chat R61; architecture Level 3 prose; monitoring R39 (only if the trace shows workflow spans).
- **Out of scope:**
  - the non-streamed turn;
  - evals;
  - any change to an agent's prompt, tools, context or steps;
  - UI.
- **Acceptance:**
  - The existing unit suites pass with only v2's internal names adapted: `sessions.service.spec.ts`, `builtin-agent-sessions.spec.ts`, `readiness-sessions.spec.ts`, `assistant-v2-sessions.spec.ts`, `workflow-update.spec.ts`, `panel-items.spec.ts`.
  - New unit tests:
    - an assistant, an RFP and a user-agent turn each start one `agent-turn` run;
    - an RFP turn's `update_rfp` still moves the bar mid-turn, and the one-step run writes no `workflowState`;
    - a clarification still ends the turn with the card;
    - a custom-endpoint model error fails the turn with the R50 text, and an OpenAI-style stream error keeps today's handling;
    - an exception from `agent.stream()` reaches the `error` event with its own message;
    - `agent-turn`'s schemas match `AGENT_TURN_STEPS`.
  - Unchanged and green: the request-recording Playwright specs (`chat-and-visuals`, `agent-sessions`, `chat-clarification`, `agent-panel`, `rfp-builder`, `data-readiness`, `monitoring`).
  - The `getInstructions()` and tool-list hashes of `assistant`, `rfp`, `data-readiness` and `assistant-v2` are equal on base and branch, recorded in the evidence, so no eval run is needed.
  - Builds and check-specs are green.
- **Notes:**
  - Highest-risk story. Measure before designing: read the trace before changing Monitoring ([lessons.md](lessons.md) "Trace before theorising").
  - No UI: its demo is `evidence/1.23.4/demo.txt`, an SSE transcript of one assistant turn and one RFP turn, plus the trace summary.
  - Parallel with 1.23.5.

#### 1.23.5 — A Workflows area: list, workflow page and Start chat  `📋 Planned`
- **Intent:** the user opens **Workflows** on the rail, sees every workflow they can run, opens one to see what happens on each message and which agents it uses, and starts a chat from it.
- **Scope:**
  - The rail item (5.8) and the `workflows` and `workflow-detail` views (5.7).
  - The list page: search, the Official and Mine sections, cards with kind chip, `Uses …`, missing datasets and Start chat.
  - The workflow page: back, header, Start chat with its requirement, the 1.23.1 drawing fed by `GET /workflows/:id`, the bar note, and the Agents rows opening the agent detail.
  - Start chat:
    - a `picksDatasets` workflow opens the composer preselected (through today's agent-key parameter, 5.7);
    - any other workflow calls `POST /sessions { workflowId }`, toasts `Session "<name>" created` and opens the chat;
    - a refusal toasts the server's message or `Backend unreachable`.
  - The agents keep their own Start chat until 1.23.7.
  - Specs: app-shell R3, R36 and R37 and its Navigation rail Feature; the workflows capability R5–R10, UI and Feature `Workflows` (`E2E: \`frontend/e2e/workflows.spec.ts\``); ui.md 1.3, 1.4, 4.4a and 4.4b; the README row.
- **Out of scope:**
  - the composer's Workflow field (1.23.6);
  - removing Start chat from agents (1.23.7);
  - any workflow editing control;
  - a run's live status on the drawing.
- **Acceptance:**
  - `frontend/e2e/workflows.spec.ts`, Feature `Workflows`:
    - `@demo @story-1.23.5` *Open a workflow and start a chat from it*: open Workflows on the rail; see `Assistant`, `Questions to Insights v2`, `Data Readiness Agent` and `RFP Builder` under Official; open `Questions to Insights v2` and see its four steps in the drawing and the agent `Questions to Insights v2` under Agents; go back; open a published user agent's workflow under Mine, see `One step` and its single `Answer` step; click Start chat; see the toast and the chat open.
    - *A workflow that cannot start says why*: RFP Builder's Start chat is disabled with `Load the "Intellify RFP API" sample in Settings → Testing Data first`, on the card and on the page.
    - *Workflows can't be edited* (R3, the negative test): no Edit, New, Delete or step-reorder control exists on the list or the page.
    - *Search filters the list* and `No workflows match "zzz"`.
  - The Navigation rail scenario passes with Workflows.
  - The axe scan passes on both pages in both themes.
  - Unit tests: card ordering and grouping, and the Start chat branch per `picksDatasets`.
  - Builds, check-specs and the impacted Playwright specs (`navigation`, `layout-accessibility`) are green.
- **Notes:** UI story: its demo is recorded in the fast loop. Parallel with 1.23.4.

#### 1.23.6 — The New conversation screen picks a workflow; chats name their workflow  `📋 Planned`
- **Intent:** a chat is started by choosing a **Workflow**, and every chat says which workflow it runs, in its header and in the Sessions list.
- **Scope:**
  - The composer's Agent field becomes **Workflow**: the same listbox and keyboard behaviour (sessions-chat R64), options from `GET /workflows` in their order, Assistant preselected on every visit, a disabled option showing its `chatRequirement`, and test ids and copy from 5.8.
  - **Create** sends `POST /sessions { workflowId, name, datasets }` for a `picksDatasets` workflow, else `{ workflowId, name? }`.
  - `openComposer` takes a workflow id, and the call site of 1.23.5 is updated.
  - The header chip `Workflow` (every session) and the Sessions list chip from `workflowRef`; `sessionWorkflowLabel`.
  - No showcase case: the showcase agents are gone (1.23.8).
  - Specs: sessions-chat R57, R63, R64 and the UI lines; ui.md 4.7, 4.7.1 and 4.12; the Session management Feature.
- **Out of scope:** the agent pages (1.23.7); changes to the welcome block (it still reads `agent`, R58).
- **Acceptance:**
  - `session-management.spec.ts`:
    - `@demo @story-1.23.6` *I start a chat from the Workflow field*: open New conversation and see `Workflow` with `Assistant`; open the list and see `Assistant`, `Questions to Insights v2`, `Data Readiness Agent`, `RFP Builder` and a published user agent's workflow (no showcase agent); pick `Questions to Insights v2`, name the session, pick a dataset, Create; the chat header reads `Workflow` `Questions to Insights v2` and the workflow bar shows its four steps; back on Sessions, the row's chip reads `Questions to Insights v2` with tooltip `Workflow: Questions to Insights v2`.
    - The existing composer scenarios (R1, R64) are updated to the new test ids and copy.
  - A deleted agent's session shows `<name> · agent deleted` in both chips.
  - A session saved before this epic (seeded with only `agentKey: 'rfp'`) shows `Workflow` `RFP Builder`.
  - The axe scan passes on the composer in both themes.
  - In step 6, every spec using `new-session-agent*`, `session-agent` or `row-session-agent` is updated: `agent-sessions`, `agent-panel`, `session-management`, `data-readiness`.
- **Notes:** UI story. Parallel with 1.23.7 (ownership in the intro above).

#### 1.23.7 — Agents are building blocks: no Start chat, and "Used in" workflows  `📋 Planned`
- **Intent:** the Agents area is the library of building blocks. A chat is never started from an agent, and each agent says which workflows use it.
- **Scope:**
  - Start chat is removed from the hub cards and the agent detail.
  - The Official agents' Chat Box tab is removed, and their default tab becomes System Prompt (section 2, item 5). A user agent keeps Chat Box, the draft preview.
  - The `Used in` line in the agent header (5.8), from `usedInWorkflows`; each chip opens the workflow page.
  - `startChatWithAgent`, `newSessionAgentOptions` and their unused helpers are removed.
  - Specs: agents-evals R5, R53, R90, R106 and **R109**, and the Agent Hub Feature; sessions-chat R52's wording; rfp R1, R2 and its Start chat scenarios; data-readiness R2; ui.md 4.4, 4.5 and 4.5.8.
- **Out of scope:**
  - removing the `chatRequirement` and `starterQuestions` fields from `AgentSummary` (the workflows service reads them);
  - any change to the agent editor or the preview chat.
- **Acceptance:**
  - `agent-hub.spec.ts`:
    - `@demo @story-1.23.7` *An agent shows the workflows that use it*: open Agents; no card has Start chat; open `Questions to Insights v2` and see `Used in` `Questions to Insights v2`; click the chip and see the workflow page with Workflows current on the rail; open the RFP Builder agent, see no Chat Box tab, and System Prompt open.
    - A draft-only user agent shows `Not used in any workflow yet. Publish it to get its one-step workflow.`; after Publish it shows its workflow.
    - A System agent shows `Not used in any workflow. The app calls this agent itself.`
  - The RFP and data-readiness Start chat scenarios pass through the Workflows page (`rfp-builder.spec.ts`, `data-readiness.spec.ts`).
  - `agent-editor.spec.ts` (preview and Chat Box) passes unchanged.
  - The axe scan passes on the agent detail in both themes.
  - In step 6, every spec using `agent-start-chat`, `Start chat with`, `agent-tab-chat` or `agent-showcase-reason` is updated: `agent-hub`, `agent-sessions`, `agents`, `session-management`, `agent-panel`, `synthetic-data`, `rfp-builder`, `data-readiness`.
- **Notes:**
  - UI story.
  - After it, no epic PR opens until 1.23.1–1.23.7 have each passed the acceptance gate.
  - The changelog entry is written once, for the epic.

## 8. Risks and open questions

### Risks

1. **A regression in the turn path (1.23.4).** Every chat goes through the new path.
   - Mitigations: `consume`, `agentInput`, `agentOptions` and the post-run code are moved, not changed; the existing unit suites must pass unchanged; the request-recording Playwright specs assert what reaches the model; and the step error rule copies 5.1 exactly (in particular, non-custom stream errors are still swallowed).
   - Run the backend unit tests and Playwright one after the other, never together ([lessons.md](../../lessons.md)).
2. **Monitoring's trace shape.** A workflow run per turn may add `workflow_run` and `workflow_step` spans to each turn's trace, or put the agent run in another trace. Today this affects v2 sessions only; after 1.23.4 it affects every session.
   - Mitigation: in 1.23.4, capture one real trace first, then keep Monitoring R1, R27 and R39 true. Only if needed, classify workflow spans as Framework.
3. **Jest and Mastra's ESM.** The catalogue must not import Mastra. Two max-step constants live in Mastra-importing files today, and 4.2 moves them.
4. **A cycle between the `agents` and `sessions` modules.** `SessionsService` must resolve workflows from the pure catalogue, never through `WorkflowsService` (4.2).
5. **E2E churn.** Renamed test ids and the removed agent Start chat touch about eight Playwright specs. Step 6 greps each removed selector and copy text ([lessons.md](../../lessons.md)), and each story updates the specs it breaks in the same story.
6. **Parallel edits to `app.ts` and `app.html`** (1.23.5, 1.23.6, 1.23.7). Ownership is in 5.7 and in the intro to section 7. Merge in order, and re-run the later unit's gates.
7. **Ids with `:`.** Always `encodeURIComponent` on the client; a unit test calls `GET /workflows/agent%3Arfp`.
8. **The epic gate.** No code before the user confirms the widened epic spec and ADR-0040 (1.23.2). 1.23.1 is already committed under the old scope, and the widened spec keeps it.

### Open questions

None open. The user answered all of them on 2026-11-11 (section 2, items 4–7):
- showcase agents are removed from the app (1.23.8);
- the Official agents' Chat Box tab is removed;
- every chat shows its `Workflow` chip;
- the branch is renamed to `feat/M1-23-workflow-first`.

## 9. Amendment of 2026-11-11: workflows run on an input (story 1.23.9)

The user decided that workflows trigger **runs**, not chats: a workflow takes a typed input, runs its steps once and returns a result. The input of each workflow is defined in code and will grow over time. Answers given the same day:
- **All workflows become run workflows** (no workflow opens a chat). Converting the four existing chat workflows (Assistant, Questions to Insights v2, RFP Builder, Data Readiness Agent) and what that means for chats is story **1.23.10**, scoped once the user answers how chats start. 1.23.9 builds the run mechanism and leaves the four as they are.
- **The first run workflow is a sequential test workflow** of three code steps, no LLM.
- **A run's result is shown on the workflow page and never stored.**

### 9.1 Catalogue (framework-free, `workflow-catalog.ts`)

- `CodeWorkflowSource` gains `trigger: 'chat' | 'run'` and `input?: readonly WorkflowInputField[]`; `primaryFor` becomes optional (a run workflow may call no agent). The existing `qti-v2-turn` entry gets `trigger: 'chat'`.
- `WorkflowInputField = { name: string; label: string; type: 'text' | 'textarea' | 'number'; required: boolean; placeholder?: string }`.
- A one-step workflow (`agent:*`) has `trigger: 'chat'`.
- New entry, after `qti-v2-turn` in catalogue order:
  `{ id: 'seq-text-demo', name: 'Sequential test workflow', description: 'A three-step example: cleans a text, counts its words and characters, and formats the result. No LLM.', trigger: 'run', input: [{ name: 'text', label: 'Text', type: 'textarea', required: true, placeholder: 'Paste or type any text' }], steps: SEQ_TEXT_DEMO_STEPS }`.
- `parseWorkflowId` keeps resolving it as `{ kind: 'code' }`. A run workflow is never a session's workflow: `POST /sessions { workflowId: 'seq-text-demo' }` is refused with `Workflow "seq-text-demo" can't start a chat` (Style A, 400).

### 9.2 The test workflow (`seq-text-demo.steps.ts` framework-free, `seq-text-demo.workflow.ts` Mastra)

| # | id | title | kind | input | output | other exits |
|---|---|---|---|---|---|---|
| 1 | `clean-text` | Clean text | code | text | text | `Empty text` fails |
| 2 | `count-words` | Count words | code | text | text, words, characters | — |
| 3 | `format-result` | Format result | code | text, words, characters | summary | — |

Summaries: `Trims the text and collapses repeated spaces. An empty text fails the step.` · `Counts the words and characters of the cleaned text.` · `Writes a one-line summary of the counts and the start of the text.`

Pure functions: `cleanText(text)` (trim, collapse every run of whitespace to one space; empty → throws `The text is empty`), `countWords(text)` (`{ words, characters }`; words = whitespace-separated tokens), `formatResult({ text, words, characters })` → `summary` = `<words> word(s), <characters> character(s): "<first 60 characters>"` with `…` appended when the text is longer than 60. Registered on the Mastra instance as `seq-text-demo`, snapshot persistence off. A drift test checks the steps' schema fields against `SEQ_TEXT_DEMO_STEPS`, as for `qti-v2-turn`.

### 9.3 API

- `GET /workflows` and `GET /workflows/:id` items gain `trigger` and `input` (`[]` for a chat workflow).
- **118. `POST /workflows/:id/runs`** — body `{ input: Record<string, string | number> }`. Runs the workflow once and answers when it ends (no streaming; runs are short).
  - 200 `WorkflowRunResult = { workflowId: string; status: 'success' | 'failed'; steps: { id: string; title: string; status: 'success' | 'failed' | 'skipped'; output?: Record<string, unknown>; error?: string }[]; output?: Record<string, unknown>; error?: string }`. A failing step makes the run `failed` (still 200: the run happened); the steps after it are `skipped`.
  - Refusals (Style A, 400): `Workflow "<id>" runs in a chat` for a chat workflow; `<label> is required` for a missing required field; `<label> must be a number` for a non-numeric number field. 404 `Workflow "<id>" not found`.
  - Nothing is stored. The run is not a session and writes no workflow bar.
- `MastraService.runWorkflow(key, inputData)` creates a run, starts it and returns the step results and the final output.

### 9.4 UI

- **List card** of a run workflow: kind chip `Runs on an input`, no Start chat; a **Run** button (`workflow-run-open-<id>`) opens the workflow page.
- **Workflow page** of a run workflow: the drawing (1.23.1), then **Input**: one control per field (`workflow-input-<name>`: textarea, text or number input, with its label and placeholder; `aria-required` when required), and **Run** (`workflow-run`, disabled while running, label `Running…`). No Start chat and no workflow-bar note.
- **Result** (`workflow-run-result`), under the form after a run: a status line `Run succeeded` / `Run failed: <error>`, then one row per step (`workflow-run-step-<id>`) with its number, title, a status chip (`Done`, `Failed`, `Skipped`) and its output as pretty JSON (`<pre>`), and the final output (`workflow-run-output`). Running again replaces it; leaving the page discards it.
- The New conversation Workflow field lists chat workflows only.

### 9.5 Specs

ADR-0040 gains an amendment (workflows have a trigger, chat or run; a run workflow runs once on a typed input defined in code, and nothing is stored). `specs/capabilities/workflows/spec.md` (rules and a Feature scenario), `specs/system/api.md` (116/117 fields, 118, sessions refusal), `specs/system/agents.md` (the `seq-text-demo` workflow next to 5.11/5.12), `specs/system/ui.md` (4.4a/4.4b run controls), `specs/capabilities/sessions-chat/spec.md` R64 (chat workflows only).
