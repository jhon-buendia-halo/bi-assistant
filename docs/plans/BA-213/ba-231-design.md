# BA-231 design — `show_in_panel`: agents decide what the right panel shows

Roadmap 1.14.18, epic [BA-213](https://halo-powered.atlassian.net/browse/BA-213), story [BA-231](https://halo-powered.atlassian.net/browse/BA-231). Asked on 2026-10-14: "I want the agents to be able to determine what they wants to display in the right panel so create a built in tool for that".

User decisions: one built-in tool, always on for every agent (the assistant, the RFP Builder, every user agent); it can show a workspace file, a Markdown document, a query result table, an existing visual, and the agent's workflow phases; phases come from a `## Workflow` section in the prompt; everything shown is saved per session. Defaults taken for the planner's open questions: the RFP Builder's saved stage also drives the tracker; `table` references this turn's query results only; `.csv` files render as monospace text in v1.

Facts verified in the code: event types at `sessions.service.ts:157`; stream mapping ~1548–1710; `turn-data-records` is set only `if (isAssistant)` (:1569). `ALWAYS_ON_TOOLS`/`LIBRARY_TOOLS` are in `agent-links.ts` (frontend mirror `prompt-links.ts` `LINKABLE_TOOLS`, plus `official-links.ts`). `toolLines()` reads `inputSchema.shape`, so a Zod discriminated union would print `show_in_panel()` with no inputs, hence the flat schema. `safeRelativePath` + `sessionWorkspacePath` exist in `rfp-packages.service.ts`. The RFP agent has no Mastra workspace but its session workspace directory exists on disk. Last rule numbers: app-shell R50, sessions-chat R61, visuals R40, rfp R15, agents-evals R105. Next ADR: ADR-0029. Next api.md endpoints: 106, 107.

## 1. ADR-0029 — One built-in panel tool for every agent; panel items persisted on the session; `## Workflow` prompt convention

Level 3, after ADR-0028, Accepted, 2026-10-14.
- Context: today only `create_visual`/`update_visual` reach the panel (`visual-updated`); the RFP Builder writes `rfp/<id>/rfp.md` but the consultant must download it; agents have no way to put a document, a file, a table or their progress beside the chat.
- Decision: (a) one always-on tool `show_in_panel` in the assistant's core tools (never optional, like `run_readonly_sql`), in the RFP Builder's tools, and so in every user agent; in the Tools library and linkable as a mention. (b) What an agent shows is a **panel item** persisted on the session (`panelItems`, additive, no migration) with a `shownAt` that picks the latest; visuals join the same history (derived at read time for old sessions) so one menu lists everything shown. (c) A prompt's `## Workflow` section is a convention the app parses (backend, one parser) to show every phase from the first turn; the agent only moves the marker (`kind: phases`); the RFP Builder's stages move into that section and its `update_rfp` stage also drives the tracker.
- Rejected: per-kind tools (five tool lines on every turn, five SSE events); a tool-free panel that guesses from the chat (not agent-driven); storing phase lists per session (prompt edits would not propagate); table items as pointers into `messages[].data` (the answer is persisted after the tool runs, so the item would dangle on an aborted turn).
- Consequences: the assistant's and RFP Builder's prompts change (evals at the gate); an existing override shows the drift notice (ADR-0026 `baseHash`); `visual-updated` stays for compatibility and `panel-item` is the general event; session documents grow by table snapshots (≤ 200 rows each, as `data` already does).

## 2. Tool contract (pinned)

File `backend/src/mastra/tools/panel.tool.ts` (new), `createTool` id **`show_in_panel`**. Description (its first sentence is the `## Tools` line):

> Show something in the right panel beside the chat: a workspace file, a Markdown document you compose, a query result as a table, an existing visual, or your workflow phases. Each call replaces what the panel shows and is kept in the session's panel history. Use it when the user would rather read, sort or download the content than scroll the chat; keep the chat answer short and say what the panel shows.

Input — a flat object with scalar fields (no arrays; `toolLines` needs `.shape`). Per-kind validation happens in `execute`, which returns `{ error }` and never throws:

```ts
z.object({
  kind: z.enum(['file','document','table','visual','phases']).describe('What to show: file (a text file in the session workspace), document (Markdown you write), table (a query result from this turn), visual (an existing visual), phases (your workflow progress)'),
  title: z.string().optional().describe('Heading shown in the panel; defaults per kind'),
  path: z.string().optional().describe('file: workspace-relative path, e.g. rfp/<rfpId>/rfp.md or notes/summary.md'),
  markdown: z.string().optional().describe('document: the full Markdown text, at most 50,000 characters'),
  record: z.number().int().optional().describe('table: the number of the query result in this turn, 1 for the first; defaults to the latest'),
  visualId: z.string().optional().describe('visual: id of a visual listed in the session context'),
  current: z.number().int().optional().describe('phases: the phase in progress, 1 to the number of phases in the ## Workflow section'),
  done: z.string().optional().describe('phases: completed phase numbers, comma-separated, e.g. "1,2"; omit for none'),
})
```

Output: `{ shown: true, id, kind, title, bytes? (file), rowCount? (table) }` or `{ error }`.

Exact errors:
- `No session in context`
- file: `path is required for kind "file"`, `Invalid file path "<path>"` (absolute, `..`, `.`, empty segment, symlink), `File "<path>" not found in the session workspace`, `File "<path>" is not a text file: show .md, .txt, .csv, .json, .sql, .yaml, .yml or .log files`, `File "<path>" is larger than 256 KB`
- document: `markdown is required for kind "document"`, `The document is at most 50,000 characters`
- table: `No query result in this turn to show: run the query first`, `record <n> does not exist: this turn has <k> query results`
- visual: `visualId is required for kind "visual"`, `Visual "<id>" not found in this session`
- phases: `This agent has no "## Workflow" section in its prompt, so there are no phases to track`, `current must be a phase number from 1 to <n>`, `done must list phase numbers from 1 to <n>`

Limits: file 256 KB; document 50,000 chars; table rows ≤ `STORED_ROWS_CAP` (200, `truncated` flagged); ≤ 100 items per session (oldest `file`/`document`/`table` items dropped first; `visual`/`phases` items are upserted, never dropped).

Execution: reads `session-id`, `turn-data-records` and `turn-question` from requestContext (table rows come only from the live turn array: grounding), then calls a new bridge method `getDatasetToolServices().showPanelItem(sessionId, input, turnRecords)` (`tool-services.ts`, implemented in `SessionsService.onModuleInit` like `createVisual`) which validates, upserts the item, patches `workflowState`, and returns the stored item. Default titles: file = base name; document = `Document`; table = the record's rationale first sentence or `<tool> result`; visual = the visual's title; phases = `Workflow`.

Resolution per agent: assistant `ALL_TOOLS = { ...datasetTools, ...visualTools, show_in_panel, ask_clarification }` (core, unaffected by `OPTIONAL_AGENT_TOOLS`); `agent-links.ts` adds `show_in_panel` to `LIBRARY_TOOLS` and `ALWAYS_ON_TOOLS`; frontend `LINKABLE_TOOLS` gains `{ name: 'show_in_panel', description: 'Shows a file, document, table, visual or workflow progress in the right panel.' }`; `rfpTools` gets `show_in_panel` before `ask_clarification`; user agents run on the assistant, so they always get it (Tools tab status `Always on`). `sessions.service.ts:1569` sets `TURN_RECORDS_CONTEXT_KEY` for every agent.

Prompts: `ASSISTANT_WORKING_RULES` gains, after the *Interactive visuals* block:

```
Right panel:
- Call [[tool:show_in_panel]] when a result reads better beside the chat
  than in it: a document you wrote, a file in the workspace, a long query
  result as a sortable table, or a visual to bring back. Then say in one
  sentence what the panel shows.
- When your instructions have a ## Workflow section, call it with kind
  phases whenever you start or complete a phase.
```

`RFP_PROMPT`: a `## Workflow` section between the identity paragraph and `## Working rules`: `1. Client and renewal — [[skill:rfp-client-renewal]]` … `7. Assemble and review — [[skill:rfp-package]]`, then the "Load a stage's skill before you start that stage…" sentence. The Process bullet that listed the stages becomes: `- The stages are listed under ## Workflow. When you start a stage, call [[tool:show_in_panel]] with kind phases (current = the stage, done = the stages completed). After [[tool:export_rfp_package]], show the document with [[tool:show_in_panel]] kind file and path rfp/<rfpId>/rfp.md.` The `rfp-package` skill's `Tools for this stage:` line adds `[[tool:show_in_panel]]` and its "Save and export" step adds `3. show_in_panel(kind='file', path='rfp/<rfpId>/rfp.md')`. Golden fixtures regenerate from code.

## 3. Persisted shape (data-model 3.4, new 3.4.4; frontend mirror in `session.model.ts`)

```ts
export type PanelItemKind = 'file'|'document'|'table'|'visual'|'phases';
interface PanelItemBase { id: string; kind: PanelItemKind; title: string; shownAt: string /* ISO; latest wins */ }
export interface FilePanelItem extends PanelItemBase { kind:'file'; path: string; bytes: number }
export interface DocumentPanelItem extends PanelItemBase { kind:'document'; markdown: string }
export interface TablePanelItem extends PanelItemBase { kind:'table'; tool: string; input?: string; columns: string[]; rows: Record<string,unknown>[]; rowCount: number; truncated?: boolean }
export interface VisualPanelItem extends PanelItemBase { kind:'visual'; visualId: string }   // id `visual:<visualId>`, upserted
export interface PhasesPanelItem extends PanelItemBase { kind:'phases' }                     // id `phases`, upserted
export type PanelItem = FilePanelItem|DocumentPanelItem|TablePanelItem|VisualPanelItem|PhasesPanelItem;
export interface WorkflowState { current: number; done: number[]; updatedAt: string }
export interface WorkflowPhase { number: number; title: string; skill?: string }
export interface WorkflowView { phases: WorkflowPhase[]; current: number|null; done: number[] }
// SessionDoc: panelItems?: PanelItem[]; workflowState?: WorkflowState
// SessionView (derived in toView, never stored): panelItems always present; workflow?: WorkflowView
```

Ids: `file`/`document`/`table` get a uuid. Latest = max `shownAt`. Visuals unify with the menu: `saveVisualMetadata` (create/update/tailor/revert, tool and HTTP paths) upserts `visual:<id>` with `shownAt = now`; `toView` adds a synthesized `visual:<id>` item (`shownAt = createdAt`) for any visualization without one, so old sessions need no migration. `show_in_panel kind visual` re-stamps that item.

RFP stage auto-drive: extend `TurnRfpHolder` with `stage?: number`, set by `create_rfp`/`get_rfp`/`update_rfp` results; on `update_rfp`'s `tool-result` (mid-turn) and after the turn, set `workflowState = { current: min(stage+1, 7), done: [1..stage] }`, upsert the `phases` item and emit `panel-item`.

## 4. SSE

`StreamEvent.type` adds `'panel-item'`; `content` = JSON of `{ item: PanelItem; workflow?: WorkflowView }` (workflow only for `phases`), emitted on a `show_in_panel` result without `error` (and on the RFP stage auto-drive), before its `tool-result` `{ tool: 'show_in_panel', input: <title>, error? }`. Frontend: `sessions-api.service.ts` `case 'panel-item'` → `onPanelItem`; `session-chat.ts` `panelItem = output<PanelItemEvent>()` forwarded like `visualUpdated`; `App.onPanelItem(event)` refreshes the session, sets `activePanelItem`, calls `showVisualization` for a visual item, and opens the panel. `visual-updated` keeps working; `onVisualUpdated` also sets `activePanelItem` to the visual's item.

## 5. API (api.md 2.1)

- **106 `GET /sessions/:id/panel-items/:itemId/file`** → `200 { item: FilePanelItem, contentType, text }` (text ≤ 256 KB). Errors: `404 "Session <id> not found"`, `404 "Panel item \"<itemId>\" not found"`, `400 "Panel item \"<itemId>\" is not a file"`, `404 "File \"<path>\" not found in the session workspace"`, `400 "File \"<path>\" is larger than 256 KB"`.
- **107 `GET /sessions/:id/panel-items/:itemId/download`** → attachment: file = its bytes with its content type (`.md` text/markdown, `.csv` text/csv, `.json` application/json, others text/plain), filename = base name; document = `<slug>.md`; table = `<slug>.csv` (RFC 4180 quoting, header row = columns); `400 "Panel item \"<itemId>\" can't be downloaded"` for visual/phases. Owner-scoped like every session route.
- `GET /sessions/:id` and `done` carry `panelItems` and `workflow`.
- Path safety: move `safeRelativePath` to `backend/src/modules/sessions/workspace-files.ts` (shared with rfp-packages), resolve under `sessionWorkspacePath`, `lstat` (reject symlinks), extension allow-list.

## 6. Workflow parsing

Parser `backend/src/mastra/workflow-section.ts` (plain TS, no Mastra import): `parseWorkflow(prompt: string): WorkflowPhase[]`. The section starts at a line exactly `## Workflow` (trailing spaces ignored) and ends at the next line starting with `## ` or EOF. A phase line matches `^\s*(\d+)[.)]\s+(.+?)(?:\s+[—–-]\s+\[\[skill:([A-Za-z0-9_-]+)\]\])?\s*$`; `number` = position in the list (the written number is ignored), `title` trimmed and clipped to 80 chars, `skill` from the link; other lines are prose; at most 20 phases. Parse the unresolved prompt (links intact); the model sees the section with `resolveLinks` applied.

Effective prompt per session (`effectiveWorkflowFor(session, agentConfig?)` in `sessions.service.ts`): `agentKey === 'rfp'` → the RFP override or `RFP_PROMPT`; user agent → its Live `instructions` (preview: draft) if they contain the section, else the assistant's effective prompt; plain session → the assistant's. The derived `workflow` goes on `SessionView`. The tool's `phases` branch validates against the same list and stores `workflowState`. The frontend never parses prompts.

## 7. Frontend

New **`session-panel/`** host (`app-session-panel`) in `features/sessions/components/`, replacing `<app-interactive-visual-panel>` in `app.html` (inputs: `session`, `item: PanelItem|null`, the existing visual inputs; outputs: `selectItem` plus the existing visual outputs passed through).
- Header: item title (or `Panel`), a **shown-items menu** (history icon + count + chevron, title `Shown in this session`, items newest first with kind icon, title and time, backdrop `aria-label="Close panel menu"`, `menu` class), a **Download** `btn-icon` (title `Download file` / `Download (.md)` / `Download (.csv)`; hidden for visual and phases).
- Body by kind: `visual` → the existing `app-interactive-visual-panel` unchanged; `document` → `panel-document-view/` (sanitised Markdown, ui.md 3.5 prose container); `file` → `panel-file-view/` (fetches #106; `.md` as Markdown, others in a monospace `pre` on `surface-muted`; `Loading file…`; errors in `on-danger-soft`); `table` → `panel-table-view/` (sortable, header click toggles asc/desc with `aria-sort`, footer `<rowCount> rows` + `(first 200 shown)` when truncated, collapsible `Query` with the SQL); `phases` → `workflow-tracker/` (vertical list, `Phase <n>` + title, chips `Done` `chip-success`, `Current` `chip-info`, upcoming muted, skill name as a small monospace caption, header `Workflow · <done>/<total> done`).
- Empty state: sparkle tile, `Nothing to show yet`, `The agent can show files, documents, query results, visuals and its workflow here.` A session with `workflow` but no items opens on the tracker.
- Toasts: `Downloaded <name>`, `Download failed`. Theme tokens only (Light/Dark).
- `App`: `activePanelItem` signal; `openSession` → `loadLatestPanelItem(session)` (replaces `loadLatestVisualization`); `activeVisualizationId` stays `activeVisualization()?.id`.
- `prompt-links.ts` gains the tool.

## 8. Specs

New capability `specs/capabilities/agent-panel/spec.md` (Feature `Agent panel`, E2E `agent-panel.spec.ts`), README row, rules R1–R12. Cross-links: app-shell R10/R14, visuals R19/R20, sessions-chat R21, rfp R4/R9, agents-evals R82/R87/R99. System: agents.md 2.1, 2.8, new 3.11, 4.2, 5.1, 7.4 and Appendices A/C; api.md #106/#107 and the `panel-item` event; data-model 3.4/3.4.4/§6; ui.md 1.4, 1.5, 4.13 (Session panel with sub-sections), §7 copy; glossary *panel item*, *workflow phase*; epic spec; roadmap 1.14.18.

Gherkin (Feature `Agent panel`): a composed document opens in the panel and downloads as `.md`; a query result shows as a sortable table; a workspace file opens with a download; an invalid path is refused; the agent re-opens a visual; the tracker shows every phase from the first turn and the current one; shown items survive reopening the session.

## 9. Evals

The assistant's prompt gains a tool line and the Right panel rules → `world-cup` and `formula-1` sets on base and branch, 100% × 3. The RFP prompt and `rfp-package` skill change → `rfp` set, 100% × 3. Watch `rfp-skill-first` (`toolOrder skill → list_clients`): a `phases` call before `skill` would break it.

## 10. Work units

- **A — backend tool, persistence, SSE, endpoints.**
- **B — workflow parser and prompts.**
- **C — frontend.**
- **D — specs, ADR, roadmap, epic, glossary.**
- **E (acceptance gate)** — `frontend/e2e/agent-panel.spec.ts`, evals, evidence, changelog, retrospective.

## 11. Addendum (2026-10-14) — the workflow status bar and `update_workflow`

Asked by the user: "a new panel so the user will be able to display what is the current status of the workflow being defined in the system prompt, also a tool for the agent to create the workflow stepper and update it as long as the user interacts with the agent; this status bar should have its own tool". Decisions: the bar is pinned under the session header, above the chat (always visible, whatever the right panel shows); steps from a `## Workflow` section are fixed (the agent only sets status), and an agent without the section can define its own steps; `show_in_panel` keeps its `phases` kind (both drive the same state); tracked in BA-231.

### Tool `update_workflow` (new file `backend/src/mastra/tools/workflow.tool.ts`)

Always on for every agent, exactly like `show_in_panel` (assistant `ALL_TOOLS` after `show_in_panel`, `rfpTools` after `show_in_panel`, `LIBRARY_TOOLS` + `ALWAYS_ON_TOOLS`, frontend `LINKABLE_TOOLS` with description `Creates and updates the workflow status bar above the chat.`). Description (first sentence is the `## Tools` line):

> Create or update the workflow status bar above the chat: the steps of the process you are guiding the user through and where they are in it. Call it when you start or finish a step; the steps of your ## Workflow section are already there, so only set their status.

Flat input (all optional):

| Field | Zod `.describe` |
|---|---|
| `steps` | `Only when your prompt has no ## Workflow section: the step titles in order, separated by " \| ", e.g. "Scope \| Analyse \| Report"; replaces your steps` |
| `current` | `The step in progress, 1 to the number of steps` |
| `done` | `Completed step numbers, comma-separated, e.g. "1,2"` |
| `skipped` | `Step numbers that do not apply, comma-separated` |
| `waiting` | `true when the current step waits for the user's answer or decision` |
| `note` | `Markdown for the current step: what you need from the user now, at most 2,000 characters` |
| `replies` | `Up to 4 suggested replies for the user, separated by " \| ", e.g. "Confirm \| Change the carriers"` |

Rules and exact errors (thrown by the bridge, returned as `{ error }`):
- `steps` when the effective prompt has a `## Workflow` section → `Your ## Workflow section defines the steps; set their status instead`.
- `steps`: 2–12 titles, each 1–80 characters after trimming → `steps takes 2 to 12 titles of at most 80 characters each`.
- No steps at all (no section, none defined yet, no `steps` in this call) → `There is no workflow yet: pass steps to create one`.
- `current`/`done`/`skipped` out of range → `current must be a step number from 1 to <n>`, `done must list step numbers from 1 to <n>`, `skipped must list step numbers from 1 to <n>`.
- `note`/`replies` limits and errors as for `show_in_panel` `phases` (`The note is at most 2,000 characters`, `replies takes at most 4 replies of at most 80 characters each`).
- Omitted `current` keeps the stored one (unlike `show_in_panel` phases, which defaults to the first step not done); omitted `done`/`skipped` keep the stored lists; `note`/`replies`/`waiting` belong to the current step: omitted means cleared when `current` changes, kept when it does not. New `steps` reset the state (current 1, nothing done).
- Result: `{ updated: true, steps: <n>, current, done: [...], skipped: [...] }`.

### State and view (session entity; data-model 3.4.4)

`WorkflowState` gains `steps?: string[]` (agent-defined, only without a prompt section), `skipped?: number[]`, `waiting?: boolean`; `current` becomes optional-semantics as today. `WorkflowView` gains `source: 'prompt' | 'agent'`, `skipped: number[]`, `waiting?: boolean` (plus `note`, `replies`). `phases` come from the prompt section, else from `state.steps` (titles, no skill). A session has a `workflow` view when either exists. `show_in_panel` kind `phases` validates against the same step list (so it also works with agent-defined steps) and writes the same state (its own default-current rule stays). The RFP stage auto-drive keeps working on the same state and clears `waiting` with the card when the step changes.

### Stream

New SSE event `workflow` with `content` = JSON `WorkflowView`, emitted after every successful `update_workflow`, after `show_in_panel` kind `phases`, and after the RFP stage auto-drive. `update_workflow` does **not** create a panel item and does not open the right panel. (`show_in_panel` phases keeps emitting `panel-item` as today.) Frontend: `sessions-api.service.ts` `case 'workflow'` → `onWorkflow(view)`; `session-chat` patches `session.workflow` live; `done` brings the persisted view.

### UI — the workflow bar (`frontend/src/app/features/sessions/components/workflow-bar/`)

Shown in the session-chat view directly under the page header and above the transcript whenever `session.workflow` exists (also before the first turn when the prompt has a section). One row: the steps as a horizontal stepper — each step an icon + its title (12 px), joined by short `border` connectors: Done `check` in `on-success-soft` on `success-soft`, Current a filled `primary` dot with the title in `fg-strong` 600, Waiting for you an `on-warning-soft` `clock` on `warning-soft` with tooltip `Waiting for you`, Skipped muted with a line-through, Upcoming an empty `border-strong` circle in `fg-muted`; at the right `n/m done` (done count / steps not skipped). Overflow scrolls horizontally with the current step scrolled into view; below 720 px only the current step and `n/m` show. `role="list"` `aria-label="Workflow"`, each step `role="listitem"` with `aria-current="step"` on the current one. A second row, only when the current step has a note or replies: a `chevron-right` + the note (sanitised Markdown, clamped to 2 lines with a `Show more`/`Show less` toggle) and the reply buttons (follow-up chip style) at the right; a reply fills the composer and focuses it, never sends (`aria-label="What the agent needs now"`). A collapse `btn-icon` (`chevron-up`/`chevron-down`, title `Hide workflow` / `Show workflow`) folds the bar to the single line `Workflow · <current step title> · n/m`; the folded state is per browser (localStorage `questions-to-insights:workflow-bar-collapsed`, try/catch). Clicking a step opens a small popover (`menu`): its number and title, its status label, the linked skill as a monospace caption when any; Escape/backdrop closes. Light/Dark via tokens only. The panel's workflow tracker (show_in_panel phases) stays and renders the same view (skipped and waiting statuses added).

### Prompts

Assistant `ASSISTANT_WORKING_RULES`: the Right panel block's second bullet is replaced by a new block after it:
```
Workflow:
- When your instructions have a ## Workflow section, call
  [[tool:update_workflow]] when you start or finish a step, with a note
  saying what you need from the user and the replies they are likely to
  give.
- Without that section, when the user asks you to guide them through a
  process of several steps, create the steps with it first.
```
RFP Builder Process bullet: `- The stages are listed under ## Workflow. When you start a stage, call [[tool:update_workflow]] (current = the stage, done = the stages completed) with a note saying what you need from the consultant in this stage and the replies they are likely to give; set waiting while you wait for their decision. After [[tool:export_rfp_package]], show the document with [[tool:show_in_panel]] kind file and path rfp/<rfpId>/rfp.md.` Golden fixtures and agents.md Appendices A/C regenerate (tools lines gain `update_workflow(steps, current, done, skipped, waiting, note, replies)`).

## 2026-10-14 — Suggested replies removed

On the user's request the suggested replies were removed (BA-231). `replies` is gone from `update_workflow` and `show_in_panel`, from the stored workflow state and the workflow view, from the workflow bar and the tracker's card, and from the assistant's Workflow block and the RFP Builder's Process rule. The note stays. Sections above that describe replies are kept as written for history. Stored sessions that still carry `replies` load fine: the field is ignored and never returned.

## 2026-10-14 — What the user must do in every open step (action and `todo`)

Asked by the user: "for the items that still open, add a description of the action that the user should perform or what needs to be done, right now is not clear what is pending for the user". Scope chosen: the workflow bar steps (and the panel tracker, which renders the same view).

1. **Default action from the prompt.** A `## Workflow` phase line may end with `: <action>` after the title or after the skill link: `3. What to market — [[skill:rfp-market-scope]]: Decide which lines go out to bid.` or `2. Analyse: Run the queries and compare the results.` The action is everything after the first `: ` that follows the title (or the skill link when there is one), trimmed, clipped to 120 characters; a line without it has no default action. `WorkflowPhase` gains `action?: string`. Lines without an action parse as before.
2. **Agent override.** `update_workflow` gains an optional flat input `todo`: `What the user must do, or what still has to happen, for open steps: "<step>: <action>" items separated by " | ", e.g. "3: Confirm Medical and Dental go to bid | 4: Choose 2 to 4 carriers to invite"; replaces the action of each step it names; "<step>:" with nothing after it restores the default`. Errors: `todo must list "<step>: <action>" items separated by " | "`, `todo step <n> is not a step number from 1 to <count>`, `A step action is at most 120 characters`. Stored as `WorkflowState.todos?: Record<string, string>` (step number to action), kept across calls until replaced or reset, cleared when `steps` redefine an agent workflow. The derived view gives each phase `action` = the stored override, else the prompt default. Done and skipped steps keep their action in the data; the UI hides it. `show_in_panel` kind `phases` gets no `todo`.
3. **Prompts.** The RFP Builder's `## Workflow` lines carry a default action each; its Process bullet says the agent sets `todo` for the stage it starts with the concrete action for this client. The assistant's Workflow block asks for `todo` with what the user must do for each open step, and for its own steps to come with their todo.
4. **UI.** The bar's second row shows, for the current step (current or waiting) with an action, `Your next step:` (13 px semibold `fg-strong`) then the action (13 px `fg`), the note below it as before; with no action, the note as before. Each upcoming step's button has the tooltip `To do: <action>` and its popover a `To do` line; done and skipped steps show no action. The panel tracker shows the action as a 12 px `fg-muted` line under the title of every open step.

## 2026-10-14 — The workflow lives only in the bar

**Problem.** The workflow showed twice: in the bar above the chat and as the `Workflow` tracker item of the right panel (put there by `show_in_panel` kind `phases` and by the RFP stage auto-drive, which upserted a `phases` panel item and sent `panel-item`). When a visual was shown the tracker disappeared from the panel. The user chose: **the bar is the only home of the workflow; the right panel is for content only.**

**Backend.**
- `show_in_panel` kinds are `file | document | table | visual`. The inputs `current`, `done` and `note` (phases-only) are gone, so the `## Tools` line is `show_in_panel(kind, title, path, markdown, record, visualId)`; the description lists the kinds as "...a query result as a table, or an existing visual." The bridge no longer reads or writes `workflowState`, and the per-kind builder, `PHASES_ITEM_ID`, `phaseCount` and the phases errors are removed.
- The RFP stage auto-drive writes `workflowState` and emits `workflow` only; no `phases` item, no `panel-item`. `update_workflow` was already so. The orchestrator no longer emits `workflow` after `show_in_panel`.
- Read-time rule: `withVisualItems` drops stored items of kind `phases`, so `panelItems` on the wire never holds one and a request for `phases` is `Panel item "phases" not found`. No migration.
- Prompts and skills: no mention of `phases` remained in the assistant's *Right panel* block, `RFP_PROMPT` or the `rfp-*` skills; the golden fixtures changed only by the `show_in_panel` tool line.

**Frontend.**
- Session panel: no `phases` kind, no tracker view, no `Workflow` entry in the shown-items menu; the panel never opens on a workflow. Empty state: "The agent can show files, documents, query results and visuals here." `workflow-tracker` is deleted; its look moved into the bar's Details.
- Workflow bar: a `Details` button (`btn btn-secondary`, chevron, `aria-expanded`, `aria-controls="workflow-details"`, `data-testid="workflow-details-toggle"`) beside the count opens a `card` dropdown (`role="region"`, `aria-label="Workflow details"`, max 60 vh, scrolls) under the bar, over the chat. One row per step: number, title, status chip, `To do: <action>` for open steps, skill caption and, under the current step, the note as sanitised Markdown. It closes on Escape, an outside click and the button. The second row is one truncated line, `Your next step: <action>` (full text as tooltip; with no action, the note's first line as plain text), and a link-style `Note` button opens Details scrolled to the current step. The note is no longer in the bar (no clamp, no Show more/less). The step popover is unchanged.
- App wiring: `onPanelItem` no longer patches the session's workflow from a `panel-item` and nothing opens the panel for a workflow change.

**Specs.** agent-panel (R2, R7 and R7a retired, R9, R10, R12, R15, R17, new R17a, R18, R19, Gherkin), agents.md 2.1/3.11/3.12/5.1, api.md, data-model.md, ui.md 4.12.1/4.13/7, glossary, roadmap 1.14.18.
