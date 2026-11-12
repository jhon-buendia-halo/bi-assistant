# Past chats

Before runs, the user held named, persistent conversations (sessions) with the assistant. Since 1.23.22 nothing in the app starts or continues a chat: every question is a run of a workflow ([workflows](../workflows/spec.md)) and its answer is described in [agent-answers](../agent-answers/spec.md). The sessions already on disk stay: they list under **Runs → Past chats**, open **read-only** with their transcript, visuals, panel items, reports and files, can be downloaded from, and can be deleted. Nothing writes to them, and no stored shape changed. This spec is what stayed of the former sessions-chat capability; its rule numbers (R1–R7, R49, R57, R59, R60, R62, R63, R65, R66) are kept so older references still read.

## Concepts

All terms are defined in [glossary](../../product/glossary.md): **Session** (a stored past chat), **Dataset**, **Datasource**, **Session workspace**, **Agent memory thread**, **Visual** (see [visuals](../visuals/spec.md)), **Deep analysis** (a report a past chat holds, see [deep-analysis](../deep-analysis/spec.md)), **Run** (see [workflows](../workflows/spec.md)).

## Rules

### Stored sessions

- R1. Retired (1.24.12, removed 1.23.27). A session was created only with a non-blank name and at least one dataset. No route, screen or script creates a session any more: `POST /sessions` is gone ([api.md](../../system/api.md) 3, "Removed in 1.23.27").
- R2. A stored session keeps its unique id, its transcript, its visual list and its own session workspace (a private file area for visuals and reports).
- R3. The system SHALL list sessions most recently written first, as the backend returns them.
- R4. The system SHALL ask for confirmation before deleting a session, then permanently remove its transcript, its agent memory thread and its workspace files (all visual versions included).
- R5. The system SHALL NOT offer renaming a session or changing its datasets. *(Open question: confirm they are out of scope.)*
- R6. The system SHALL show, in the header of an open past chat, every datasource its datasets are bound to (name and kind). A dataset with no bound datasource is treated as bound to the default datasource: the first Databricks datasource, else the first datasource.
- R7. On startup the system SHALL make sure every existing session has a workspace and re-register it, so visuals and files survive restarts.
- R49. The full transcript SHALL be stored with the session and shown on reopen, including clarifications, visual event cards and deep-analysis reports. It survives app restarts.

### Which workflow a past chat names

- R57. Every session SHALL name the workflow it ran (R65) in the page header's session context (`Workflow` and a chip with the workflow's name, before the datasources) and in its row of the Past chats list (R63), as the row's workflow chip. Both come from the session's `workflowRef` ([api.md](../../system/api.md) 2.1). The name SHALL be the workflow's catalogue name ([workflows](../workflows/spec.md) R1): `Assistant` for a plain session, the built-in agent's workflow (`Questions to Insights v2`, `RFP Builder`, `Data Readiness Agent`) for a session bound to it, and the agent's current Live name for a session started from a user agent. A session saved before workflows existed names the workflow derived from its agent binding (R65): one saved with only `agentKey: "rfp"` reads `RFP Builder`.
- R59. When the agent is deleted, its sessions SHALL keep their transcript, memory and datasets. The page header's Workflow chip and the list row's workflow chip SHALL read `<agent name> · agent deleted`, using the name the agent last had for the session.
- R65. Every session runs exactly one workflow ([workflows](../workflows/spec.md) R1, R4; ADR-0040): a plain session the assistant's one-step workflow (`agent:assistant`, named `Assistant`), a session bound to a built-in agent that agent's workflow, and a session bound to a user agent that agent's one-step workflow (`agent:<id>`, named after its Live name). A stored session carries its `workflowId`; one saved before workflows existed derives it from its agent binding. When the user agent is deleted, its sessions keep their workflow's id and name it with the name the agent last had, marked deleted (R59).

### The Past chats list and the read-only chat

- R62. While a past chat is open, the page header's session context SHALL end with the session's id: `ID <first 8 characters>` in monospace, with the full id as its tooltip and a copy icon. Clicking it copies the full id and shows the toast "Session ID copied" ("Copy failed" when the browser refuses). A user shares the id so a session can be found and diagnosed in the app's data (BA-231).
- R63. In the **Past chats** tab of the Runs page (app-shell R46) the system SHALL list every session of the user in the middle of the page card, newest activity first as the backend returns them, under a "Search sessions by name or ID…" field (a `nav` named "Past chats") that filters by name or session id, ignoring case, **ten sessions per page**. A row SHALL show the name, its datasets, the workflow it ran as a chip (the workflow's name, R57, `<agent name> · agent deleted`, R59, or `Assistant` for a plain session; the full label as tooltip `Workflow: <label>`), the session id as `ID <first 8 characters>` (full id as tooltip; a click copies it and toasts "Session ID copied", as R62), the last activity (`updatedAt`, else `createdAt`) as `just now`, `<n> min ago`, `<n> h ago`, `yesterday` or a short date with the full date as tooltip, and an options menu with **Delete session**. Clicking a row SHALL open the session read-only (R66). The list SHALL read "Loading sessions…" until the first answer, "No past chats." when empty and `No sessions match "<query>".` when the search finds none. Under the list SHALL be `<first>–<last> of <total>` and, when there is more than one page, **Previous page** and **Next page** buttons with `Page <n> of <pages>`; a new search returns to page 1, and a deletion that empties the last page moves to the page before.
- R66. A session opened from the **Past chats** tab SHALL open **read-only** as a past chat (no session is lost or migrated): a banner "This is a past chat. You can read it, but not continue it." under the page header, its transcript through the answer view, its workflow bar and its right panel with the visuals viewable (every version) and downloadable and the panel items and files viewable and downloadable. A past chat SHALL show no composer, no starter prompts, no "Careful" or "Deep analysis", no rating or "Save as verified query", no "Generate interactive visuals" and no way to answer a clarification, and its visual panel SHALL offer no Tailor, Refresh data, revert or auto-repair. The reader can copy a question, jump to one from the history strip (one tick per user question; hovering lists the questions, clicking one scrolls to it), open a readiness scorecard, and download a deep-analysis report or an RFP package. Deleting it stays on the list (R63). Since 1.23.27 the routes that wrote to a session no longer exist ([api.md](../../system/api.md) 2.1), so nothing in the app or its API can change a past chat except deleting it.

### Ownership

- R60. A session, with its transcript, visuals, reports, workspace files and agent memory, SHALL belong to the one user (the built-in super admin; the stored `ownerId` is a legacy attribute, [data-model.md](../../system/data-model.md)). The user SHALL see every session in the list and open, download from or delete it.

## Edge cases and errors

| Situation | Behaviour |
|---|---|
| Session list fails to load at startup | Retried up to 12 times with growing delay, then the toast "Could not load sessions". Sessions already loaded are kept. |
| Session id not found | 404 "Session <id> not found". |
| Delete fails | Error toast with the server message. |
| Delete succeeds | Toast `Session "<name>" deleted`. If the deleted session was open, the main area returns to the Runs page and the visual panel clears. |
| Datasource lookup for header fails or finds none | The header shows "Unavailable". |
| Session dataset deleted or renamed later | The header still lists the stored dataset names; the past chat stays readable. |
| Agent renamed and republished | Its past chats show the new name from their next load. The session names don't change. |
| A removed write route is called | 404: `POST /sessions`, `POST /sessions/:id/messages`, `/messages/stream`, `/messages/feedback`, `/visualizations` and its tailor, revert, refresh and repair routes, and `POST /sessions/:id/deep-analysis` no longer exist. |
| Copy to clipboard | "Copied to clipboard" / "Copy failed". |

## Contracts

- Endpoints, all in [api.md](../../system/api.md): list, get and delete a session (2.1 #1, #2, #4); a visual's document and zip (#9, #14); an RFP package (#105); a file or table panel item (#106, #107); a deep-analysis report download (2.7 #48). The write routes are marked "Removed in 1.23.27".
- Data in [data-model.md](../../system/data-model.md): the `sessions` collection (unchanged; sessions stay on disk), the agent memory store and the per-session workspace directory.
- Related capabilities: [agent-answers](../agent-answers/spec.md) (how an agent's answer is produced and shown, what a past chat's transcript holds), [workflows](../workflows/spec.md) (the Runs page and runs), [visuals](../visuals/spec.md), [deep-analysis](../deep-analysis/spec.md), [rfp](../rfp/spec.md), [data-readiness](../data-readiness/spec.md).

## UI

Shell placement and tokens are in [ui.md](../../system/ui.md).

- **Past chats list, "Past chats"** (the **Runs** rail item opens the page, its second tab; app-shell R3, R46):
  - A "Search sessions by name or ID…" field above the list, filtering by name or session id, ignoring case; ten sessions per page with `<first>–<last> of <total>` and Previous / Next page buttons (R63).
  - One entry per session, newest activity first, showing its name and marked when it is the session last opened. Under the name: its datasets. Beside it, the workflow the session ran as a chip with a workflow icon (`row-session-workflow`, tooltip `Workflow: <label>`): the workflow's name (R57), `<agent name> · agent deleted` (R59, warning style), or `Assistant` for a plain session. At the right, the last activity as a relative time (`2 h ago`, `yesterday`, else a short date), with the full date as tooltip.
  - Each entry has an options button (title "Session options", label "Options for <name>") whose menu holds "Delete session". The confirm dialog reads: `Delete “<name>”?` / `This permanently removes its conversation, agent memory, and workspace files.`
  - An entry is disabled while it is being deleted.
  - Empty: "No past chats." No match: `No sessions match "<query>".` Loading: "Loading sessions…".
- **Past chat header**: "Datasource" followed by one chip per bound datasource (name and kind label, summary tooltip), a loading placeholder, or "Unavailable".
- **Page header** (app-shell R49): the session's name as the title, the session context under it (`Workflow` and the workflow chip `session-workflow` first, R57 and R59, then the datasources, then the id, R62). It has no button that starts a conversation.
- **Past chat** (main area): the banner (`past-chat-banner`), the workflow bar, then the transcript with the history strip (R66). There is no composer and no disclaimer.
- **Message kinds** (read-only): user bubble; answer (Markdown plus the provenance blocks and badges of [agent-answers](../agent-answers/spec.md) R30–R36, without the rating and visual-generation actions); clarification card (disabled); visual event card with **View**; deep-analysis report card with **Download report**; RFP package card; readiness card with **Open scorecard**.

## Flows

### Feature: Session management

E2E: `frontend/e2e/runs.spec.ts` covers every scenario below except "The conversation and its history survive a restart" (none yet). Past chats are written into the app's data dir by the specs, since no route starts a chat any more. Sessions that opened over real data and reopened after a reload are covered by the "Datasources, datasets, and sessions (World Cup database)" Feature in [datasources](../datasources/spec.md).

```gherkin
Feature: Session management

  Background:
    Given a "World Cup Core" dataset exists

  Scenario: A deleted agent's chat names its workflow as deleted
    Given a chat of my published agent "Cup historian"
    And the agent "Cup historian" is deleted
    When I click "Runs" on the rail
    Then the chat's workflow chip reads "Cup historian · agent deleted"
    When I open the chat
    Then the page header shows the workflow "Cup historian · agent deleted"

  Scenario: A chat saved before workflows names the workflow of its agent
    Given a session "Saved RFP chat" saved before workflows existed, bound to the RFP Builder with no workflow
    When I click "Runs" on the rail
    Then the "Saved RFP chat" row's workflow chip reads "RFP Builder"
    When I click "Saved RFP chat"
    Then the page header shows "Workflow" and "RFP Builder"

  Scenario: Deletes a session after confirmation
    Given a "World Cup analysis" session exists and is open
    When I click "Options for World Cup analysis"
    And I click "Delete session"
    Then I am asked to confirm 'Delete “World Cup analysis”?'
    When I confirm
    Then I see the toast 'Session "World Cup analysis" deleted'
    And the main area shows the Runs page and "World Cup analysis" is no longer listed

  Scenario: Cancelling the delete confirmation keeps the session
    Given a "World Cup analysis" session exists
    When I click "Options for World Cup analysis"
    And I click "Delete session"
    And I dismiss the confirmation
    Then "World Cup analysis" is still listed in the "Past chats" list

  Scenario: The conversation and its history survive a restart
    Given the "World Cup analysis" session has the question "Who won in 2022?" and its answer
    When I restart the application
    And I click "World Cup analysis"
    Then I see "Who won in 2022?" and its answer
    And hovering the history strip lists "Who won in 2022?"

  Scenario: I copy the session id to share it
    Given a "World Cup analysis" session exists and is open
    Then the page header shows "ID" and the first 8 characters of the session id, with the tooltip "Session ID <id> (click to copy)"
    When I click the session id
    Then I see the toast "Session ID copied"
    And the clipboard holds the full session id

  Scenario: I find my past runs under Runs and my old chats under Past chats
    Given a run and an old chat with a visual exist
    When I open Runs, then the run, then Run again
    Then the workflow opens on Run with the run's input
    When I open Past chats and the old chat
    Then I see the past-chat banner and its transcript, and no composer
    And I can open its visual in the panel and download it

  Scenario: No control on a past chat sends, rates, tailors or refreshes
    When I open an old chat from Past chats
    Then no control sends a message, answers a clarification, rates an answer, generates a visual, tailors one or refreshes its data

  Scenario: The Past chats tab finds a session by name or ID
    Given 12 sessions exist, the newest named "Cup history"
    When I click "Runs" on the rail and then "Past chats"
    Then I see 10 sessions, "Cup history" first, and "1–10 of 12" with "Page 1 of 2"
    When I click "Next page"
    Then I see 2 sessions and "11–12 of 12"
    When I type "cup HISTORY" into "Search sessions by name or ID…"
    Then I see only "Cup history", with "World Cup Core" under its name, the workflow chip "Assistant" and "ID" with the first 8 characters of its id
    When I type the first 8 characters of its id in capitals
    Then I see only "Cup history"
    When I type "nothing like this"
    Then I see 'No sessions match "nothing like this".'
    When I clear the search and click "Cup history"
    Then I see the "Cup history" chat open
```

## Acceptance

- Every scenario above passes. The covered Feature runs in `runs.spec.ts`.
- After an app restart: an existing session lists its full transcript and its visuals still open.
- Deleting a session leaves no transcript, memory thread or workspace directory behind.
- No route or screen creates or writes to a session: the removed routes answer 404 (backend e2e `response-status.e2e-spec.ts`).
- Known gaps (see the Open questions): there is no rename; datasets cannot be edited.

<!-- sources: backend/src/modules/sessions/sessions.controller.ts, sessions.service.ts, entities/session.entity.ts, repositories/sessions.repository.ts; backend/src/modules/deep-analysis/deep-analysis.controller.ts; frontend/src/app/features/sessions/components/session-chat/*, sessions-list/*, sessions-area/*, sessions-panel/*, session-panel/*, services/sessions-api.service.ts, services/sessions-state.ts; frontend/e2e/runs.spec.ts, e2e/helpers/past-chats.ts -->
