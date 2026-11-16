# Retire chats: every workflow runs on an input — plan

- **Origin:** the user's decisions of 2026-11-11 (section 2), recorded against M1-23 story 1.23.10, which was left open in [specs/epics/M1-23/spec.md](../../specs/epics/M1-23/spec.md). **Recommended home:** two new epics, M1-24 (Phase A) and M1-25 (Phases B and C); section 8 explains why.
- **Status:** Draft, written 2026-11-11 by the planning model. Once the user answers section 10 and confirms, this file is the **contract** the builders work from. Change it through the lead, never inside a unit.
- **Size:** L (architectural). It needs a new ADR, a new persisted collection, a new streamed endpoint, and it removes a container-level user flow (the chat).
- **Depends on:** M1-23 stories 1.23.1–1.23.9 merged to `main`: the workflow catalogue, `agent-turn`, the Workflows area and the run mechanism of 1.23.9 (`trigger`, typed `input`, `POST /workflows/:id/runs`, the run page). Read [m1-23-workflow-first.md](m1-23-workflow-first.md), sections 4, 5 and 9, first. This plan builds on their names.

## 1. Summary

Today a user asks questions in a **chat**. A chat is a session bound to a workflow, and each message runs that workflow once, with memory of the earlier messages. After this change there are no chats. The user opens a **workflow**, fills in its typed input (a question and datasets, a dataset, an RFP message), presses **Run**, watches the steps run, and gets a result.

What the user sees at the end of Phase A:

- The four chat workflows (Assistant, Questions to Insights v2, Data Readiness Agent, RFP Builder) and every Live user agent's workflow run on an input, like the 1.23.9 test workflow. Their results stream live: steps, the agent's reasoning and tool calls, then the answer with all its provenance blocks.
- Runs are kept. A **Runs** rail item replaces **Sessions** and lists past runs; opening one shows its input and result. *(Open question Q1.)*
- Existing chats stay on disk and open **read-only** under **Runs → Past chats**: transcript, visuals and downloads, but no composer. *(Q2.)*
- Nothing starts a chat: **Start chat**, the **New conversation** screen and the chat composer are gone.

What keeps working unchanged:
- every agent's prompt, tools, skills and context, so no eval run is needed;
- the grounding guard, SQL repair, result-quality warnings, careful mode, tool-only synthesis, visuals made by the agent, panel items, readiness reports and RFP packages, which all now happen inside a run;
- verified-query retrieval, metrics, the ontology, datasets, evals and Monitoring.

What is lost until Phase B, and listed in the epic spec as known gaps:
- deep analysis;
- generating, tailoring, reverting and refreshing a visual from a result;
- the agent editor's preview, which stays a chat until it is replaced.

## 2. Decisions already made (not to be re-litigated)

Made by the user on 2026-11-11:

1. Workflows trigger **workflow runs, not chats**. Each workflow's input is defined in code and will be defined as we go.
2. **All workflows become run workflows**: Assistant (`agent:assistant`), Questions to Insights v2 (`qti-v2-turn`), RFP Builder (`agent:rfp`), Data Readiness Agent (`agent:data-readiness`), and the one-step workflow of each user agent (`agent:<id>`).
3. **Chats are retired.** Asked "once no workflow opens a chat, how does a chat start?", the user chose "chats are retired: everything becomes running workflows".
4. Carried over from 1.23.9: runs are defined in code; a run's result is shown on the workflow's page. 1.23.9 also decided that a run is never stored. For the four agent workflows this plan recommends storing runs (Q1), because otherwise every answer is lost when the page is left.

## 3. Impact inventory

Fates used below:
- **Replaced** — by a run;
- **Read-only** — kept for existing data, with no new writes;
- **Internal** — kept in the backend only, because something not yet replaced depends on it;
- **Removed**;
- **Unchanged**.

The phase is where the fate lands (section 7). Specs named are the ones the change edits.

### 3.1 User interface

| # | Today | Fate | Phase | Notes and specs |
|---|---|---|---|---|
| U1 | **Sessions** rail item and the Sessions page list (past-chats R63, app-shell R3, R46, R49) | Replaced | A (1.24.11) | A **Runs** rail item in the same place opens the run history: a list with search, the workflow chip, the status, a title from the run's first text input, and the time. A **Past chats** tab, shown only when old sessions exist, lists the old sessions. ui.md 1.3, 4.7.1. |
| U2 | **New conversation** screen and **Start New Conversation** (R1, R64, ui.md 4.7) | Removed | A (1.24.12) | Its dataset picker is reused as the `datasets` input control. |
| U3 | Chat page: composer, Thinking block, Stop, error bubble and Retry, history strip, welcome block (R8–R16, R21, R45, R50, R51, R58; ui.md 4.12) | Replaced | A (1.24.5) | The run page has the input form, a live step list with the Thinking block inside the agent step, **Stop** and **Run again**. The history strip and the welcome block have no equivalent (there is no transcript). Starter questions become example chips that fill the question field. |
| U4 | **Start chat** on workflow cards and pages (workflows R6), and the chat-workflow-only picker (R64) | Removed | A (1.24.12) | Every card shows **Run** (1.23.9). |
| U5 | Chat header chips: Workflow, datasources, session id (R57, R62) | Read-only on past chats | A | A run page shows its workflow, its datasets and `Run <first 8 of id>` with copy. |
| U6 | Right panel and panel items (agent-panel R1–R12, ADR-0029) | Replaced | A (1.24.5) | The run page's right panel holds the run's items: visuals, documents, files, tables and the readiness scorecard. Past chats keep theirs, read-only. |
| U7 | Workflow bar (agent-panel R8–R18, ADR-0029/0034) | Replaced | A (1.24.5) | A code workflow's steps are the run's step list. A one-step workflow's agent phases (the assistant's Workflow block, the RFP stages, `update_workflow`) show inside the agent step's row, reusing the bar component. The per-browser fold preference stays. |
| U8 | Visual cards; **Generate interactive visuals**; tailor from the chat or the panel; revert, refresh, repair (visuals R2–R24) | Mixed | A, B | A visual the agent makes in a run (`create_visual`) shows in the panel, with its versions viewable and downloadable (A). Generate-from-answer, tailor, revert, refresh and repair on a run's visual come in B (1.25.4). "Tailor in chat" is removed for good. Past chats show visuals read-only. |
| U9 | Rating (thumbs) and the Verified badge (R35, R36) | Replaced | A (1.24.9) | Thumbs work on a run's answer. The badge is computed as today. |
| U10 | **Careful** toggle (R37–R40) | Replaced | A (1.24.5) | A `careful` boolean input on the Assistant and user-agent workflows. |
| U11 | **Deep analysis** composer action and report card (deep-analysis R1–R18) | Replaced | B (1.25.3) | It becomes a code-defined run workflow: Plan → Investigate → Write. It is unavailable between A and B; past report cards and downloads (api.md 48) keep working on past chats. |
| U12 | Clarification card (R41–R44) | Replaced | A (1.24.5) | A run that ends on `ask_clarification` succeeds with `answer.clarification`. Each option, Something else and Skip start a new run that carries the earlier question and the clarifying question as context (5.4, Q4). |
| U13 | Agent editor preview chat; user agents' **Chat Box** tab (agents-evals R60, R61, R90; ui.md 4.5.1, 4.5.8) | Internal in A, Replaced in B | B (1.25.2) | **Try it**: a run of the draft, with the run page's form and result inside the Details panel and the tab. It is the last chat surface left in Phase A (Q5). |
| U14 | Home welcome (app-shell R51, ui.md 4.1) | Replaced | A (1.24.12) | Step 2 becomes "Run a workflow" (opens Workflows); step 3 "Agents are the building blocks" (opens Agents). The copy is in 1.24.12. |
| U15 | Visuals library on the Context page (visuals-library) | Unchanged | — | A chart-type catalogue. It is not tied to sessions (R15 there). |
| U16 | User personas (Context) | Unchanged | — | Manage-only, read by nothing. |
| U17 | Monitoring: Sessions tab, session page, LLM calls Session column and filter (monitoring R3, R6, R26–R44) | Replaced | A (1.24.10) | The tab becomes **Runs**. One row per run, named `<workflow>: <run title>`. Old sessions stay listed, marked `Past chat`. The Session column and filter become `Run or chat`. |
| U18 | Data Readiness scorecard and Past assessments (data-readiness R25, R26) | Unchanged | — | Shown in the run's panel instead of the session's. |
| U19 | Dataset editor **Profile & synthesize** tab (synthetic-data) | Unchanged | — | Not chat-bound. |

### 3.2 Endpoints ([api.md](../../specs/system/api.md))

| Route | Fate | Phase | Why |
|---|---|---|---|
| 1 `GET /sessions`, 2 `GET /sessions/:id`, 4 `DELETE /sessions/:id` | Read-only (kept) | — | Past chats. Endpoint 1 is also the desktop readiness probe until 1.24.12 moves the probe to `GET /health`. |
| 3 `POST /sessions` | Internal, then Removed | A internal; C removed | Evals, the preview and E2E seeding use it until 1.25.2 and 1.25.5. In A, `workflowId` bodies are refused for every workflow (`Workflow "<id>" runs on an input`); `agentId` and `preview` bodies keep working. |
| 5 `POST /sessions/:id/messages/stream` | Internal, then Removed | C | Only the preview calls it after A. |
| 6 `POST /sessions/:id/messages` (legacy, unused) | Removed | C | |
| 7 feedback | Removed | C | Past chats are read-only; run feedback is new route R10. |
| 8 `POST …/visualizations`, 10 tailor, 11 revert, 12 refresh, 13 repair | Removed | C | Their run equivalents arrive in B. |
| 9 `GET …/visualizations/:vid`, 14 download, 105, 106, 107 | Read-only (kept) | — | Past chats. |
| 46, 47 deep analysis start and poll | Removed | C | Replaced by the deep-analysis run (B). |
| 48 deep-analysis download | Read-only (kept) | — | Past report cards. |
| 116, 117 workflows | Changed | A | `input` filled for the four; `runRequirement` added; `picksDatasets` and `chatRequirement` dropped in 1.24.12. |
| 118 `POST /workflows/:id/runs` | Changed | A | Stores the run (Q1) and returns its `runId`. Accepts any workflow with input fields. |
| New R1–R12 | New | A, B | Section 5.2. |
| 34 `GET /agents/:key` | Unchanged | — | `usedInWorkflows` stays. |
| 108–110 readiness, 111–115 monitoring | Unchanged shape | A | Monitoring reads run names (1.24.10). |
| Intellify RFP API (2.16) | Unchanged | — | RFP records already live there. |

### 3.3 Stored data ([data-model.md](../../specs/system/data-model.md))

| Store | Fate | Notes |
|---|---|---|
| `sessions` collection | Read-only | No migration and no deletion. The user may still delete a past chat; that removes its document, memory thread and workspace, as today (R4). `workflowId` and the derivation rule stay for past chats. |
| Agent memory threads (`mastra.sqlite`) | Read-only | Never written again for past chats, which have no composer. Runs use no lasting memory (5.4). Deleted with a past chat. |
| `workspaces/session-<id>/` | Read-only | Visuals, reports, RFP packages and synthetic SQL of past chats stay downloadable. |
| `workspaces/session-preview-*` | Unchanged, then Removed | Swept at start-up as today, until previews go (C). |
| **`workflow_runs` (new)** | New | Section 5.3. One document per run. |
| `workspaces/session-run-<run id>/` (new) | New | A run's workspace, with the session workspace layout (4.1). Using the `session-` prefix means today's registration scan and safe-path checks apply unchanged. It is deleted with the run. |
| `verified_queries` | Changed (additive) | `sourceSessionId` becomes optional and `sourceRunId` (optional) is added. A run's pair dedupes on `sourceRunId` (1.24.9). Old pairs are untouched and still retrieved (R8). |
| `readiness_reports` | Changed (additive) | `runId` (optional) beside `sessionId`. A report made by a run stores `runId`, never a run id in `sessionId` (1.24.6). |
| `metrics`, `ontology_items`, `eval_runs`, `agents`, `user_personas`, `visual_charts`, `settings` | Unchanged | |
| `observability.duckdb` | Unchanged | It already records every agent run. A run's agent call has `threadId` = the run host id (5.4). |
| Renderer `workflow-bar-collapsed` key | Unchanged | Used by the agent-phases bar inside a run's step. |

### 3.4 Agents, tools and evals ([agents.md](../../specs/system/agents.md))

| Item | Fate | Notes |
|---|---|---|
| Prompts, tool lists, skills, context blocks of `assistant`, `assistant-v2`, `rfp`, `data-readiness`, user agents | Unchanged | Hashes of `getInstructions()` and tool lists are equal on base and branch, recorded in 1.24.2's evidence. No eval run is required. Prompts still say "chat" or "conversation" in places; changing that would need evals, so it is deferred (risk 6). |
| `ask_clarification`, `show_in_panel`, `update_workflow`, `create_visual`, `update_visual` | Unchanged | They write to the run host exactly as they write to a session (5.4). |
| RFP tools, `turn-rfp`, `rfpId` | Unchanged | `rfpId` is stamped on the run instead of a session. |
| Readiness and synthetic-data tools | Unchanged | The `tool-progress` event is forwarded in the run stream (ADR-0033). |
| requestContext `session-id`, `session-workspace-id` | Unchanged name | They carry the run host's id and workspace. The rename to `host-id` is Phase C (1.25.5). |
| Memory (4.3, data-model 5) | Changed | Runs use none that lasts. Context from one earlier run goes through the transcript bootstrap path of 4.3 (5.4). |
| Deep analysis (2.7) | Replaced | Phase B run workflow. Same three assistant calls. |
| Evals (8.3: throwaway session) | Internal | Unchanged in A and B. In C the throwaway session becomes a throwaway run host (1.25.5). |
| Golden-set harness (`backend/scripts/run-eval.ts`), `check-answers.ts`, `custom-endpoint-smoke` | Internal, then moved | They use the chat stream until C, then the run stream (1.25.5). |
| Non-streamed turn (5.1) | Removed | C. |

### 3.5 Tests

**Playwright specs that start or drive a chat:** `agent-panel`, `agent-editor`, `agent-sessions`, `chat-and-visuals`, `chat-clarification`, `assistant-skills`, `builtin-agent-prompts`, `designer-skills`, `data-readiness`, `layout-accessibility`, `llm-settings`, `llm-copilot`, `llm-custom-endpoint`, `monitoring`, `session-management`, `skill-library`, `visual-tailoring`, `rfp-builder`, `world-cup-workflow`, `synthetic-data`, `workflows` (21 specs).
- Most of them use the chat as the harness for **request recording**: they check what reaches the stub model.
- Each one moves to runs in the story that converts its workflow, or in the test-only story 1.24.8.
- None is skipped or `fixme`d. A scenario whose feature is retired is deleted, and its Gherkin is deleted in the same story.
- 1.24.12 is the last story of Phase A. When it starts, no spec may open the chat UI, except `agent-editor` (preview) and the past-chat scenarios.

**Backend e2e:** `agent-sessions`, `answer-guards`, `user-agents`, `response-status` and `app` create sessions through `POST /sessions`. They stay green in A, because the endpoint is internal and kept. In C, they move to runs or to a seeded data dir.

**Unit suites:** `sessions.service.spec.ts`, `builtin-agent-sessions`, `readiness-sessions`, `assistant-v2-sessions`, `turn-workflow-sessions`, `workflow-sessions`, `workflow-update`, `panel-items`. They stay green in A, because the turn path is reused unchanged. In C they are split along the extracted turn engine (1.25.5).

### 3.6 Packaging

- **npm CLI:** no change. Its contract (api.md 5) does not touch sessions.
- **Desktop app:** the Electron readiness probe calls `GET /sessions` (`frontend/electron/main.cjs` `backendIsReady`, api.md 4.3). That route returns every session with its full transcript, so it is a heavy probe. 1.24.12 moves the probe to a new `GET /health` (`{ ok: true }`) before anything else changes on the sessions routes. The desktop app and the backend ship together, so no version skew is possible.

## 4. What a run of each workflow takes and returns

### 4.1 Input fields

1.23.9 types are `text | textarea | number`. This plan adds the types below, owned by 1.24.2. Every input stays defined in code, per workflow, in the framework-free catalogue.

```ts
// backend/src/mastra/workflows/workflow-catalog.ts   (1.24.2 extends 1.23.9's type)
export type WorkflowInputFieldType =
  | 'text' | 'textarea' | 'number'                  // 1.23.9
  | 'boolean'                                       // a checkbox; absent means false
  | 'datasets'                                      // one or more dataset names (multi-select)
  | 'dataset';                                      // exactly one dataset name (single select)
export interface WorkflowInputField {
  name: string; label: string; type: WorkflowInputFieldType; required: boolean;
  placeholder?: string;
  help?: string;                                    // one line under the control
  default?: string | number | boolean;
  datasourceKinds?: ('postgres' | 'databricks' | 'rest')[];  // 'dataset' / 'datasets': only datasets bound to these kinds
  hidden?: boolean;                                 // set by the app (e.g. RFP Continue), never rendered as a control
}
```

**Validation** (Style A, 400, in field order, before anything runs):
- `<label> is required`;
- `<label> must be a number`;
- `Select at least one dataset` (`datasets`, required);
- `Dataset "<name>" not found`;
- `Dataset "<name>" is not a PostgreSQL or Databricks dataset` (a `datasourceKinds` mismatch, with the kinds named);
- `<label> must be true or false`.

Unknown input keys are ignored.

### 4.2 Per workflow

| Workflow (id unchanged) | Input fields | Run output | Turn features in the run |
|---|---|---|---|
| **Assistant** `agent:assistant` (1 step: Answer) | `question` textarea, required, placeholder `Ask a question about your data`. `datasets` datasets, required. `careful` boolean, label `Careful: cross-check the result with an independent query`, default false. | `answer` (the answer message: Markdown, data records, entities, interpretation line, reasoning trail, ontology in context, verified, cross-check, clarification?, visual event?). `panelItems`, `visualizations`, `workflow` (the agent's phases). The step output is `{ calls, stopped }`. | Grounding guard, tool-only synthesis, SQL repair, result-quality warnings, careful mode (from `careful`), visuals, panel items, clarification (as output), verified badge. |
| **Questions to Insights v2** `qti-v2-turn` (4 steps) | `question` textarea, required. `datasets` datasets, required. | `answer` (as above, without cross-check or clarification). The final output is Wrap up's `{ sqlQueries, failedQueries, rows }`. Each step's output shows in the step list. | Tool-only synthesis. As today, no grounding guard, careful mode or clarification. |
| **Data Readiness Agent** `agent:data-readiness` (1 step) | `dataset` dataset, required, `datasourceKinds: ['postgres','databricks']`. `question` textarea, optional, placeholder `Assess the readiness of this dataset`; empty means that text. | `answer` with `readinessReport`, and the `readiness:<id>` panel item (scorecard). File panel items for synthetic SQL scripts. The report is stored in `readiness_reports` with `runId`. | `tool-progress` on the running tool row, the readiness card, the scorecard and Past assessments, drill-down SQL, synthetic data tools, Stop cancelling the assessment (ADR-0033). One dataset per run, so the agent never needs to ask which one. |
| **RFP Builder** `agent:rfp` (1 step) | `message` textarea, required, placeholder `Name the client and plan year, or state your decision`. `rfpId` text, hidden: set by **Continue**, never typed. | `answer` with `rfpPackage` when exported; the RFP document panel item; `workflow` (stages from the record); `rfpId` (the RFP the run worked on, from `turn-rfp`). | Stage auto-drive of the phases, the package card and downloads (run-scoped), clarification. Section 4.3 has the design choice. |
| **User agent** `agent:<id>` (1 step) | `question` textarea, required. `careful` boolean, as the Assistant's. The datasets are the agent's Live datasets that exist, shown read-only above the form (not an input). | As the Assistant. | As the Assistant, plus the agent's Live instructions, overrides, tool selection and skills (agent-answers R54–R56). |
| **Sequential test workflow** `seq-text-demo` | Unchanged (1.23.9). | Unchanged. | — |

**Run requirement.** `runRequirement` replaces `chatRequirement` with the same texts:
- RFP Builder: `Load the "Intellify RFP API" sample in Settings → Testing Data first`;
- Data Readiness: `Add a PostgreSQL or Databricks dataset first`;
- user agent: `None of this agent's datasets exist`.

While it is set, **Run** is disabled with the text as its title, and a direct request is refused with it.

**Example inputs.** The agent's starter questions become chips under the question (or message) field. Clicking one fills the field and does not run.
- Assistant: R50's three prompts.
- Data Readiness: its three starters, which go into `question`.
- RFP Builder: its three starters, which go into `message`.
- User agent: its Live starters.

**Features that do not carry over into a run:**
- memory beyond one earlier run (5.4);
- the history strip and the welcome block;
- careful mode and the grounding guard for agents that never had them;
- deep analysis and visual actions after the run (Phase B);
- `activeVisualizationId`: a run has no open visual before it starts, so `update_visual` targets only a visual named by id or made earlier in the same run.

### 4.3 The RFP Builder

The agent's design is a conversation: one stage per exchange, saving only what the consultant confirms (rfp R4). The RFP record in the Intellify API holds the confirmed state between exchanges (R7). The options:

| Option | What a run is | Agent changes | Cost | Verdict |
|---|---|---|---|---|
| **A. One run per exchange, keyed by the RFP id** | A run is one exchange: the consultant's message plus, through **Continue**, the RFP id and the previous run's message and answer as context (5.4). The record carries the stages, and the RFP context block tells the agent the active RFP and its stage, as on every turn today. | None. Rule R4 already saves a decision stated outright in the same turn. A bare "yes" works because Continue carries the proposal it confirms. | Small: an input pair and a Continue button. | **Recommended.** |
| B. Paused | The RFP Builder workflow is listed but not runnable (`runRequirement` `The RFP Builder is being redesigned to run on an input`). Past RFP chats stay read-only; records and packages are safe. | None. | Smallest. | Fallback if A's UX is judged too clunky. |
| C. One code workflow per stage, with suspend and resume | Steps: Load RFP → Propose (agent, stage skill) → *suspend for the consultant's confirmation in a form* → Save (code). | Prompt and skills change, so the `rfp` eval set must pass at 100% over 3 runs (rfp R14). It needs Mastra suspend/resume and a run that outlives its request. | Large: a new run lifecycle. | Later, if the RFP Builder becomes a product focus. |
| D. One autonomous run drafts the whole RFP | Input: client and plan year → all seven stages with the agent's own proposals → a draft package. | The "save only after confirmation" rule is reversed, so evals are needed. | Medium, plus a behaviour change consultants did not ask for. | Not recommended. |

**Recommendation: A**, built in 1.24.7.
- A run whose RFP the agent created or opened stores `rfpId` (from `turn-rfp`, as today on the session).
- Its result page offers **Continue**. Continue clears `message` and sets the hidden `rfpId` and `context.fromRunId` to this run.
- The run host gets `rfpId`, so the RFP context block names the RFP and its stage.
- If the user picks the answer, Q3 decides between A and B.

## 5. Contract (Phase A)

### 5.1 How a run of an agent workflow executes

**Phase A reuses today's turn path on an in-memory run host.** This is the cheapest correct choice, and it makes agent parity provable.

1. `POST /workflows/:id/runs/stream` validates the input (4.1) and the `runRequirement`. It creates the run document (`status: 'running'`) and an in-memory **run host**. The host is a `SessionDoc`-shaped object held in the sessions service's in-memory map, as previews are (data-model 3.12):
   - `id: 'run-<run id>'`, `run: true`, never listed;
   - `name`: the workflow's name;
   - `datasets`: from the input, the agent's Live datasets, or the readiness dataset;
   - `agentKey` or `agentId` and `workflowId`: as `POST /sessions` would set them;
   - `rfpId`: from the input;
   - `messages`: 5.4.

   Its workspace is `workspaces/session-run-<run id>/`, created like a session's.
2. The host's turn runs through `streamTurn` unchanged. That covers the workflow run (`runTurnWorkflow`), the agent step, synthesis, the grounding guard, careful mode (from `careful`) and persistence into the host.
   - **One addition:** a step-event listener forwards every `workflow-step-start` and `workflow-step-result` as a run `step` event, whatever the workflow's `bar`.
   - The turn's events are forwarded to the run stream unchanged.
3. When the turn ends:
   - The host is projected into the run document: `answer` (the last assistant message), `panelItems`, `visualizations`, the derived `workflow` view, `rfpId`, the step results and `status`.
   - The memory thread `run-<run id>` is deleted.
   - The host leaves memory. The workspace stays, owned by the run.
4. **Stop** is a client abort, as for a chat: the agent turn aborts, which also cancels a readiness assessment. The run is stored `stopped`, with any partial answer the host persisted (agent-answers R16). A dropped connection is a stop.
5. **At start-up:**
   - a run document still `running` becomes `failed` with `error` `The app stopped before the run finished`;
   - a `session-run-*` workspace with no run document is deleted;
   - a leftover `run-*` memory thread is deleted.

The run endpoint never streams for code-only workflows. 118 stays their synchronous route and stores the run too. The UI uses the streamed route (R1) for every workflow, so it has one code path.

### 5.2 Routes

The numbers here are placeholders. Take the next free numbers from api.md when writing, in a new section **2.6.3 Workflow runs** (controller prefix `/workflow-runs`, capability workflows).

| Id | Route | Story | Shape |
|---|---|---|---|
| R1 | `POST /workflows/:id/runs/stream` | 1.24.2 | Body `{ input: Record<string, string \| number \| boolean \| string[]>, context?: { fromRunId: string } }`. SSE with the framing of api.md 3.1. Events in order: `run { runId, workflowId }`; then, interleaved, `step { id, title, status: 'running' \| 'success' \| 'failed' \| 'skipped' \| 'stopped', output?, error? }` and the agent events of 3.1 with unchanged payloads (`reasoning`, `text`, `tool`, `tool-result`, `tool-progress`, `visual-updated`, `panel-item`, `workflow`, `rfp-package`, `readiness-report`); then one terminal event: `done { run: WorkflowRun }` or `error { content }`. Refusals before the stream starts: the 4.1 texts, the `runRequirement`, 404 `Workflow "<id>" not found`, `Workflow "<id>" can't run on an input` (no input fields), and `Run "<id>" not found` for a bad `fromRunId`. |
| R2 | `GET /workflow-runs` | 1.24.4 | `{ runs: WorkflowRunSummary[] }`, newest first. Query `workflowId?`. No paging (as `GET /sessions`); the page pages in the client. |
| R3 | `GET /workflow-runs/:id` | 1.24.4 | `WorkflowRun`, or 404 `Run "<id>" not found` (Style B). |
| R4 | `DELETE /workflow-runs/:id` | 1.24.4 | `{ ok: true, message: "Run deleted" }`. Removes the document and the workspace. A running run is refused: `Stop the run before deleting it`. |
| R5 | `GET /workflow-runs/:id/visualizations/:vid` | 1.24.4 | As api.md 9, over the run's workspace and `visualizations`. |
| R6 | `GET /workflow-runs/:id/visualizations/:vid/download` | 1.24.4 | As 14. |
| R7 | `GET /workflow-runs/:id/panel-items/:itemId/file` | 1.24.4 | As 106. |
| R8 | `GET /workflow-runs/:id/panel-items/:itemId/download` | 1.24.4 | As 107. |
| R9 | `GET /workflow-runs/:id/rfp-packages/:rfpId/download` | 1.24.4 | As 105, with `draft` and `file`. |
| R10 | `POST /workflow-runs/:id/feedback` | 1.24.9 | Body `{ rating: 'up' \| 'down' }`. As 7, on the run's `answer`. It saves or deletes the verified query keyed by `sourceRunId`. |
| R11 | `GET /health` | 1.24.12 | `200 { ok: true }`, cheap, with no store read. It is the desktop readiness probe. |
| R12 | `POST /agents/:id/draft-runs/stream` | 1.25.2 | Like R1, for the draft of a user agent (Try it). The run is not stored. |

R5–R9 are implemented over the services that serve 9, 14 and 105–107, given a run-backed host. They are not copies.

**Catalogue changes (116/117):**
- In 1.24.2, `input` is filled for the four agent workflows and the user agents' workflows (4.2), and `runRequirement` is added.
- Until 1.24.12, those workflows keep `trigger: 'chat'` and still start chats, so the app stays usable while the run UI is built. The run routes accept any workflow that has input fields.
- 1.24.12 sets `trigger: 'run'` on every workflow and removes `picksDatasets` and `chatRequirement`. Phase C removes `trigger`, which is then always `run`.

### 5.3 Persisted shape: `workflow_runs` (1.24.4)

| Field | Type | Req | Meaning |
|---|---|---|---|
| `id` | uuid | yes | The run id. The host id is `run-<id>` and the workspace `session-run-<id>`. |
| `workflowId`, `workflowName` | string | yes | The workflow, and its name when the run started (a deleted user agent's run still names it). |
| `input` | object | yes | The validated input as sent. |
| `context` | `{ fromRunId: string }` | no | The earlier run whose question and answer were given as context (5.4). |
| `status` | `running` \| `success` \| `failed` \| `stopped` | yes | |
| `steps` | `{ id, title, status, output?, error? }[]` | yes | In workflow order. `output` is the step's output (capped at 20 KB of JSON each). |
| `output` | object | no | The workflow's final output. |
| `error` | string | no | When `failed`. |
| `answer` | `ChatMessage` (3.4.1) | no | Agent workflows: the persisted answer, with the same shape and fields as a session's assistant message, so one renderer serves runs and past chats. |
| `question` | string | no | Agent workflows: the user message the agent received (the run's title source). |
| `datasets` | string[] | yes | The datasets the run worked over (`[]` for a code-only run). |
| `agentKey` / `agentId`, `agentName` | string | no | The agent its agent step ran, as on a session. |
| `rfpId` | uuid | no | RFP Builder runs. |
| `panelItems`, `visualizations`, `workflowState` | as 3.4, 3.4.3, 3.4.4 | no | Copied from the host. |
| `ownerId` | `local` | no | Legacy and inert (3.14). |
| `startedAt`, `finishedAt?`, `createdAt`, `updatedAt` | ISO | | Store-maintained except `startedAt` and `finishedAt`. |

The wire `WorkflowRun` is the document plus the derived `panelItems` and `workflow` view (as api.md 2.1 derives them for a session), and `agent` (as 2.1).

`WorkflowRunSummary = { id, workflowId, workflowName, status, title, startedAt, finishedAt? }`. `title` is the first 120 characters of `question`, else of the first `text` or `textarea` input, else the workflow name.

This is an additive collection, so there is no migration. 1.23.9's "nothing stored" is superseded: `seq-text-demo` runs are stored too, so the history is uniform.

### 5.4 Context from one earlier run (follow-up, clarification answer, RFP Continue)

- A run started with `context.fromRunId` puts three messages on the host before its turn: `user` (the earlier run's `question`), `assistant` (the earlier run's `answer.content`, which is the clarifying question when the earlier run ended on one), and `user` (this run's question or message).
- The host has no memory thread yet, so today's input rule (agents.md 4.3: no thread, so send the whole transcript) sends all three. **No new agent-input code is needed.**
- This covers three cases with one mechanism:
  - **Follow up** on a result;
  - **Answering a clarification**, which sends the option label, `Something else` text, or `Skip — proceed with your best judgment.` as the question (agent-answers R43, R44);
  - the **RFP Continue**, which also sets `rfpId`.
- It goes one level only: the earlier run's own context is not carried. A chain of follow-ups therefore sees only the run just before. *(Q4 asks whether follow-ups should exist at all. If not, only clarification answers and the RFP Continue use the mechanism.)*
- The run host's turn otherwise behaves as a session's first turn. That includes R11's retry dedupe, which has nothing to dedupe.

### 5.5 Frontend (owned as marked)

- `features/sessions/components/answer-view/` (1.24.3): extracted from `session-chat` with no behaviour change. It renders one answer message: Markdown, the R32–R36 blocks, the badges, the rating (behind an input flag), the cross-check chip, the clarification card (with an output for the picked option), and the visual, readiness and RFP package cards. `session-chat` uses it, and so do the run page and the past-chat view.
- `features/workflows/services/workflow-runs-api.service.ts` (1.24.4/1.24.5): `streamRun(id, input, context?)`, which reuses the chat stream reader; `getRuns()`, `getRun(id)`, `deleteRun(id)`, and the file URLs.
- The run page (1.24.5) extends 1.23.9's workflow page. It has:
  - the input form, with controls per field type (the `datasets` control reuses the composer's dataset cards; `dataset` is a listbox filtered by kind; `boolean` is a checkbox);
  - the example chips;
  - **Run** / **Stop**;
  - the live step list, with the Thinking block and the agent-phases bar inside the agent step;
  - the result: status line, `answer-view`, and the step outputs collapsed under each step;
  - the right panel bound to the run;
  - **Run again** (same input) and **Follow up** (Q4).
- A stored run opens at `run-detail` (a new `MainView`) with the same page in read-only mode: the input shown filled and disabled, with **Run again with this input**.

### 5.6 Test ids and copy (Phase A)

| Where | Element | Test id | Copy |
|---|---|---|---|
| Run page | form | `workflow-input-<name>` (1.23.9) | Labels and placeholders from 4.2 |
| | dataset picker | `workflow-input-datasets` | Caption `Datasets`; cards as the composer's |
| | example chip | `workflow-example-<n>` | The starter text |
| | Run / Stop | `workflow-run` / `workflow-run-stop` | `Run` / `Running…` (1.23.9); `Stop` |
| | run requirement | `workflow-run-requirement` | The `runRequirement` text, 12 px `fg-muted` |
| | step row | `workflow-run-step-<id>` (1.23.9) | Chips `Running`, `Done`, `Failed`, `Skipped`, `Stopped` |
| | answer | `run-answer` (wraps `answer-view`) | — |
| | actions | `workflow-run-again`, `workflow-run-follow-up`, `workflow-run-continue` (RFP) | `Run again`, `Follow up`, `Continue` |
| | follow-up field | `workflow-follow-up-input` | Placeholder `Ask a follow-up about this result` |
| Runs page | rail | (title/aria) | `Runs`, lucide `history` icon, where Sessions was |
| | tabs | `runs-tab-runs`, `runs-tab-past-chats` | `Runs`, `Past chats` (the second only when old sessions exist) |
| | row | `run-row-<id>`, chip `run-row-workflow-<id>`, status `run-row-status-<id>` | Title, workflow name, status, relative time |
| | empty | — | `No runs yet. Open a workflow and run it.` with **Open Workflows** |
| | search | `runs-search` | `Search runs by title, workflow or ID…` |
| Run detail | header | `run-detail-title`, `run-detail-id` | Title, `Run <first 8>` with copy (toast `Run ID copied`) |
| | delete | `run-delete` | `Delete run`; confirm `Delete this run?` / `This permanently removes its result and files.` |
| Past chat | banner | `past-chat-banner` | `Chats are retired. This conversation is read-only. To ask something new, run a workflow.` with **Open Workflows** |

## 6. ADR draft

**Number.** Take it from `main` at the moment of writing ([lessons.md](../../lessons.md)): `git show origin/main:specs/system/architecture.md | grep '#### ADR-'`.
- On 2026-11-11, `origin/main` ends at ADR-0039 and this branch adds ADR-0040.
- M1-24 starts after M1-23 merges, so this is **ADR-0041**.
- Re-check when 1.24.1 starts, and renumber (then grep every reference) if `main` has moved.

**Placement.** Level 3 — Components, after ADR-0040.

**Status lines to amend.** Each gains a pointer, and its substance is never edited:
- ADR-0040 "partly superseded by ADR-0041 (sessions no longer bind to workflows; workflows run on an input)";
- ADR-0028, ADR-0029, ADR-0034 and ADR-0005: "amended by ADR-0041";
- ADR-0008: "amended by ADR-0041 (user agents run as one-step run workflows; the preview becomes a draft run in Phase B)";
- ADR-0004: "amended by ADR-0041 (one workspace per run; runs keep no lasting memory)";
- ADR-0038: "amended by ADR-0041 (a run's agent call is grouped by the run host id)".

ADR-0031, ADR-0033 and ADR-0035 are unchanged; the consequences name them.

```markdown
#### ADR-0041 — Chats retired: every workflow runs once on a typed input; runs are stored; existing sessions become read-only past chats
- **Status:** Proposed (Accepted when the user confirms the M1-24 epic spec)
- **Date:** 2026-11-11
- **Context:**
  - ADR-0040 bound every session to a workflow and started chats from workflows. Its amendment (1.23.9) added run workflows: a workflow with typed input fields defined in code runs once and shows each step's result.
  - On 2026-11-11 the user decided that workflows trigger runs, not chats, that all workflows become run workflows (the Assistant, Questions to Insights v2, the RFP Builder, the Data Readiness Agent and every user agent's one-step workflow), and that chats are retired.
  - Users' machines hold sessions with transcripts, memory threads, visuals, reports, RFP packages, readiness reports and verified queries sourced from answers.
  - The turn path (agents.md 5.1) holds every reliability feature: grounding guard, SQL repair, result guards, careful mode, tool-only synthesis, clarification interception, visuals, panel items and the RFP stage drive. It operates on a session document.
- **Decision:**
  - **No chat can start.** The app has no composer, no New conversation screen and no Start chat. A workflow is used by running it on its input.
  - **Every workflow runs on a typed input defined in code**, with field types text, textarea, number, boolean, datasets and dataset. A run streams its step events and its agent's events, and ends with a stored result.
  - **Runs are stored** in a `workflow_runs` collection, with their files in a run workspace. The Runs area lists them; a run is deleted only by the user.
  - **A run of an agent workflow is one agent turn.** In this version it executes on an in-memory run host with the session shape, through the unchanged turn path, and is then projected into the run document. So every turn feature applies to a run exactly as it applied to a chat turn, and no agent's input changes. Runs keep no memory thread after they end.
  - **Context from one earlier run** (a follow-up, an answer to a clarifying question, the RFP Builder's Continue) is given as that run's question and answer before the new message, through the existing transcript bootstrap. Nothing else carries over between runs.
  - **The RFP Builder runs one exchange per run.** The RFP record in the Intellify RFP API carries the state between runs; the run stores the RFP id it worked on.
  - **Existing sessions are kept, read-only.** No migration, no deletion, no new writes. Past chats open read-only with their visuals and downloads. The user may delete one, which removes its transcript, memory thread and workspace as before.
- **Rejected:**
  - **Keeping one chat workflow** (e.g. the Assistant as a chat): contradicts the user's decision.
  - **Unstored runs for agent workflows** (as 1.23.9's test workflow): an answer, its visuals and its RFP package would be lost when the page is left, which is worse than the chats they replace.
  - **Migrating sessions into runs:** a multi-turn transcript is not one run, and a migration risks data for no gain.
  - **Deleting existing sessions:** silent data loss.
  - **A new turn engine for runs from day one:** it would duplicate every reliability feature and make parity unprovable. It is extracted later, behind the same tests (Phase C).
  - **Runs with lasting memory** (a thread per workflow, or chained runs): that is a chat by another name.
- **Consequences:**
  - **Partly supersedes ADR-0040:** "a session is bound to a workflow" and "a chat starts from a workflow" no longer describe new work. The catalogue, the ids, `agent-turn`, code-defined workflows and the derivation rule (kept for past chats) stand.
  - **Amends ADR-0028:** the RFP Builder's runs replace its sessions, `rfpId` lives on the run, and packages are stored in the run workspace.
  - **Amends ADR-0029:** panel items and workflow state belong to the run. The workflow bar's place is taken by the run's step list, and a one-step workflow's agent phases show inside its agent step. The tools are unchanged.
  - **Amends ADR-0034:** v2's step events drive the run's step list.
  - **Amends ADR-0005:** visuals belong to the run that made them. Tailoring in a chat is gone; tailoring a run's visual returns in Phase B.
  - **Amends ADR-0008:** a user agent runs as its one-step run workflow. The preview becomes a run of the draft (Phase B).
  - **Amends ADR-0004:** one workspace per run; memory is used only within a run.
  - **Amends ADR-0038:** a run's agent call is grouped under its run host id, and Monitoring names it from the run.
  - Unchanged: ADR-0031 (readiness reports gain `runId`), ADR-0033 (`tool-progress` is forwarded in the run stream; Stop cancels the assessment), ADR-0035.
  - Deep analysis becomes a code-defined run workflow (Phase B); it is unavailable until then.
  - The desktop readiness probe moves from `GET /sessions` to `GET /health`.
  - Evals keep calling agents directly with a throwaway host.
  - **Stack-neutral:** a rebuild needs typed inputs per workflow, a streamed run that reports step starts and ends and the agent's events, a stored run with its files, and a read-only view of the conversations stored before.
```

## 7. Phases

Each phase ends with an app the user can use every day.

### Phase A — every workflow runs; runs are kept; no chat can start (epic M1-24)

**What the user gets:**
- runs for all workflows, with streamed progress and full answers;
- a run history;
- past chats, read-only;
- thumbs and verified queries on run answers;
- runs in Monitoring.

**What stays internal:** the backend chat code. Evals, the agent editor preview and E2E seeding still use `POST /sessions` and the chat stream.

**Order inside Phase A:** chat stays reachable until its last story, 1.24.12. Every intermediate build has both chats and runs, so the app never loses a feature mid-phase.

**Known gaps, written in the M1-24 epic spec and the changelog:**
- deep analysis;
- generating, tailoring, reverting, refreshing or repairing a visual of a result;
- the preview is still a chat.

### Phase B — the last chat surfaces replaced (epic M1-25, first part)

- **Try it** replaces the preview chat and the Chat Box tab.
- Deep analysis becomes a run workflow.
- Visual actions work on runs.

After B, nothing in the UI is a chat apart from past chats.

### Phase C — remove the chat code and specs (epic M1-25, second part)

- The turn engine is extracted from `SessionsService` (3,245 lines) into a host-based service. Runs, draft runs and evals use it; evals get a throwaway run host.
- The chat write routes, the preview sessions, the composer and the chat components are removed.
- `sessions-chat` is split into `agent-answers` (the turn's rules R17–R44, stated for a run's agent step) and `past-chats` (read-only).
- The dev harness scripts move to the run stream.

What stays for good: the past-chat read routes and view.

**Why this cut:** Phase A carries all the user-visible value and the data decisions. Phase B removes the last inconsistency (a chat in the editor) and restores the two features Phase A drops. Phase C is risk-only refactoring, done once nothing depends on the chat path.

## 8. Stories

### 8.1 Epic recommendation

**Recommendation: two new epics.**
- **Cut 1.23.10 from M1-23** (`🚫 Cut — moved to M1-24, plan docs/plans/m1-23-retire-chats.md`). Ship M1-23 (1.23.1–1.23.9) through the acceptance gate and its PR first.
- Open **M1-24 "Chats retired: every workflow runs on an input"** for Phase A.
- Open **M1-25 "The last chat surfaces replaced, and the chat code removed"** for Phases B and C.

Why:
- M1-23 already holds nine stories and one large PR. Its spec puts "evals" and "the legacy turn" out of scope, and these phases change both.
- One epic is one PR (CLAUDE.md). Holding all three phases in one epic would ship nothing until Phase C.
- Two epics ship Phase A's value as soon as it is accepted, and keep the refactor-only Phase C out of that PR.
- Each epic needs a confirmed spec in `specs/epics/<id>/spec.md` and a row in `specs/README.md`.

If the user prefers to keep everything in M1-23, renumber 1.24.1–1.24.12 as 1.23.10–1.23.21 and 1.25.x as 1.23.22 onwards. The order and content do not change.

### 8.2 Parallel groups

- 1.24.2 and 1.24.3, once 1.24.1 is confirmed.
- 1.24.4 after 1.24.2. Then 1.24.10, after 1.24.4, in parallel with 1.24.5.
- 1.24.5 after 1.24.3 and 1.24.4.
- 1.24.6, 1.24.7, 1.24.8, 1.24.9 and 1.24.11 after 1.24.5, in parallel. Ownership:
  - 1.24.11 owns `app.ts`/`app.html` navigation and the rail;
  - 1.24.6 and 1.24.7 own their workflow's run-page variants and result cards;
  - 1.24.9 owns the rating input of `answer-view`;
  - 1.24.8 touches only `frontend/e2e/`.
  - Merge 1.24.11 first and re-run the others' gates after.
- 1.24.12 last, after 1.24.6, 1.24.7, 1.24.8 and 1.24.11.
- M1-25: 1.25.2, 1.25.3 and 1.25.4 in parallel, then 1.25.5, then 1.25.6.

Each UI story records its demo in the fast loop. Each API-only story writes `evidence/<id>/demo.txt`.

### 8.3 Epic M1-24 (Phase A)

#### 1.24.1 — Chats retired: ADR-0041, epic spec, glossary and roadmap  `📋 Planned`
- **Intent:** the retirement of chats is decided, scoped and phased before any code.
- **Scope:**
  - ADR-0041 (section 6), and the Status pointers on ADR-0040, 0028, 0029, 0034, 0005, 0008, 0004 and 0038;
  - `specs/epics/M1-24/spec.md` (Goal, Scope, Out of scope, Known gaps, Stories, Specs touched, Acceptance, Risks) and its README row;
  - Milestone 1.24 and features 1.24.1–1.24.12;
  - 1.23.10 marked Cut in Milestone 1.23 and in M1-23's spec, and that spec's open question closed;
  - glossary: **Workflow run**, **Run input**, **Run host** (internal), **Past chat**; **Session**, **Turn**, **Chat**, **Workflow** amended.
- **Out of scope:** product code; capability, api, data-model, agents and ui specs (each story updates its own).
- **Acceptance:** ADR-0041 `Accepted` and the epic spec `Confirmed (<date>)` by the user; `origin/main` merged first and the ADR number re-checked; `check-specs` green.
- **Notes:** S-size docs story.

#### 1.24.2 — Streamed runs of agent workflows on the backend  `📋 Planned`
- **Intent:** any workflow with input fields, including the four agent workflows and user agents' workflows, runs once through `POST /workflows/:id/runs/stream`, with the same answer a chat turn gives. No UI.
- **Scope:**
  - the input field types and validation of 4.1;
  - the inputs and `runRequirement` of 4.2 in the catalogue (`trigger` stays `chat` for now, 5.2);
  - R1, with the run host of 5.1 and the context mechanism of 5.4;
  - the step-event listener;
  - runs held in memory for this story only (1.24.4 stores them);
  - 118 accepts any workflow with input fields.
  - Specs: workflows capability (run rules for agent workflows, R11 onwards), api.md (R1, 116/117 fields), agents.md 5.12 and a new 5.13 *Runs of agent workflows*.
- **Out of scope:** storage and run routes (1.24.4); UI; RFP Continue UI (1.24.7); feedback (1.24.9).
- **Acceptance:**
  - Unit tests:
    - each new field type's validation and its exact messages;
    - a run of `agent:assistant` with a stubbed model sends **the same model request** as a chat turn with the same question and datasets (system blocks, tools, options), and produces the same answer message;
    - a run with `context.fromRunId` sends the three messages of 5.4;
    - a stopped run aborts the agent stream;
    - `careful: true` runs the cross-check;
    - a v2 run emits four `step` events with their statuses;
    - a Data Readiness run forwards `tool-progress`;
    - an RFP run with `rfpId` gets the RFP context block for that RFP;
    - the memory thread `run-<id>` is deleted after the run.
  - The `getInstructions()` and tool-list hashes of `assistant`, `assistant-v2`, `rfp` and `data-readiness` are equal on base and branch (evidence).
  - Backend e2e `backend/test/workflow-runs.e2e-spec.ts` with the stub model: a streamed Assistant run ends with `done` carrying the answer; validation refusals; `runRequirement` refusal for `agent:rfp` without the sample; a code-only workflow still runs through 118.
  - Existing session unit suites and backend e2e unchanged and green.
- **Notes:** highest-risk story. Measure first: dump one real request of a chat turn and of a run and diff them ([lessons.md](../../lessons.md) "Trace before theorising"). Demo `evidence/1.24.2/demo.txt` (SSE transcript).

#### 1.24.3 — The answer view, extracted from the chat  `📋 Planned`
- **Intent:** one component renders an answer and its provenance, so runs and past chats show answers exactly as chats did.
- **Scope:** `answer-view` (5.5) extracted from `session-chat` with no behaviour or copy change; `session-chat` uses it; its unit tests move with it.
- **Out of scope:** any visible change.
- **Acceptance:** the chat-rendering Playwright specs (`chat-and-visuals`, `chat-clarification`, `agent-panel`, `rfp-builder`, `data-readiness`) pass unchanged, and so does the layout-accessibility baseline; `session-chat.spec.ts` and the new `answer-view.spec.ts` are green; builds green.
- **Notes:** refactor, S/M. Parallel with 1.24.2. Demo `demo.txt` (no visible change).

#### 1.24.4 — Stored runs, the run history API and run files  `📋 Planned`
- **Intent:** a run's result outlives the page: it is stored, listed, reopened and deleted, and its files download.
- **Scope:**
  - the `workflow_runs` collection (5.3) and the projection at the end of a run;
  - the start-up recovery of 5.1 step 5;
  - R2–R9;
  - 118 stores runs and answers `runId`.
  - Specs: data-model (new 3.16 `workflow_runs`, 1.2, 3.13, 4.1 run workspaces), api.md 2.6.3, workflows capability (stored runs, deletion).
- **Out of scope:** UI (1.24.5, 1.24.11); feedback (1.24.9).
- **Acceptance:**
  - Unit tests: the projection (answer, panel items, visuals, workflow view, rfpId, steps); a `running` run left at start-up becomes `failed`; an orphan `session-run-*` workspace is deleted; deleting a running run is refused.
  - Backend e2e: run, then list, then get, then download a visual and a panel file, then delete (workspace gone).
  - Existing suites green.
- **Notes:** API-only, `demo.txt`.

#### 1.24.5 — Run the Assistant, Questions to Insights v2 and user agents from their page  `📋 Planned`
- **Intent:** the user asks a data question by running a workflow: they fill in the question and datasets, watch the steps, and read the answer with all its provenance, visuals and panel items. They can stop, run again, follow up and answer a clarifying question.
- **Scope:**
  - The run page of 5.5 for agent workflows: field controls, example chips, the live step list with the Thinking block and the agent-phases bar, Stop, the result through `answer-view`, the right panel bound to the run (visuals viewable and downloadable through R5/R6, panel items through R7/R8), Run again, Follow up, clarification options starting a context run.
  - A stored run reopens read-only at `run-detail`. Chats still work.
  - Specs: workflows capability rules and the Feature `Workflow runs`; sessions-chat intro (R12–R44 also apply to a run's agent step, with the differences listed); agent-panel (the panel and phases on a run); visuals (a run's visual, read-only actions); ui.md 4.4b, a new 4.4c *Run page*.
- **Out of scope:** Data Readiness and RFP specifics (1.24.6, 1.24.7); rating (1.24.9); the Runs list (1.24.11); removing chats (1.24.12).
- **Acceptance:**
  - `frontend/e2e/workflow-runs.spec.ts`, Feature `Workflow runs`:
    - `@demo @story-1.24.5` *I run the Assistant on a question*: open Workflows → Assistant; pick `World Cup Core`; type `Which team scored the most goals?`; Run; see the Answer step running with the Thinking block and a `run_readonly_sql` row; see the answer with `How I worked this out`, the interpretation line and `Data used`; open the visual the agent made in the panel; Follow up `And the fewest?` and see a second answer.
    - *A clarifying question becomes options*: a stubbed `ask_clarification` shows the card; picking option 2 starts a run, whose recorded request carries the clarifying question and the answer.
    - *Stop keeps the partial answer*.
    - *Careful mode cross-checks*: the `Cross-checked` chip.
    - *v2 shows its four steps*, each Done.
    - *A user agent's workflow runs over its own datasets*: the datasets are read-only chips, and its instructions block reaches the model.
    - *Required fields*: Run with no dataset shows `Select at least one dataset`.
  - Axe scan of the run page in both themes, with the panel open.
  - Unit tests for the form per field type and for the stream-to-state mapping.
- **Notes:** UI story, M/L. Uses the stub model's request recording.

#### 1.24.6 — Run the Data Readiness Agent on a dataset  `📋 Planned`
- **Intent:** the user picks a PostgreSQL or Databricks dataset and runs Data Readiness. They watch the assessment's progress, get the scorecard in the panel, and can ask drill-down or synthetic-data questions as further runs.
- **Scope:**
  - the `dataset` control filtered by kind;
  - progress on the running tool row;
  - the readiness card and scorecard (Past assessments) in the run panel;
  - synthetic SQL file items downloadable (R7/R8);
  - `readiness_reports.runId` (the bridge writes it for a run host);
  - Stop cancels the assessment.
  - Specs: data-readiness R2 (rewritten: a run, not a chat), R5, R24 (`runId`), the Feature; synthetic-data R40–R44 wording; data-model 3.15.
- **Out of scope:** a code-defined assessment workflow (a possible later improvement); score rules.
- **Acceptance:**
  - `data-readiness.spec.ts` moved to runs. Its `@demo @story-1.24.6` scenario: run on the seeded Postgres dataset; see `Profiling … (n/m)…`; the scorecard opens; Follow up `Show the rows behind the worst finding` and see a table.
  - `synthetic-data.spec.ts` chat scenarios moved to runs.
  - Unit test: a report from a run stores `runId` and no `sessionId`.
  - Axe in both themes.
- **Notes:** UI story.

#### 1.24.7 — Run the RFP Builder one exchange at a time  `📋 Planned`
- **Intent:** the consultant builds an RFP over several runs. Each run is one exchange, **Continue** carries the RFP and the last proposal, and the package downloads from the result.
- **Scope:**
  - option A of 4.3 (or B, per Q3): the `message` field, the hidden `rfpId`, **Continue** (5.4);
  - the stage phases inside the agent step;
  - the package card with run-scoped downloads (R9);
  - the RFP document in the panel.
  - Specs: rfp R1, R2, R7, R9, R15, R16 and its Feature; ADR-0028's pointer (in 1.24.1).
- **Out of scope:** any prompt, skill or tool change; option C.
- **Acceptance:**
  - `rfp-builder.spec.ts` moved to runs. Its `@demo @story-1.24.7` scenario: run `Start an RFP for <seed client>, plan year 2027`; see the stage-1 proposal; Continue with `yes`; the recorded request carries the earlier proposal, and the record's stage becomes 1; continue to a draft export and download `rfp-<title>-draft.zip`.
  - With the sample missing, Run is disabled with the requirement text.
  - The `rfp` eval set need not run (hashes equal); this is recorded in the evidence.
- **Notes:** UI story. RFP eval runs must not run in parallel ([lessons.md](../../lessons.md)).

#### 1.24.8 — Move the request-recording E2E specs from chats to runs  `📋 Planned`
- **Intent:** the specs that check what reaches the model keep their coverage once chats are gone.
- **Scope:** `llm-settings`, `llm-copilot`, `llm-custom-endpoint`, `assistant-skills`, `skill-library`, `designer-skills`, `builtin-agent-prompts`, `chat-and-visuals`, `chat-clarification`, `world-cup-workflow`, `agent-sessions`, `agent-panel` and `visual-tailoring`:
  - each scenario that sends a chat message sends a run instead, with the same assertions on the recorded request;
  - scenarios of retired behaviour (tailor in chat, history strip, welcome block) are deleted with their Gherkin;
  - visual-tailoring's panel scenarios are kept against past chats' read-only panel, or deleted and re-added by 1.25.4.
- **Out of scope:** product code (report a product bug instead of fixing it here).
- **Acceptance:** every listed spec green against runs; a grep of `frontend/e2e` for the chat composer's selectors (`Ask a follow-up question…`, `new-session-*`, `Send message`) finds only `agent-editor` and the past-chat scenarios; each spec's flake rate checked (run alone 5 times) before blaming a change.
- **Notes:** test-only story, S/M. It can be split per spec family among subagents.

#### 1.24.9 — Rate a run's answer: verified queries from runs  `📋 Planned`
- **Intent:** a thumbs-up on a run's answer saves a verified query, as it did on a chat answer, so the library keeps growing.
- **Scope:** R10; `verified_queries.sourceRunId` (optional) with `sourceSessionId` optional; dedupe on `sourceRunId`; rating enabled in `answer-view` for runs. Specs: verified-queries R1–R7, data-model 3.6, 3.13, api.md R10, agent-answers R35/R36 wording.
- **Out of scope:** a verified-query screen; rating past chats.
- **Acceptance:** unit tests for save, re-rate (one pair), thumbs-down (removed), and a pair from a run found by retrieval (R8) and by metrics candidates. The `@demo @story-1.24.9` scenario: thumbs-up on a run answer shows the toast `Answer saved as a verified query` and the `Verified` badge; a second run with the same question shows `Verified`.
- **Notes:** small UI story.

#### 1.24.10 — Monitoring shows runs  `📋 Planned`
- **Intent:** every run appears in Monitoring, named after its workflow and title, beside the past chats.
- **Scope:**
  - the Sessions tab becomes **Runs**: rows for runs, named from `workflow_runs`, and past chats marked `Past chat`;
  - the LLM calls column and filter `Run or chat`;
  - the session page works for a run.
  - Capture one real run trace first and confirm that its `threadId` is the host id (5.1). If it is not, decide the grouping key from the trace before any code.
  - Specs: monitoring R3, R6, R26–R36; ui.md 4.8d, 4.8f, 4.8g; data-model 1.2 (`threadId`).
- **Out of scope:** new metrics; deleting traces with a run.
- **Acceptance:** `monitoring.spec.ts` updated. Its `@demo @story-1.24.10` scenario: run the Assistant, open Monitoring → Runs, see `Assistant: <title>`, open it and see one turn with its path and waterfall.
- **Notes:** UI story. Parallel with 1.24.5.

#### 1.24.11 — Runs replace Sessions on the rail; past chats open read-only  `📋 Planned`
- **Intent:** the user finds every past run under **Runs**, and every old chat under **Past chats**, readable but not continuable.
- **Scope:**
  - the rail item `Runs` in Sessions' place;
  - the Runs page (search, rows, paging ten per page as R63, delete);
  - `run-detail`;
  - the Past chats tab (the old Sessions list, with the same columns), and the past-chat view: transcript through `answer-view`, the banner, the panel read-only (visual versions viewable, downloads working, no Tailor/Refresh/Generate), no composer, no rating, delete kept.
  - Specs: app-shell R3, R46, R49; past-chats R63 (Past chats) and a new R66 (read-only); ui.md 1.3, 1.4, 4.7.1, 4.12; agent-panel (read-only on past chats).
- **Out of scope:** removing Start chat and the composer (1.24.12); an export of past chats.
- **Acceptance:**
  - `session-management.spec.ts` becomes `runs.spec.ts`. Its `@demo @story-1.24.11` scenario: open Runs and see a run made earlier; open it and see its input and answer; Run again with this input; open Past chats, open a seeded old session (seeded through `POST /sessions`), see the banner and its transcript, see no composer, open its visual in the panel and download it.
  - A negative test: no control on a past chat sends a message, rates, tailors or refreshes.
  - Axe in both themes.
- **Notes:** UI story.

#### 1.24.12 — Chats can no longer start  `📋 Planned`
- **Intent:** chats are retired: nothing in the app starts or continues one.
- **Scope:**
  - Remove Start chat (cards, pages), the New conversation screen and its route in the UI, the Workflow picker, `startChatWithWorkflow` and the composer.
  - `trigger: 'run'` on every workflow; drop `picksDatasets` and `chatRequirement`.
  - `POST /sessions { workflowId }` refused (`Workflow "<id>" runs on an input`).
  - The home page copy (U14).
  - `GET /health` (R11) and the Electron probe moved to it.
  - The Workflows page note becomes `Each workflow runs on an input. Its steps call agents, and agents use skills and tools.`
  - Specs: workflows R5–R10 (Run replaces Start chat), past-chats R1, R52, R64 (retired, kept as `Retired (1.24.12)`), app-shell R51, api.md 3, 4.3, 116, ui.md 4.1, 4.4a, 4.7 (removed).
- **Out of scope:** the backend chat code (Phase C); the agent editor preview (1.25.2).
- **Acceptance:**
  - `workflows.spec.ts` and `navigation.spec.ts` updated. The `@demo @story-1.24.12` scenario: home shows `Run a workflow`; Workflows lists every workflow with **Run** and none with Start chat; Runs has no Start New Conversation.
  - A negative test: no `Start chat`, `New conversation` or `Send message` control exists outside the agent editor.
  - The desktop smoke (`npm run test:e2e:desktop` or its equivalent) reaches ready through `/health`.
  - Builds, unit tests, lint, check-specs and every impacted spec green.
- **Notes:** last story of M1-24. After it, the epic's stories go through the acceptance gate, then the changelog entry and the PR.

### 8.4 Epic M1-25 (Phases B and C)

#### 1.25.1 — Epic spec M1-25  `📋 Planned`
- **Intent, Scope:** the epic spec, its README row, and Milestone 1.25 with its features. ADR-0041 already covers the decisions. **Acceptance:** confirmed by the user; check-specs green. S.

#### 1.25.2 — Try it: run an agent's draft instead of a preview chat  `📋 Planned`
- **Intent:** the agent editor and a user agent's page test the draft by running it once, the same way a workflow runs.
- **Scope:**
  - R12 (draft runs, not stored, host and workspace discarded at the end);
  - the **Try it** panel in the editor's Details panel and as the user agent's first tab (replacing Chat Box), with question, Run, Stop, the result, and Reset;
  - the preview session code becomes unused.
  - Specs: agents-evals R60, R61, R90, R91; ui.md 4.5.1, 4.5.8; api.md R12; ADR-0008's pointer.
- **Out of scope:** removing `POST /sessions { preview }` (1.25.6).
- **Acceptance:** `agent-editor.spec.ts` moved to Try it. Its `@demo @story-1.25.2` scenario: edit the draft's instructions, Try it, and the recorded request carries the draft's instructions block; the Live version is unchanged. Axe in both themes.

#### 1.25.3 — Deep analysis as a run workflow  `📋 Planned`
- **Intent:** a broad question gets a multi-angle report again, as a workflow with visible steps.
- **Scope:**
  - a code-defined workflow `deep-analysis` with steps Plan (agent, structured), Investigate (agent, one call per angle, inside the step), Write (agent, structured) and Assemble (code), with the same three assistant calls and report format (agents.md 2.7, data-model 4.5);
  - input `question` and `datasets`;
  - the report stored in the run workspace and downloadable, its executive summary as the answer.
  - Specs: deep-analysis rewritten for a run; agents.md 2.7 and a new 5.14; api.md (46/47 removal deferred to C).
- **Out of scope:** background runs that survive a page leave (a run still stops on disconnect).
- **Acceptance:** `@demo @story-1.25.3` scenario: run Deep analysis on World Cup Core and see four steps Done and the report card with Download; unit tests for the step order and the report assembly; the assistant's hashes unchanged.

#### 1.25.4 — Visual actions on a run's result  `📋 Planned`
- **Intent:** the user can again generate a visual from an answer, tailor it from the panel, revert, refresh and repair, on a run.
- **Scope:** run-scoped equivalents of 8, 10, 11, 12 and 13, over `VisualizationService` with a run host; the panel's Tailor form, version menu and Refresh enabled for runs; event cards stored on the run. Specs: visuals R2, R12–R24 for runs; api.md; ADR-0005's pointer.
- **Acceptance:** `visual-tailoring.spec.ts` against runs. Its `@demo @story-1.25.4` scenario: Generate interactive visuals on a run answer, tailor `Make the bars green` to v2, revert to v1, refresh.

#### 1.25.5 — Extract the turn engine; evals and dev scripts on run hosts  `📋 Planned`
- **Intent:** the turn path no longer lives in the sessions service, so the chat code can go.
- **Scope:**
  - a host-based turn service, used by runs, draft runs and the eval runner (a throwaway run host replaces the throwaway session, agents.md 8.3);
  - requestContext `session-id` and `session-workspace-id` renamed `host-id` and `host-workspace-id`, with tools updated (names only);
  - `run-eval.ts`, `check-answers.ts` and `custom-endpoint-smoke` on R1.
- **Out of scope:** any behaviour change.
- **Acceptance:**
  - the session unit suites split and green with the same assertions;
  - agent hashes unchanged, **or**, if a tool's context key rename changes a tool's description, the affected eval sets pass at 100% over 3 runs ([lessons.md](../../lessons.md));
  - one eval run per set on a copy of the data dir equals its base results.
- **Notes:** refactor, highest internal risk of M1-25. Demo `demo.txt`.

#### 1.25.6 — Remove the chat write paths and specs  `📋 Planned`
- **Intent:** the codebase and specs no longer describe a chat.
- **Scope:**
  - Remove api.md 3, 5, 6, 7, 8, 10–13, 46, 47; preview sessions; `session-chat` composer code; `startChat*`, `SessionsApiService` write methods; `trigger`.
  - `sessions-chat` split into `agent-answers` and `past-chats`.
  - The glossary, the ADR-0041 consequences checked.
  - Backend e2e on runs or a seeded data dir.
- **Out of scope:** past-chat read routes and view; the `sessions` collection.
- **Acceptance:** the grep for the removed routes and selectors finds nothing live; check-specs (no orphan routes or features), builds, unit tests, lint and all Playwright specs green; past chats still open and download.

## 9. Risks

1. **Feature loss between phases.** Deep analysis, visual actions and follow-ups beyond one level are missing until Phase B (or for good, in the last case).
   - Mitigation: the known gaps in the M1-24 spec and changelog; the past-chat banner says chats are retired; Phase B scheduled right after.
2. **Long runs over one HTTP request.** A readiness assessment can take about 5 minutes (ADR-0033), and deep analysis several.
   - Mitigation: runs stream, so there is no request timeout, and tool progress frames act as keepalive. A disconnect is a Stop, as in chat today. Background runs are out of scope.
3. **E2E churn.** 21 Playwright specs drive chats, most of them as the request-recording harness.
   - Mitigation: chat stays reachable until 1.24.12; each workflow story moves its own specs, and 1.24.8 moves the rest. Step 6 greps every removed selector and copy text ([lessons.md](../../lessons.md)). Never skip a spec.
4. **Session-only assumptions in the turn path** (3,245-line `SessionsService`): repository writes, `updatedAt` ordering, R11 dedupe, the memory bootstrap.
   - Mitigation: the in-memory host already exists for previews ("persist a patch: in memory for a preview"). 1.24.2's parity test diffs a run's model request against a chat turn's for the same input.
5. **Monitoring grouping.** If the agent call's `threadId` is not the host id in a run, Monitoring cannot group runs.
   - Mitigation: capture a real trace first (1.24.2, 1.24.10).
6. **Prompts mention chats.** Answers may say "ask me a follow-up".
   - Mitigation: accepted for now. A prompt change needs evals at 100% over 3 runs, so it is a separate story when the user asks.
7. **Data growth.** Every run stores a document and possibly a workspace with visual versions. There is no retention policy.
   - Mitigation: delete per run. Bulk delete and retention are later stories if needed.
8. **The desktop probe.** Removing or slowing `GET /sessions` would leave the desktop app "starting".
   - Mitigation: `/health` in 1.24.12, before Phase C touches any session route.
9. **Order with M1-23.** M1-24 builds on 1.23.9's run page and catalogue fields.
   - Mitigation: start M1-24 from `main` after M1-23's PR merges. Only 1.24.1 (docs) may be written earlier.
10. **RFP without memory.** A bare "yes" confirms nothing unless Continue carries the proposal.
    - Mitigation: Continue always carries the earlier run (5.4), and 1.24.7's E2E asserts the recorded request. Option B stays available.
11. **Verified-query shape.** `sourceSessionId` changes from required to optional.
    - Mitigation: additive, with no migration. Readers already treat the source as provenance only (3.13). Unit tests cover dedupe for both keys.

## 10. Open questions

Only those whose answer changes what gets built. Each has a recommended answer.

1. **Are runs of the agent workflows stored (a run history), or shown once and discarded like 1.23.9's test workflow?**
   - Recommended: **stored**, for every workflow.
   - Consequence: if discarded, 1.24.4's collection and R2–R4 go, the Runs rail item has nothing to list, and run files need a 60-minute in-memory expiry instead.
2. **What happens to existing sessions?**
   - Recommended: **kept on disk and opened read-only under Runs → Past chats** (transcript, visuals, downloads, delete). No migration, no export.
   - Consequence: if they are only hidden (data kept on disk, no UI), the past-chat view and its read routes go from 1.24.11, and the data stays unreachable from the app.
3. **How does the RFP Builder run?**
   - Recommended: **one run per exchange, keyed by the RFP id, with Continue carrying the last proposal** (option A of 4.3).
   - Consequence: B (paused) shrinks 1.24.7 to a disabled workflow and read-only history. C (staged runs with suspend and resume) adds a run lifecycle and an `rfp` eval round.
4. **Can a run carry the previous run as context: Follow up and clarification answers?**
   - Recommended: **yes, one level** (5.4), with no memory thread.
   - Consequence: if no, every run starts cold. Clarification options then fill the question field for the user to rewrite and re-run, and Follow up and RFP Continue lose their context, which forces RFP option B.
5. **Does the agent editor's preview become Try it, a run of the draft?**
   - Recommended: **yes, in Phase B** (1.25.2).
   - Consequence: if the preview should stay a chat, the preview session and the chat stream stay for good, Phase C keeps them, and "chats are retired" has one exception, in the editor.

## 11. Decisions of 2026-11-11 (after this plan was written)

The user decided:
- **Everything stays in epic M1-23, on the branch `feat/M1-23-workflow-first`** (one PR). No M1-24 or M1-25. The old 1.23.10 placeholder is replaced.
- **The five open questions take the recommended answers:** runs of agent workflows are stored; existing sessions stay on disk and open read-only as past chats; the RFP Builder runs one exchange per run with Continue; a run can carry one earlier run as context; the agent editor's preview becomes Try it in Phase B.
- **A new first story: the workflow page becomes a designer-style layout** (1.23.10 below), from a screenshot the user gave (a workflow designer with the workflow graph in a central canvas and the configuration in a right-hand panel with tabs).

### 11.1 Numbering in M1-23

Wherever this plan says a story id, read it with this map. Content and order do not change; 1.25.1 (an epic spec for M1-25) is dropped.

| Plan id | M1-23 id | | Plan id | M1-23 id |
|---|---|---|---|---|
| (new) workflow page layout | **1.23.10** | | 1.24.8 | 1.23.18 |
| 1.24.1 docs | 1.23.11 | | 1.24.9 | 1.23.19 |
| 1.24.2 | 1.23.12 | | 1.24.10 | 1.23.20 |
| 1.24.3 | 1.23.13 | | 1.24.11 | 1.23.21 |
| 1.24.4 | 1.23.14 | | 1.24.12 | 1.23.22 |
| 1.24.5 | 1.23.15 | | 1.25.2 | 1.23.23 |
| 1.24.6 | 1.23.16 | | 1.25.3 | 1.23.24 |
| 1.24.7 | 1.23.17 | | 1.25.4 | 1.23.25 |
| | | | 1.25.5 | 1.23.26 |
| | | | 1.25.6 | 1.23.27 |

### 11.2 Story 1.23.10 — the workflow page as a designer: graph canvas in the middle, configuration on the right

Frontend only. It reshapes the workflow page of 1.23.5/1.23.9; the run stories (1.23.15–1.23.17) then add their inputs to the Run tab instead of inventing a layout.

- **Header** (page top, full width): breadcrumb `Workflows / <name>` (the first part is a link back to the list, `workflow-breadcrumb`), the workflow name as `h1`, its id in monospace, and on the right the primary action: **Execute** (`workflow-execute`, rocket icon) for a run workflow, which opens the right panel on **Run**; **Start chat** for a chat workflow (until 1.23.22 removes it).
- **Canvas** (the main content area, `workflow-canvas`): a dotted-grid background (`surface-muted` dots on `surface`), the graph drawn top to bottom and centred:
  - a round **Start** node, then one node per step, then a round **End** node;
  - a step node is a rounded rectangle, about 280 × 64 px: the step title in 14 px `fg-strong`, the step id under it in 12 px monospace `fg-muted`, and a kind badge on the right: `CODE` (neutral) or `LLM` (info); the agent step also shows its agent name and `≤ <n> steps`;
  - vertical connectors with arrowheads; each connector carries the fields the step above passes on (11 px monospace, beside the line);
  - each step's other exits as a small red (fails) or grey (stops) note at the node's right edge;
  - **toolbar** at the canvas top-left (`workflow-canvas-toolbar`): zoom out, the zoom level (`75%`… `150%`, default 100%), zoom in, fit to screen; the canvas scrolls when the graph is larger than it, and dragging the background pans it;
  - clicking or pressing Enter/Space on a node selects it (`aria-pressed`, `border-selected` ring) and opens the right panel on **Step**; clicking the background clears the selection.
  - The layout (node positions, connector paths, canvas size) is a pure function of the workflow's steps, unit-tested; nodes are HTML buttons over an SVG layer of connectors, so they are keyboard- and screen-reader-accessible.
- **Right panel** — the app's existing Details panel (`complementary` "Details panel"), opened when the page opens, resizable and collapsible as today. On this page it holds a tab strip (`workflow-panel-tab-<id>`):
  - **Workflow** (default): Name, Id, Description, Trigger (`Runs on an input` / `Runs in a chat`), **Input parameters** (one row per input field: key, label, type, `required`), **Output** (the last step's output fields), **Agents** (the agents its steps call, each opening the agent page).
  - **Step**: the selected step's number and title, Id, Kind, Summary, Input, Output, Other exits, and for an agent step Agent, Tools and Max steps. With no selection: `Select a step in the graph to see its configuration.`
  - **Run** (run workflows only): the input form, **Execute** and the per-step result of 1.23.9 (same test ids: `workflow-input-<name>`, `workflow-run`, `workflow-run-result`, `workflow-run-step-<id>`, `workflow-run-output`), moved here from the page body. While a run is shown, each node on the canvas shows its step's run status (Done ✓ / Failed ✗ / Skipped) as a small chip.
  - **Code**: the workflow definition as the API returns it (`GET /workflows/:id`), read-only, pretty JSON in a `<pre>`, with a Copy button.
- **What goes away from the page body:** the horizontal 1.23.1 drawing, the details card and the Agents list (they move to the canvas and the panel). The agent detail's Graph tab keeps the 1.23.1 drawing unchanged.
- **Widths:** at 1440 px the content area is about 960 px with the panel closed and 554 px with it open; the canvas must stay usable at 554 px (fit to screen picks the zoom), and the panel's forms must not overflow at its minimum width.
- **Specs:** `specs/capabilities/workflows/spec.md` (the page rules and Feature scenarios), `specs/system/ui.md` 4.4b (the layout, tokens grepped from `frontend/src/styles/tokens.css`).
- **Acceptance:** unit tests for the layout function (positions, connectors, canvas size for 1, 3 and 4 steps) and the panel tabs; `frontend/e2e/workflows.spec.ts` updated: `@demo @story-1.23.10` *A workflow opens as a designer* — open Workflows → Questions to Insights v2: the canvas shows Start, the four steps in order with their badges, End; the right panel is open on Workflow with its input parameters and output; click `Analyse` → the panel's Step tab shows its tools and `Max steps 15`; open Code and see the JSON; open the Sequential test workflow, click Execute → the Run tab; type a text, Execute, see the result and `Done` chips on the three canvas nodes. The existing 1.23.5 and 1.23.9 scenarios are updated to the new places; the axe scan passes on the page in both themes, panel open; builds, unit tests and check-specs green.
