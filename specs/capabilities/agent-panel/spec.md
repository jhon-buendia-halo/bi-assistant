# Agent panel

An agent decides what the right panel shows, and keeps the user oriented in its process. With one built-in tool, `show_in_panel`, available to every agent, it can put a workspace file, a Markdown document it wrote, a query result as a sortable table, or an existing visual beside the chat, so the user reads, sorts or downloads the content instead of scrolling the chat. Everything an agent shows is kept with the session: the user can open any earlier item from a menu and finds the same items when the session is reopened. A second built-in tool, `update_workflow`, drives the **workflow bar** pinned above the chat: the steps of the process the agent is guiding the user through, where they are in it and what the agent needs from them now, visible whatever the right panel shows. The bar is the only home of the workflow: the right panel is for content only, and the bar's **Details** dropdown lists every step.

## Concepts

Defined in [the glossary](../../product/glossary.md): panel item, session panel, workflow phase, workflow section, workspace, workflow bar, visual, session, agent, Official agent, user agent, tool, skill.

Capability-local vocabulary:
- **Kind** — what a panel item is: `file`, `document`, `table` or `visual`.
- **Latest item** — the panel item with the most recent time shown; it is what the panel opens on.
- **Details** — the workflow bar's dropdown: every step vertically, with its status, action, skill and, under the current step, the note (R17a).
- **Step** — one entry of the workflow bar. A workflow phase (R8) is a step; an agent without a workflow section can define its own steps (R14); a workflow-backed agent's steps are the steps of its code-defined workflow (R8a). Phases and steps are the same thing in the shared workflow state (R15).
- **Step status** — `Done`, `Current`, `Waiting for you` (the current step, when the agent waits for the user), `Failed` (the step of a workflow-backed agent's turn that failed, R8a), `Skipped` or upcoming.
- **Note** — the current step's Markdown note; the bar's next-step row links to it (R17) and the Details dropdown shows it under the current step (R17a).

## Rules

### The tool

- R1. Every agent SHALL be able to call the tool `show_in_panel`: the assistant and every user agent. It SHALL be part of the assistant's core tools, never optional, so no tool selection can turn it off and a user agent's tool list always includes it. In the Tools library it SHALL be listed and linkable as a mention like the other tools, and a user agent's Tools tab SHALL show it as `Always on` ([agents-evals](../agents-evals/spec.md)).
- R2. The tool SHALL take a `kind` (`file`, `document`, `table` or `visual`), an optional `title` and the fields of that kind (R3 to R6). Each call SHALL replace what the panel shows with the item it names and add that item to the session's panel history (R10). It SHALL answer `{ shown: true, id, kind, title }`, plus `bytes` for a file and `rowCount` for a table, or `{ error }`; it SHALL never throw, so the agent can correct a call and retry. A call without a session answers `No session in context`. The title defaults per kind: the file's base name, `Document`, the query's first rationale sentence or `<tool> result`, the visual's title. The tool shows content only: it has no workflow kind and no `current`, `done` or `note` inputs, and the workflow is set with `update_workflow` (R13 to R15). The tool's schema, description and limits are in [agents.md](../../system/agents.md) 3.11.

### What each kind shows

- R3. `file` SHALL show a text file of the session workspace by its workspace-relative path (for example `notes/summary.md`). The path SHALL be refused when it is empty, absolute, contains `..`, `.` or an empty segment, or passes through a symbolic link. Only `.md`, `.txt`, `.csv`, `.json`, `.sql`, `.yaml`, `.yml` and `.log` files SHALL be shown, up to 256 KB. A `.md` file SHALL render as a document; every other file (a `.csv` included) SHALL show as monospace text. The item stores the path, not the content, and the panel reads the file when the item is opened, so a later change to the file shows the next time it is opened.
- R4. `document` SHALL show Markdown the agent composes, up to 50,000 characters. The text is stored in the item, rendered with the app's Markdown rendering and sanitised like any answer.
- R5. `table` SHALL show a query result of the current turn, chosen by its number in the turn (1 for the first; the latest when omitted). It SHALL show the result's columns and its stored rows (at most 200; the item records the row count and that the rows were cut). Results of earlier turns SHALL NOT be shown: the rows come only from the turn in progress, so the table is always what the agent just ran. The rows are copied into the item, so the item survives an aborted turn. The panel SHALL let the user sort by any column and SHALL show the SQL of the query.
- R6. `visual` SHALL bring an existing visual of the session back into the panel at its current version, by its id as listed in the session context ([visuals](../visuals/spec.md) R19, R20).
- R7. Retired. The kind `phases` and the tracker in the panel moved into the workflow bar (R16 to R18); the number is not reused. A call with kind `phases` is rejected by the tool's schema like any unknown kind.
- R7a. Retired with R7. The agent's note for the current step is set with `update_workflow` and shown by the bar (R17, R17a).

### The workflow section

- R8. An agent's instructions MAY contain a **workflow section**: a line that is exactly `## Workflow` (trailing spaces ignored), up to the next line that starts with `## ` or the end of the text. Inside it, each list line `<n>. <title>` or `<n>) <title>` is a phase, optionally ending with ` — [[skill:<name>]]` (an em dash, an en dash or a hyphen) that names the skill the phase uses, and optionally with a **default action**, `: <action>`, after the title or after the skill link (`3. What to market — [[skill:market-scope]]: Decide which lines go out to bid.`, `2. Analyse: Run the queries and compare the results.`): the action is everything after the first `: ` that follows the title (or the skill link), trimmed and cut to 120 characters, and tells the user what to do in that step; a line without it has no default action. A phase's number SHALL be its position in the list, whatever number is written; its title is trimmed and cut to 80 characters; at most 20 phases are read; every other line is prose. The section SHALL be read from the prompt with its links intact, and the model sees the section with the links shown as plain mentions. The session's workflow is that of the prompt its agent runs: a user agent's Live instructions (the draft's in the preview) when they contain the section, otherwise the assistant's prompt; a plain session's, the assistant's. The app, not the model, SHALL derive the phases, so the tracker shows every phase from the first turn, before the agent calls the tool.
- R8a. A **workflow-backed agent** (today only Questions to Insights v2, ADR-0034) is the agent of a **code-defined workflow** ([workflows](../workflows/spec.md), ADR-0040). It has no workflow section and no `update_workflow`: each streamed turn runs that code-defined workflow, and its steps are the session's workflow. The bar SHALL show those steps (for v2: `Receive question`, `Load catalog`, `Analyse`, `Wrap up`) from the session's first view, before any turn, all upcoming. During a turn the app, never the model, SHALL set their status from the run: the step that starts is current (the first one clears the previous turn's progress), a step that ends is done, and a step that fails is **Failed** and stays the current step; the bar moves live through the `workflow` event (R19). A failed step ends the turn with its error, as a failed turn does today ([agent-answers](../agent-answers/spec.md) R61); a stopped turn leaves the running step current. The steps, their order and the state rules are in [agents.md](../../system/agents.md) 5.11.
- R9. Retired (2026-11-12). The RFP Builder's stage auto-drive of the workflow bar went with the RFP Builder; the number is not reused.

### History and download

- R10. Every item shown SHALL be kept in the session as a panel item with the time it was shown, newest first in the shown-items menu. A `visual` item SHALL exist once per visual: showing it again moves it to the top instead of adding another. A session keeps at most 100 items: beyond that the oldest `file`, `document` and `table` items are dropped first, and visual items are never dropped. Every visual of the session SHALL be in the history, including those made by the Generate interactive visuals button, by tailoring or by reverting (each moves the visual to the top) and those of sessions saved before this capability existed. The history never holds the workflow: a session stored with an item of the retired kind `phases` (saved before the workflow moved into the bar) returns without it, a read-time rule with no migration ([data-model.md](../../system/data-model.md) 3.4.4).
- R11. The user SHALL be able to download what the panel shows when it is a file (its own bytes, with its own name), a document or a table (`<title>.csv`, a header row of the columns and standard CSV quoting). A document, and a file whose name ends in `.md`, SHALL download as **PDF** by default (`<title>.pdf`, or the file's name with `.pdf`; the Markdown rendered as a plain printable document), with Markdown (`.md`) offered as the alternative. A visual keeps its own download ([visuals](../visuals/spec.md) R37) and nothing else is downloadable. Downloading shows the toast `Downloaded <name>`, or `Download failed`.

### Opening and restoring

- R12. The panel SHALL open, if collapsed, and show the item as soon as the agent shows it, while the turn is still streaming and without disturbing the turn ([agent-answers](../agent-answers/spec.md) R21). The user SHALL be able to open any earlier item from the shown-items menu, and the panel SHALL stay on what the user chose until the agent shows something else. Opening a session SHALL show its latest item; a session with no items SHALL show the empty state `Nothing to show yet`, whether or not it has a workflow: a workflow alone SHALL NOT open the panel. Panel items and the workflow SHALL be returned with the session, so reopening a session, in the same or another window, shows the same history.

### The workflow bar

- R13. Every agent SHALL be able to call the tool `update_workflow`, always on exactly like `show_in_panel` (R1): part of the assistant's core tools, never optional, so in every user agent's, and listed and linkable in the Tools library (`Always on` in a user agent's Tools tab). It takes optional `steps`, `current`, `done`, `skipped`, `waiting`, `note` and `todo` and answers `{ updated: true, steps, current, done, skipped }` or `{ error }`; it SHALL never throw and SHALL answer `No session in context` without a session. It SHALL NOT create a panel item and SHALL NOT open or change the right panel. Its schema, description and errors are in [agents.md](../../system/agents.md) 3.12.
- R14. Where the steps come from. An agent whose prompt has a workflow section (R8) has its steps from the prompt: they are fixed, and the agent only sets their status; a call with `steps` SHALL be refused with `Your ## Workflow section defines the steps; set their status instead`. An agent without that section MAY define its own steps by passing `steps`: 2 to 12 titles separated by ` | `, each 1 to 80 characters after trimming (`steps takes 2 to 12 titles of at most 80 characters each`); a call with `steps` replaces the agent's steps and resets the progress (current step 1, nothing done, nothing skipped). A call that sets no steps while there are none SHALL answer `There is no workflow yet: pass steps to create one`. `current` SHALL be a step number from 1 to the number of steps, and `done` and `skipped` SHALL list step numbers in that range (comma-separated), otherwise the call is refused. Keep and clear rules: an omitted `current`, `done` or `skipped` keeps the stored value; `note` and `waiting` belong to the current step, so when they are omitted they are cleared if `current` changes and kept if it does not. `note` is at most 2,000 characters. `waiting` is `true` when the current step waits for the user's answer or decision. `todo` says what the user must do, or what still has to happen, in open steps: `<step>: <action>` items separated by ` | `, each action at most 120 characters (`todo must list "<step>: <action>" items separated by " | "`, `todo step <n> is not a step number from 1 to <count>`, `A step action is at most 120 characters`). It replaces the action of each step it names, `<step>:` with nothing after it restores the step's default, and the other steps keep theirs; todos are kept across calls and cleared when new `steps` reset the workflow.
- R15. One workflow state. `update_workflow` and a workflow-backed agent's turn (R8a) write the same saved state of the session, and the bar and its Details render it, so they never disagree. `show_in_panel` never writes it. Every streamed turn is a run of the session's workflow ([agents.md](../../system/agents.md) 5.1), but only a code-defined workflow's steps write the state: a stored session of a one-step workflow (removed 2026-11-12, ADR-0042; the assistant's, the Data Readiness Agent's or a user agent's) never wrote it, and a Try it run SHALL NOT write it, so the bar's sources stay as above. A session has a workflow when its prompt has a workflow section, its agent has defined steps or its agent is workflow-backed (R8a); the steps come from the agent's code-defined workflow for a workflow-backed agent, else from the prompt when the section exists, otherwise from the agent's steps. Each step's **action** is the agent's `todo` for it, else the prompt's default action (R8); the view carries it, and the bar and Details hide it for done and skipped steps.
- R16. The **workflow bar** SHALL be shown in the session's chat view directly under the page header and above the conversation, in every session, whatever the right panel shows or whether it is open (asked by the user on 2026-10-14). While the session has no workflow (no `## Workflow` section and no steps created yet) it shows the empty state `Workflow · No workflow yet · The agent shows its steps here when it guides you through a process.` (the last sentence hidden on a narrow bar), with no fold button. With a workflow, including before the first turn when the prompt has a section, it is one row: the steps as a horizontal stepper, each with an icon and its title, and at the right the count `<n>/<m> done`, where n is the steps done and m the steps not skipped, then the **Details** button (R17a) and the fold button. The status of each step SHALL be visible: Done (a check), Current (a filled dot, the title emphasised), Waiting for you (a clock, with the tooltip `Waiting for you`, replacing the current dot while `waiting` is set), Failed (a cross in the danger colour, the title emphasised, the tooltip `Failed`; R8a), Skipped (muted, struck through) and upcoming (an empty circle). The row SHALL be a list labelled `Workflow`, with the current step marked as the current step for assistive technology. When the row is wider than the bar it scrolls horizontally with the current step in view; on a narrow bar (under 720 px) only the current step and the count show. While the row is wider than the room before the count, done and skipped steps show only their icon (their title is the tooltip and the accessible name), and if it still overflows the row's right edge fades out so the cut reads as a scroll edge.
- R17. The **next-step row** is ONE line. When the step to do next has an action (the current step, current or waiting, or, before the agent has marked one, the first open step), a second row SHALL read `Your next step:` followed by the action, truncated with an ellipsis and carrying the full text as its tooltip. When there is no action but a note, the row reads `Your next step:` followed by the first line of the note as plain text, truncated. The note is read in Details (R17a), which opens on the current step; the bar itself never shows the note, so it has no clamp and no `Show more` / `Show less`. When every step is done or skipped the row SHALL read `All steps done` (a check, success colour) instead, with no next step. Otherwise, with neither an action nor a note there is no second row. Every upcoming step with an action SHALL have the tooltip `To do: <action>` and its popover (R18) a `To do` line with the action; done and skipped steps show no action.
- R17a. **Details.** While the session has a workflow, a button `Details` (a chevron, `aria-expanded`, `aria-controls`) sits beside the count and opens a dropdown panel anchored under the bar and overlaying the chat, labelled `Workflow details`, that scrolls when taller than about 60% of the window. It lists every step vertically: the step number, the title, its status (Done, Current, Waiting for you, Skipped struck through, upcoming muted), for each open step (current, waiting and upcoming) `To do: <action>` when it has an action, the step's skill as a small monospace caption when it has one and, under the current step, the agent's note as sanitised Markdown. The dropdown SHALL open scrolled so the current step sits just under its sticky header `Workflow · <n>/<m> done`, with the steps above it hidden behind the header (never half-cut), even when it is one of the last steps, and SHALL close on Escape, on a click outside it and on the `Details` button; opening it closes any step popover. It leaves the right panel untouched.
- R18. The user SHALL be able to fold the bar with the button `Hide workflow` (`Show workflow` unfolds it); folded, it is the single line `Workflow · <current step title> · <n>/<m>` with the `Details` button still beside the fold button, and the next-step row hidden. The folded state SHALL be remembered per browser, not per session, and the bar SHALL work without browser storage. Clicking a step SHALL open a small popover with the step's number and title, its status, the action (`To do`, open steps only) and, when it has one, the skill it uses; Escape or a click outside closes it.
- R19. The stream SHALL carry a `workflow` event with the whole workflow view, sent after every successful `update_workflow` and after each step status change of a workflow-backed agent's turn (R8a), so the bar moves while the turn streams and without disturbing it ([agent-answers](../agent-answers/spec.md) R21). The `done` event and `GET /sessions/:id` carry the persisted view, so reopening a session, in the same or another window, shows the same bar. Neither sends `panel-item`: that event is only for `show_in_panel`.
- R20. Retired (2026-11-12). The RFP stage auto-drive's note and `waiting` clearing went with R9; the number is not reused. `update_workflow` and a workflow-backed agent's turn keep their own rules (R13, R8a).

## Edge cases and errors

Exact tool errors (the tool returns them; the chat shows the step with the error):
- **file:** `path is required for kind "file"`; `Invalid file path "<path>"`; `File "<path>" not found in the session workspace`; `File "<path>" is not a text file: show .md, .txt, .csv, .json, .sql, .yaml, .yml or .log files`; `File "<path>" is larger than 256 KB`.
- **document:** `markdown is required for kind "document"`; `The document is at most 50,000 characters`.
- **table:** `No query result in this turn to show: run the query first`; `record <n> does not exist: this turn has <k> query results`.
- **visual:** `visualId is required for kind "visual"`; `Visual "<id>" not found in this session`.


- **update_workflow:** `Your ## Workflow section defines the steps; set their status instead`; `steps takes 2 to 12 titles of at most 80 characters each`; `There is no workflow yet: pass steps to create one`; `current must be a step number from 1 to <n>`; `done must list step numbers from 1 to <n>`; `skipped must list step numbers from 1 to <n>`; `The note is at most 2,000 characters`; `todo must list "<step>: <action>" items separated by " | "`; `todo step <n> is not a step number from 1 to <count>`; `A step action is at most 120 characters`.

Other cases:
- **Saved progress beyond the steps:** step numbers that no longer exist are ignored by the bar.
- **A session with no workflow:** no bar.
- **A file removed after it was shown:** the panel shows `File "<path>" not found in the session workspace` in the file view; the item stays in the menu.
- **A file larger than 256 KB when opened:** the panel shows `File "<path>" is larger than 256 KB`.
- **A table with more than 200 rows:** the table shows the first 200 and the footer says `(first 200 shown)`; the download holds the same rows.
- **A prompt edited after the session started:** the bar follows the prompt's current section; saved progress for a phase number that no longer exists is ignored.
- **An agent whose section was removed:** the bar shows the empty state; its earlier items stay.
- **The agent shows something and the turn is stopped:** the item shown stays in the history; only the answer is lost.
- **Download of a visual through the API:** refused with `Panel item "<itemId>" can't be downloaded`.
- **A stored `phases` item (sessions saved before BA-231):** not returned with the session, never shown in the menu, and a request for it answers `Panel item "phases" not found`.

## Contracts

- The tools' schemas, descriptions, errors, limits and per-agent resolution; the Right panel and Workflow prompt rules; the turn context they read: [agents.md](../../system/agents.md), sections 2.1, 2.8, 3.11, 3.12, 4.2 and 5.1.
- The panel item routes `GET /sessions/:id/panel-items/:itemId/file` and `.../download`, and the `panel-item` and `workflow` stream events: [api.md](../../system/api.md), sections 2.1 (106, 107) and 3.1. `GET /sessions/:id` and the stream's `done` event carry `panelItems` and `workflow`.
- The persisted items, the workflow state and the derived workflow view: [data-model.md](../../system/data-model.md), sections 3.4 and 3.4.4; the folded state of the bar in browser storage: the browser-storage table of its section 1.
- The decision: ADR-0029 in [architecture.md](../../system/architecture.md). The design: [docs/plans/BA-213/ba-231-design.md](../../../docs/plans/BA-213/ba-231-design.md).

## UI

See [ui.md](../../system/ui.md), section 4.13 (Session panel) and 4.12.1 (Workflow bar).

- **Workflow bar:** under the page header, above the chat: the steps with their statuses, `<n>/<m> done`, `Your next step: <action>`, the note, `To do: <action>` tooltips, `Hide workflow` / `Show workflow`, a `Details` dropdown (`Workflow details`) listing every step and opening on the current one, a step popover (4.12.1).
- **Header:** the item's title (`Panel` when none), the shown-items menu (title `Shown in this session`, newest first, each with its kind icon, title and time) and the **Download** button (title `Download PDF` for a document or a `.md` file, with a `Download as…` menu offering `PDF (.pdf)` and `Markdown (.md)`; `Download file` for other files; `Download (.csv)` for a table; hidden for a visual).
- **Body by kind:** the visual panel, a document, a file, a sortable table. There is no workflow view in the panel.
- **A past chat's panel** (past-chats R66) is read-only: visuals are viewable in every version and downloadable, and files, documents and tables viewable and downloadable, but the visual panel offers no Tailor, Refresh data, revert or auto-repair.
- **Empty state:** `Nothing to show yet` / `The agent can show files, documents, query results and visuals here.`
- **Loading and errors:** `Loading file…` while a file is read; its error in the file view.

## Flows

### Feature: Agent panel

E2E: `frontend/e2e/agent-panel.spec.ts`

```gherkin
Feature: Agent panel

  Background:
    Given the app runs with the LLM stub as its provider
    And the World Cup sample dataset is loaded

  Scenario: a visual generated on a v2 answer is the run's panel item, kept on reopening and downloaded only through its own route
    Given I ran the Assistant on "How many matches were played at each stage?"
    When I run it again as a follow-up that makes a visual, shows a document and shows the visual by its id
    Then the run lists the visual "Goals per team" first and "Findings" second, once each
    And the visual downloads through its own route, never as a panel item

  Scenario: a v2 run's workflow never appears among its panel items
    Given an agent whose instructions have a "## Workflow" section with the phases "Understand", "Analyse" and "Report"
    When the stub answers by calling "update_workflow" with current 2 and done "1"
    And I run that agent on "Go on"
    Then the run holds no panel item and its workflow has the three phases

  Scenario: Questions to Insights v2 shows its code-defined steps advancing
    When the stub answers by running "run_readonly_sql" and then "There were 64 matches."
    And I run "Questions to Insights v2" on "How many matches were played in 2018?"
    Then its four steps "Receive question", "Load catalog", "Analyse" and "Wrap up" each report running, then success, in order
    And the model was offered only "list_entities", "describe_entity" and "run_readonly_sql"
    And the run's workflow shows 4 of 4 steps done

  Scenario: A failing step of the v2 workflow is marked failed
    Given the stub fails the model call with an error
    When I run "Questions to Insights v2" on "How many matches were played in 2018?"
    Then "Receive question" and "Load catalog" succeed, "Analyse" fails and "Wrap up" is skipped
    And the run ends with the turn's error
```

## Acceptance

1. A turn in which the stub calls `show_in_panel` for a document, a file, a table and a visual opens the panel on each in turn, and the Agent panel Feature's scenarios pass on the web target with the LLM stub.
2. A composed document downloads as `.md` and a table as `.csv`; an invalid path, a missing file and a binary file are refused with the exact errors above and leave the panel unchanged.
3. The workflow lives only in the bar: an agent with a `## Workflow` section shows it before its first answer, and it creates no panel item and does not open the right panel; `show_in_panel` has no `phases` kind.
4. The shown items, in order, survive reopening the session, and visuals made before this capability appear in the menu.
5. An agent with a `## Workflow` section shows the workflow bar from its first turn, and each open step says what the user must do (the prompt's default action or the agent's `todo`); an `update_workflow` call moves it live (statuses, `n/m done` and the note in Details), and an agent without a section can create its own steps but cannot rename the prompt's.
6. The chat's workflow bar (its fold, details and popover scenarios) is retired with the chat composer; a run shows the agent's phases inside its step.
6a. A Questions to Insights v2 session shows its four code-defined steps before the first turn; a turn moves them to all done live, and a failing step shows as Failed while the turn ends with its error (R8a).
7. The assistant's eval sets (`world-cup`, `formula-1`) pass at 100% over 3 runs on the branch.

<!-- sources: backend/src/mastra/tools/panel.tool.ts, workflow.tool.ts, backend/src/mastra/workflow-section.ts, backend/src/mastra/agents/assistant.agent.ts (working rules), backend/src/mastra/tools/tool-services.ts, backend/src/modules/sessions/sessions.service.ts (showPanelItem, effectiveWorkflowFor, panel-item event, runAssistantV2Workflow), workflow-run-state.ts, backend/src/mastra/workflows/qti-v2-turn.workflow.ts, qti-v2-turn.steps.ts, sessions.controller.ts, workspace-files.ts, entities/session.entity.ts, repositories/sessions.repository.ts; frontend/src/app/features/sessions/components/session-panel/*, workflow-bar/*, panel-document-view/*, panel-file-view/*, panel-table-view/*, session-chat/session-chat.ts, services/sessions-api.service.ts, models/session.model.ts; frontend/src/app/app.ts (onPanelItem, loadLatestPanelItem), app.html; frontend/e2e/agent-panel.spec.ts -->
