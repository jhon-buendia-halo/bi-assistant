# Sessions and chat

A session is a named, persistent conversation over one or more datasets. The user asks business questions in plain English. The assistant plans the analysis, writes and runs read-only SQL against the datasets' datasources, and streams back its reasoning, each tool call and a final Markdown answer. Every answer shows how it was produced: the queries it ran and why, the rows each returned, the entities it touched, the curated knowledge it was given, and reliability signals (automatic SQL repair, result-quality warnings, a verified-query badge and an optional independent cross-check). Users can trust a number because they can see where it came from. They can stop a turn, answer the assistant's clarifying questions, and come back after a restart to the same conversation with the same memory.

## Concepts

All terms are defined in [glossary](../../product/glossary.md): **Session**, **Dataset**, **Datasource**, **Entity** (fully-qualified `catalog.schema.table`), **Turn**, **Answer**, **Tool call**, **Data record** (one captured tool result), **Rationale**, **Reasoning trail**, **Interpretation line**, **Clarification**, **Careful mode**, **Cross-check**, **Verified query**, **Knowledge snippet**, **Metric definition**, **Session workspace**, **Agent memory thread**, **Visual** (see [visuals](../visuals/spec.md)), **Deep analysis** (see [deep-analysis](../deep-analysis/spec.md)).

## Rules

### Session lifecycle

- R1. The system SHALL create a session only when it has a non-blank name and at least one dataset. The name is trimmed and stored truncated to 64 characters.
- R2. The system SHALL give each new session a unique id, an empty transcript, an empty visual list and its own session workspace (a private file area for visuals and reports).
- R3. The system SHALL list sessions most recently written first, where any write to the session counts: a message, a rating, or a visual change.
- R4. The system SHALL ask for confirmation before deleting a session, then permanently remove its transcript, its agent memory thread and its workspace files (all visual versions included).
- R5. The system SHALL NOT offer renaming a session or changing its datasets after creation. *(Open question: rename and dataset re-attachment are not implemented. Confirm they are out of scope.)*
- R6. The system SHALL show, in the header of an open session, every datasource its datasets are bound to (name and kind). A dataset with no bound datasource is treated as bound to the default datasource: the first Databricks datasource, else the first datasource.
- R7. On startup the system SHALL make sure every existing session has a workspace and re-register it, so visuals and memory survive restarts.

### Sending a message and streaming

- R8. The system SHALL reject an empty or whitespace-only message. The composer's send action is disabled while the draft is blank.
- R9. Pressing Enter SHALL send the draft. Shift+Enter SHALL insert a newline.
- R10. The system SHALL persist the user's message before the model starts, so it survives a reload even if the turn is stopped or fails.
- R11. If the transcript already ends with an unanswered user message whose text is identical, the system SHALL reuse it instead of adding a duplicate. This is how a retry works.
- R12. While a turn runs, the system SHALL stream, in order of arrival:
  - the model's reasoning text;
  - each tool call, with its stated rationale when it has one;
  - each tool result summary (input, row count or error);
  - the answer text as it forms;
  - a visual-updated notice when a visual is created or tailored.

  The turn ends with exactly one terminal event: `done`, carrying the persisted session, or `error`, carrying a message.
- R13. While a turn runs, the chat SHALL show a "Thinking" block with:
  - the last ~90 characters of reasoning on one line;
  - one row per tool call: tool name, then "failed", "N rows" or a spinner;
  - the rationale and the input (SQL) of each call;
  - the answer as rendered Markdown while it streams;
  - an elapsed-seconds counter with one decimal.
- R14. When `done` arrives, the chat SHALL replace its whole transcript with the persisted one from the event. Streamed text is provisional. The persisted answer is authoritative and may differ, for example after the grounding check.
- R15. The system SHALL allow only one turn per session at a time from the client. While it runs, the send control becomes "Stop response".
- R16. Stopping SHALL abort the turn on the server. The client keeps any answer text already streamed as an assistant message, and the composer becomes sendable again. The server also persists partial answer text when it was stopped mid-answer.
- R17. The assistant SHALL use at most 15 model steps per turn.
- R18. If a turn ends with no answer text and no visual, the system SHALL run one extra tool-free pass that writes an answer from the data already collected. If that also yields nothing, the answer is the fixed text "I completed the data analysis but could not produce a final response. Please retry your question."
- R19. If a turn produced a non-empty answer without calling any tool, the system SHALL run one corrective pass, tools allowed, at most once per turn. That pass tells the model to re-answer data claims from executed queries, or to say the data does not cover the question. Its answer replaces the original. Any queries it runs join the answer's data records. The pass does not write to the session's memory thread.
- R20. A turn that only created or tailored a visual and wrote no text SHALL be persisted with the text `Created interactive visual "<title>" (v<N>).` or `Updated interactive visual "<title>" (v<N>).`.
- R21. A same-session refresh of the session data, for example after a visual changed or a rating was saved, SHALL NOT abort or disturb an in-flight turn. While a turn is in flight such a refresh does not replace the transcript. Only switching to a *different* session aborts the in-flight turn and resets the chat (draft, careful mode, clarification input, turn state).

### Grounding and tools

- R22. The assistant SHALL only query entities from the session's datasets. It works only through these tools:
  - list entities;
  - describe an entity (columns, types, captured sample values);
  - sample rows (default 10, max 100);
  - run one read-only `SELECT`/`WITH` statement (default limit 100, max 500).

  Tools that need a datasource SHALL ask the model to name one when several datasources are in scope, and refuse when none is bound.
- R23. Every row-sampling or SQL tool call SHALL carry a rationale: one or two plain business sentences saying why the step is taken. It is stored flattened and clipped to 400 characters.
- R24. Each turn's context SHALL give the assistant:
  - the session's dataset and entity orientation;
  - the session's visuals (id, title, current version) and which one is open;
  - the curated metric definitions for those entities;
  - the enabled knowledge snippets for the session's datasets;
  - up to 3 verified question → SQL pairs most similar to the question (by word overlap, within a 3,000-character budget);
  - for a session bound to an agent, the agent's Live instructions, last (R54).

### SQL repair (execution-guided)

- R25. When the datasource engine rejects a statement, the system SHALL hand the statement, the engine error, the SQL dialect and a capped schema of the in-scope entities to the SQL-fixer agent and re-run the rewrite. This allows at most 2 repairs, so 3 executions in total. Each repair works on the previous rewrite.
- R26. The system SHALL NOT attempt repair when:
  - the statement was refused before reaching the engine (not read-only or malformed);
  - the failure is a transport or authentication error (HTTP status, connection refused or reset, timeout, socket hang-up, DNS);
  - the fixer returns nothing usable or the same statement;
  - the fixer returns a statement that is not `SELECT`/`WITH`.

  In those cases the original error is reported.
- R27. When a repair succeeded, the system SHALL record and show the *corrected* statement as the query that ran. The model is told the original failed and was auto-corrected.
- R28. An empty result SHALL NOT trigger repair. The model is told to verify filters before concluding. A result that fills the requested row limit SHALL be flagged truncated, and the model is told results may be incomplete.

### Result-quality warnings

- R29. After every SQL run the system SHALL inspect the statement and its rows and attach any of these warnings to the data record. The texts are exact templates:
  - same expression under two names: "`<a> and <b>` are computed from the same expression, so any ratio between them is 1 by construction."
  - a measure constant on every row: "`<column>` is `<value>` on every row, so it cannot explain any difference between them."
  - limited without ordering: "The query keeps only a few rows without ranking them, so these are an arbitrary sample rather than the top results."
  - blank group keys: "`<column>` is missing on `<n>` of `<total>` rows, so those rows are grouped under a blank value."
  - row cap reached: "The result stopped at `<cap>` rows, so it is probably cut short and missing later ones."

  The model sees them too and is instructed to fix its query rather than pass the warning on. Inspection failures SHALL degrade to "no warnings", never to a failed answer.

### Persisted answer and provenance

- R30. Each persisted answer SHALL carry:
  - its data records: tool, input as run, columns, up to 200 rows, the returned row count, a truncated flag, error, rationale and warnings;
  - the entities its SQL referenced;
  - a deterministic interpretation line (R31);
  - a reasoning trail: one step per call that carried a rationale, in run order, with that call's row count or error;
  - the knowledge snippets that were in its context.
- R31. The interpretation line SHALL be built from the successful SQL runs only, never from model output: `Computed from <N> quer(y|ies)[ over <entity, …>] — <R> row(s) analyzed.` It is absent when no SQL succeeded.
- R32. Under an answer, the chat SHALL show these blocks, each only when non-empty:
  - a collapsible "How I worked this out (N step(s))" list, each step's rationale followed by "N rows" or "failed — <error>";
  - a collapsible "Knowledge in context (N)" list (kind, title, dataset or "global", body), with a note that disabled snippets are never included;
  - the interpretation line;
  - "Data entities" chips;
  - a collapsible "Data used (N query|queries)" list.
- R33. Each entry in "Data used" SHALL show:
  - `<tool> — N row(s)` or `<tool> — failed`;
  - "(truncated)" when clipped;
  - a "Copy SQL" action;
  - the rationale, each warning (with a warning icon), the SQL text and any error.
- R34. The chat SHALL offer "Copy message" on every user message and answer.

### Verified badge and rating

- R35. An answer whose last successful SQL equals a stored verified query (case-, whitespace- and trailing-semicolon-insensitive) SHALL show a "Verified" badge (tooltip "Matches an approved query"). A pair stored without a datasource matches any datasource. Otherwise the datasources must match.
- R36. An answer with data records SHALL offer "Save as verified query" (thumbs up) and "Mark answer as wrong" (thumbs down):
  - Thumbs up stores the preceding question → last successful SQL as a verified query and sets the badge.
  - Thumbs down removes that answer's stored pair and clears the badge.
  - Repeating the same rating does nothing.

  The rating is persisted on the answer. The library itself is specified in [verified-queries](../verified-queries/spec.md).

### Careful mode (cross-check)

- R37. The composer SHALL offer a "Careful" toggle. It applies to every turn sent while on. It is client-only and lasts for the open conversation: switching sessions turns it off, and it is never stored.
- R38. In careful mode, before `done`, the system SHALL check the turn's last successful SQL result:
  1. The SQL-verifier agent derives an independent query from the question alone. It sees the question, the schema with up to 3 sample values per column and similar verified pairs, never the original SQL.
  2. The system runs that query with a 200-row limit.
  3. It compares both result sets as multisets, tolerating different column widths.

  The verdict is stored on the answer.
- R39. The cross-check chip SHALL read "Cross-checked" (agree), "Cross-check differs" (disagree) or "Cross-check failed" (error). Its tooltip is the note, clipped to 220 characters:
  - agree: "independent re-derivation returned the same results", or "…returned the same figures, over different columns";
  - disagree: "results differ — treat with care — <reason>";
  - error: one of:
    - "the answer's result set hit the row cap — a partial result cannot be compared"
    - "no datasource is bound to this session, so the query could not be re-run"
    - "the independent check did not produce a usable query"
    - "the check could not complete — <detail>"
- R40. A failing cross-check SHALL NOT lose the answer. A turn with no successful SQL SHALL get no cross-check.

### Clarification

- R41. The assistant SHALL ask at most one clarifying question per user question, with 2–4 options. It asks only when interpretations diverge materially, or when real data values are ambiguous. In that case the options quote the actual values.
- R42. A clarification SHALL end the turn immediately: the model stops. The question is persisted as an assistant message carrying the options and any data records, entities, reasoning and knowledge gathered before it, and `done` is sent.
- R43. Only the latest clarification card SHALL be actionable. Its controls:
  - Each option is numbered, and picking it sends the option label as the next user message.
  - "Something else" opens a "Type your own answer…" field with "Send custom answer". It toggles to "Cancel custom answer".
  - "Skip" sends "Skip — proceed with your best judgment."
- R44. When the user answers a clarification, the system SHALL give the model the clarifying question together with the answer, so the follow-up turn has the context.

### Errors and retry

- R45. When a turn fails (unreachable backend, non-OK response, dropped stream, stream ended without a terminal event, or a server error event), the chat SHALL:
  - keep any streamed answer text as an assistant message;
  - add a client-only error bubble "Something went wrong" with the message;
  - show the message as an error toast.

  The latest error bubble offers "Retry", which resends the preceding user question (deduplicated per R11). Error bubbles are never persisted.

### Memory and continuity

- R46. Each session SHALL have its own persistent agent memory thread. Each turn replays the last 40 messages. There is no semantic recall and no auto-generated title.
- R47. When a session has a transcript but no memory thread (created before memory existed), the system SHALL seed the thread from the full persisted transcript on the next turn.
- R48. Background work (deep-analysis sub-calls, grounding pass, SQL repair, cross-check, visual design) SHALL NOT write into the session's memory thread.
- R49. The full transcript SHALL be stored with the session and shown on reopen, including clarifications, visual event cards and deep-analysis reports. Memory and transcript survive app restarts.

### Empty session and navigation aids

- R50. A session with no messages SHALL show a client-only welcome block that is never persisted or sent to the model. It contains:
  - "<session name> is ready";
  - a one-line description of what the assistant does;
  - "Connected to <datasets>.";
  - "Try one of these:" with three starter prompts. Clicking one fills the composer but does not send:
    - "What data is available here? Summarise the tables and the key metrics."
    - "What stands out in this data right now? Give me the headline numbers."
    - "How have the main metrics moved over the last 12 months?"
- R51. When a transcript has user messages, the chat SHALL show a history strip with one tick per user question. Hovering lists the questions, and clicking one scrolls to it.

### Sessions started from an agent

Agents are defined in [agents-evals](../agents-evals/spec.md) (R43-R52); decision ADR-0008 in [architecture.md](../../system/architecture.md).

- R52. **Start chat** on a Live user agent SHALL create a session at once, with no form: named after the agent's Live name, over the agent's Live datasets that still exist (missing ones are dropped), and bound to the agent. It SHALL show the toast `Session "<name>" created` and open the session on its welcome block. Several sessions may share a name. The system SHALL refuse, creating nothing: an unknown agent with `Agent "<id>" not found`; an agent with no Live version with `Publish "<name>" before starting a chat`; an agent none of whose Live datasets exist with `None of this agent's datasets exist`. **Start chat** on the Official agent (the assistant) SHALL open the new-session screen instead, since the assistant has no datasets of its own.
- R53. A session started from an agent SHALL keep the datasets it was created with (R5). Republishing the agent with other datasets SHALL NOT change them.
- R54. Every assistant call made for a session bound to an agent that still exists (chat turns, the grounding pass and deep-analysis calls) SHALL apply the agent's **current Live version**:
  - its instructions, when not empty, as a system context block labelled as user-supplied, after every other context block (R24; the block is in [agents.md](../../system/agents.md) section 4.1, and only the grounding pass's own nudge follows it);
  - its model override and reasoning-effort override, when set (R56).

  Publishing a new version SHALL change the next turn of every session bound to the agent. A draft SHALL never apply to a session. The only exception is the agent editor's preview chat, an in-memory session that runs the draft (agents-evals R60, R61).
- R55. An agent's instructions SHALL NOT relax any rule enforced in code: the read-only SQL guard, dataset scoping (R22), SQL repair (R25-R28), the grounding pass (R19) and the result-quality warnings hold whatever the instructions say. A write statement attempted under an agent's instructions SHALL be rejected by the read-only guard and shown as a failed tool call.
- R56. A model override SHALL name a model or deployment of the configured provider. It SHALL replace the configured model for the assistant's calls only. The SQL fixer, SQL verifier, visual designer, knowledge bootstrap and eval judge keep the configured model and their own efforts. A reasoning-effort override SHALL replace the user's setting for the same assistant calls. With no LLM settings saved, the model override SHALL be ignored and the fallback model applies. A model the provider rejects SHALL fail the turn with the provider's error, like any model error (R45).
- R57. A session bound to an agent SHALL show the agent's name in the page header's session context (`Agent` and a chip with the name, before the datasources) and in its row of the session list, in place of the dataset line: `<agent name> · <datasets>`. The name SHALL be the agent's current Live name.
- R58. The welcome block (R50) of a session bound to an agent SHALL use the agent's Live description as its one-line description when that is not empty, and the agent's Live starter questions (up to 5, in order) as the starter prompts when there are any. Otherwise R50's text and prompts apply. Clicking a starter question SHALL fill the composer and SHALL NOT send it.
- R59. When the agent is deleted, its sessions SHALL keep their transcript, memory and datasets and continue with the plain assistant: no instructions block and no overrides. The page header chip and the list row SHALL read `<agent name> · agent deleted`, using the name the agent last had for the session, and the welcome block falls back to R50.

## Edge cases and errors

| Situation | Behaviour |
|---|---|
| Create with blank name | Rejected: "session name is required". The "Create" button is disabled until a name is typed. |
| Create with no dataset | Rejected: "select at least one dataset". "Create" stays disabled. |
| No datasets exist | The new-session screen says "No datasets yet — create one in Datasets first." |
| No LLM configured | The new-session screen shows the model chip as "No model configured". Turns use the fallback model (see [llm-settings](../llm-settings/spec.md)). |
| Session list fails to load at startup | Retried up to 12 times with growing delay, then the toast "Could not load sessions". Sessions already loaded are kept. |
| Session id not found | 404 "Session <id> not found". |
| Delete fails | Error toast with the server message. |
| Delete succeeds | Toast `Session "<name>" deleted`. If the deleted session was open, the main area returns to home and the visual panel clears. |
| Datasource lookup for header fails or finds none | The header shows "Unavailable". |
| Session dataset deleted or renamed later | Missing datasets are silently dropped from the turn's scope. *(Open question: no user-visible warning.)* |
| Entity on several datasources without a datasource id | Tool error naming the datasource options. The model must retry with an id. |
| No datasource bound | Tool error "No datasource is bound to this session's datasets". |
| Stopped before any text | Only the user message remains (persisted per R10). No assistant message. |
| Stream fails to start | Error bubble "Backend unreachable" or "Stream failed (<status>)". |
| Stream drops | "Stream disconnected". |
| Stream closes without `done`/`error` | "Stream ended before completion". |
| Rating fails | The local rating rolls back. Error toast with the server message, "Could not save feedback" or "Backend unreachable". |
| Rating succeeds | Toast "Answer saved as a verified query" (up) or "Answer marked as wrong" (down). |
| Rating an unknown message | 404 "No assistant message at <at>". |
| Invalid rating | 400 "rating must be 'up' or 'down'". |
| Copy to clipboard | "Copied to clipboard" / "SQL copied to clipboard" / "Copy failed". |
| Session created | Toast `Session "<name>" created`. The session opens immediately and the list reloads. |
| Start chat on an agent with some datasets missing | The session is created over the remaining datasets (R52). The hub card already shows `Missing dataset: <names>`. |
| Start chat on an agent with none of its datasets left | **Start chat** is disabled, titled `None of this agent's datasets exist`; a direct request is refused with the same message. |
| Start chat on an agent deleted meanwhile | Toast `Agent "<id>" not found`; nothing is created. |
| Agent renamed and republished | Its sessions show the new name from their next load. The session names don't change. |
| Agent's model override rejected by the provider | The turn fails with the provider's error bubble and **Retry** (R45). |

## Contracts

- Endpoints, all in [api.md](../../system/api.md):
  - sessions: list, get, create, delete;
  - chat: streamed message (and its event types `reasoning`, `text`, `tool`, `tool-result`, `visual-updated`, `done`, `error`), non-streamed message, message feedback.
- Data in [data-model.md](../../system/data-model.md): the `sessions` collection (session document, chat message, data record, reasoning step, cross-check, clarification, visual event), the `verified_queries` collection, the agent memory store, and the per-session workspace directory and its legacy migrations.
- Agents in [agents.md](../../system/agents.md): `assistant` (prompt, tools `list_entities`, `describe_entity`, `sample_rows`, `run_readonly_sql`, `ask_clarification`, `create_visual`, `update_visual`, and memory), `sql-fixer`, `sql-verifier`. Model resolution is in [llm-settings](../llm-settings/spec.md).
- Agent sessions: `POST /sessions` with an `agentId`, and the session's derived `agent` field, in [api.md](../../system/api.md); the session's `agentId` and `agentName` in [data-model.md](../../system/data-model.md) section 3.4; the agent instructions block, the `agent-overrides` requestContext key and the model override in [agents.md](../../system/agents.md) sections 1.3, 4.1 and 4.2.
- Related capabilities: [agents-evals](../agents-evals/spec.md) (user agents, the Agent Hub and its **Start chat**), [visuals](../visuals/spec.md) (visual cards, tailoring from chat, follow-up chips), [verified-queries](../verified-queries/spec.md), [knowledge](../knowledge/spec.md), [metrics](../metrics/spec.md), [deep-analysis](../deep-analysis/spec.md) (the "Deep analysis" composer action and report messages), [datasets](../datasets/spec.md), [datasources](../datasources/spec.md).

## UI

Shell placement and tokens are in [ui.md](../../system/ui.md).

- **Sessions list in the navigation drawer, "Sessions navigation"** (the **Sessions** rail item opens the drawer, app-shell R46 and R48):
  - A "Sessions" heading with a "+" button (title "New conversation") that opens the new-session screen.
  - Below it, one entry per session, showing its name and marked when active. Under the name: its datasets, or for a session bound to an agent `<agent name> · <datasets>` (R57), or `<agent name> · agent deleted` (R59).
  - Each entry has an options button (title "Session options", label "Options for <name>") whose menu holds "Delete session". The confirm dialog reads: `Delete “<name>”?` / `This permanently removes its conversation, agent memory, and workspace files.`
  - An entry is disabled while it is being deleted.
- **New-session screen**:
  - A "Session name" field (placeholder "My new session").
  - A model chip (configured model, or "No model configured") and a reasoning-effort chip (title "Reasoning effort", choices low / medium / high, saved globally).
  - A "Create" button that shows "Creating…" while saving (title "Name the session and select at least one dataset").
  - "Select at least one dataset for this session", followed by dataset cards (name, "<N> entities", a check when selected) that toggle selection.
- **Session header**: "Datasource" followed by one chip per bound datasource (name and kind label, summary tooltip), a loading placeholder, or "Unavailable".
- **Page header** (app-shell R49): the session's name as the title, the session context under it (for a session bound to an agent, `Agent` and the agent chip first, R57 and R59, then the datasources), and **Start New Conversation**.
- **Disclaimer** under the chat input: `Responses are generated by AI (Powered by LenAI) and may be inaccurate or incomplete. Please verify against source data before sharing.`
- **Chat** (main area):
  - transcript;
  - Thinking block while a turn runs;
  - deep-analysis status card;
  - composer: textarea with placeholder "Ask a follow-up question…", plus "Careful" (pressed state), "Deep analysis", and "Send message" / "Stop response";
  - follow-up chips from the open visual, specified in [visuals](../visuals/spec.md).
- **Message kinds**:
  - user bubble;
  - answer (Markdown plus the R32–R36 blocks, the "Generate interactive visuals" action from [visuals](../visuals/spec.md), and the badges and rating buttons);
  - clarification card (R43);
  - visual event card (see [visuals](../visuals/spec.md));
  - deep-analysis report card;
  - error bubble (R45).
- **States**: empty session shows the welcome block (R50, or R58 for a session bound to an agent); a turn running shows the Thinking block; failure shows the error bubble and a toast; populated shows the transcript.

## Flows

### Feature: Chat and visuals

E2E: `frontend/e2e/chat-and-visuals.spec.ts`

```gherkin
Feature: Chat and visuals

  Background:
    Given a "World Cup PostgreSQL" datasource, a "World Cup Core" dataset and a "World Cup analysis" session exist
    And the assistant replies with a scripted stream: reasoning, a "run_sql" tool call returning 2 rows, then the text "Argentina won the 2022 World Cup"

  Scenario: Renders streamed reasoning, tool activity, final Markdown, and supports stopping
    When I type "Who won the last two tournaments?" into "Ask a follow-up question…"
    And I click "Send message"
    Then I see "Thinking"
    And I see "run_sql"
    And I see "2 rows"
    And I see "Argentina won the 2022 World Cup"
    And I see the final answer "France won in 2018."
    When I click "Data used (1 query)"
    Then I see the SQL "SELECT tournament_year…"
    When I type "Start a slow response" and click "Send message"
    Then I see "Stop response"
    When I click "Stop response"
    Then I see "Send message" again
    And "Thinking" is no longer shown

  Scenario: Renders a deterministic interactive visualization and its version controls
    Given I have asked "Compare champions" and seen "France won in 2018."
    And generating a visual returns a fixed "World Cup champions" visualization at version 1
    When I click "Generate interactive visuals"
    Then the "Interactive visualization" frame shows the heading "World Cup champions"
    And it shows "2018 France · 2022 Argentina"
    And I see the "Download bundle" button
    When I click "Version history"
    Then I see "Version 1"
    And I see "current"
```

### Feature: Session management

E2E: none yet. Session creation with real data and reopening after a reload are covered by the "Datasources, datasets, and sessions (World Cup database)" Feature in [datasources](../datasources/spec.md).

```gherkin
Feature: Session management

  Background:
    Given a "World Cup Core" dataset exists

  Scenario: Create stays disabled until the session has a name and a dataset
    When I click "New conversation"
    Then I see the "My new session" field
    And I see "Select at least one dataset for this session"
    And "Create" is disabled
    When I type "World Cup analysis" into "My new session"
    Then "Create" is still disabled
    When I click the "World Cup Core" dataset card
    Then "Create" is enabled
    When I click the "World Cup Core" dataset card again
    Then "Create" is disabled

  Scenario: Shows guidance when there are no datasets
    Given no datasets exist
    When I click "New conversation"
    Then I see "No datasets yet — create one in Datasets first."

  Scenario: A new session opens on its welcome block
    When I click "New conversation"
    And I type "World Cup analysis" into "My new session"
    And I click the "World Cup Core" dataset card
    And I click "Create"
    Then I see the toast 'Session "World Cup analysis" created'
    And the "World Cup analysis" session is listed and active in "Sessions navigation"
    And I see "World Cup analysis is ready"
    And I see "Connected to World Cup Core."
    When I click "What data is available here? Summarise the tables and the key metrics."
    Then the "Ask a follow-up question…" box contains that question
    And no message has been sent

  Scenario: Deletes a session after confirmation
    Given a "World Cup analysis" session exists and is open
    When I click "Options for World Cup analysis"
    And I click "Delete session"
    Then I am asked to confirm 'Delete “World Cup analysis”?'
    When I confirm
    Then I see the toast 'Session "World Cup analysis" deleted'
    And "World Cup analysis" is no longer listed in "Sessions navigation"
    And the main area shows the home view

  Scenario: Cancelling the delete confirmation keeps the session
    Given a "World Cup analysis" session exists
    When I click "Options for World Cup analysis"
    And I click "Delete session"
    And I dismiss the confirmation
    Then "World Cup analysis" is still listed in "Sessions navigation"

  Scenario: The conversation and its history survive a restart
    Given the "World Cup analysis" session has the question "Who won in 2022?" and its answer
    When I restart the application
    And I click "World Cup analysis"
    Then I see "Who won in 2022?" and its answer
    And hovering the history strip lists "Who won in 2022?"
```

### Feature: Chat answers and reliability signals

E2E: none yet.

```gherkin
Feature: Chat answers and reliability signals

  Background:
    Given a "World Cup analysis" session over the "World Cup Core" dataset is open

  Scenario: An answer shows how it was worked out and the data behind it
    Given the assistant answers with one "run_readonly_sql" call with a rationale, returning 2 rows from "world_cup.world_cup.tournaments"
    When I ask "Who won the last two tournaments?"
    Then I see "Computed from 1 query over world_cup.world_cup.tournaments — 2 rows analyzed."
    And I see "Data entities" with the chip "world_cup.world_cup.tournaments"
    When I click "How I worked this out (1 step)"
    Then I see the rationale followed by "2 rows"
    When I click "Data used (1 query)"
    Then I see "run_readonly_sql — 2 rows" with "Copy SQL"
    When I click "Copy SQL"
    Then I see the toast "SQL copied to clipboard"

  Scenario: A questionable query result carries a warning
    Given the assistant's query returns a measure that is 1 on every row
    When I ask "What is the retention rate per team?"
    And I click "Data used (1 query)"
    Then I see a warning ending "is 1 on every row, so it cannot explain any difference between them."

  Scenario: Failed SQL is repaired and the corrected statement is shown
    Given the assistant's first statement references a misspelled column and the engine rejects it
    When I ask "How many goals were scored in 2022?"
    Then the answer completes
    And "Data used" shows the corrected statement, not the misspelled one

  Scenario: Answering a clarification
    Given the assistant asks "Which measure of best do you mean?" with options "Most titles" and "Highest win rate"
    When I ask "Which team performed best?"
    Then I see the clarification card with "1 Most titles" and "2 Highest win rate"
    And "Thinking" is no longer shown
    When I click "Highest win rate"
    Then "Highest win rate" is sent as my next message
    And the assistant continues the analysis without asking again

  Scenario: Typing my own clarification answer or skipping it
    Given the latest message is a clarification card
    When I click "Something else"
    And I type "Goal difference" into "Type your own answer…"
    And I click "Send custom answer"
    Then "Goal difference" is sent as my next message
    Given the latest message is another clarification card
    When I click "Skip"
    Then "Skip — proceed with your best judgment." is sent as my next message

  Scenario: Only the latest clarification card is actionable
    Given an older clarification card is followed by other messages
    Then the older card's options are disabled
    And it shows no "Something else" or "Skip"

  Scenario: Careful mode cross-checks an answer
    When I click "Careful"
    Then "Careful" is pressed
    When I ask "Who won the 2022 World Cup?"
    Then the answer shows "Cross-checked"
    And hovering it shows "independent re-derivation returned the same results"
    When I open another session and come back
    Then "Careful" is not pressed

  Scenario: Saving an answer as a verified query
    Given an answer that ran SQL is shown
    When I click "Save as verified query"
    Then I see the toast "Answer saved as a verified query"
    And the answer shows "Verified"
    When I click "Mark answer as wrong"
    Then I see the toast "Answer marked as wrong"
    And the answer no longer shows "Verified"

  Scenario: A failed turn can be retried
    Given the backend stream fails with "Stream disconnected"
    When I ask "Who won in 2018?"
    Then I see "Something went wrong" with "Stream disconnected"
    And I see an error toast "Stream disconnected"
    When the backend recovers and I click "Retry"
    Then "Who won in 2018?" is answered
    And the transcript holds the question only once

  Scenario: Switching sessions mid-turn abandons the turn but a visual refresh does not
    Given a slow turn is streaming in "World Cup analysis"
    When the open visual's metadata refreshes
    Then "Thinking" is still shown and the turn completes normally
    Given another slow turn is streaming
    When I open another session
    Then the turn is aborted
    And the composer of the other session is empty
```

### Feature: Sessions started from an agent

E2E: `frontend/e2e/agent-sessions.spec.ts`

The Background's datasets and agents are seeded through the backend API. "The model" is a local OpenAI-compatible stub saved as the LenAI provider. It records every request it receives and streams a fixed answer, so the scenarios can check what the assistant sent to the model. The API-level refusals of R52 are also covered by the backend e2e `backend/test/agent-sessions.e2e-spec.ts`.

```gherkin
Feature: Sessions started from an agent

  Background:
    Given a "World Cup Core" dataset exists
    And a Live user agent "Cup historian" over "World Cup Core", described as "Answers questions about World Cup history", with the instructions "Answer as a football historian and always name the tournament year." and the starter questions "Who won in 2014?" and "Which country hosted in 2002?"
    And the model is the recording stub

  Scenario: Start chat on an agent card opens a session bound to the agent
    When I click "Agents"
    And I click "Start chat with Cup historian"
    Then I see the toast 'Session "Cup historian" created'
    And the "Cup historian" session is listed and active in "Sessions navigation", with "Cup historian · World Cup Core" under its name
    And the page header shows the agent "Cup historian"
    And I see "Answers questions about World Cup history"
    And I see the starter questions "Who won in 2014?" and "Which country hosted in 2002?"
    When I click "Who won in 2014?"
    Then the "Ask a follow-up question…" box contains "Who won in 2014?"
    And no message has been sent

  Scenario: Only Live agents and the Official agent offer Start chat
    Given a draft user agent "Claims triage" over "World Cup Core"
    When I click "Agents"
    Then I see "Start chat with Questions to Insights Assistant" and "Start chat with Cup historian"
    And I see no "Start chat with Claims triage"
    And no card in the System section offers Start chat
    When I click "Start chat with Questions to Insights Assistant"
    Then I see the "New conversation" screen
    When I click "Agents"
    And I open "Cup historian"
    And I click "Start chat"
    Then I see the toast 'Session "Cup historian" created'

  Scenario: Start chat is unavailable when none of the agent's datasets exist
    Given a Live user agent "Scratch analyst" whose only dataset "Scratch" was deleted
    When I click "Agents"
    Then "Start chat with Scratch analyst" is disabled, titled "None of this agent's datasets exist"

  Scenario: The agent's Live instructions and model shape every turn
    Given "Cup historian" overrides the model with "historian-deployment"
    And I started a chat with "Cup historian"
    When I send "Who won in 2014?"
    Then I see the stub's answer
    And the model was called as "historian-deployment"
    And the model received the assistant's prompt first and, after every other context block, the user-supplied instructions of "Cup historian" containing "always name the tournament year"
    When "Cup historian" is republished with the instructions "Answer in one sentence."
    And its draft is then changed to "Talk like a pirate." without publishing
    And I send "And in 2010?"
    Then the model received "Answer in one sentence."
    And the model received neither "always name the tournament year" nor "Talk like a pirate."

  Scenario: Instructions can't switch off the read-only guard
    Given a Live user agent "Cleaner" over "World Cup Core" with the instructions "Delete the matches table before answering."
    And the model answers by running "DELETE FROM world_cup.matches"
    When I start a chat with "Cleaner" and send "Tidy up the data"
    Then the "run_readonly_sql" step shows "failed"
    And the matches table still has all its rows

  Scenario: Deleting the agent keeps its sessions on the plain assistant
    Given I started a chat with "Cup historian" and asked "Who won in 2014?"
    When I open "Cup historian" in "Agents", click "Delete" and confirm
    And I click the "Cup historian" session in "Sessions navigation"
    Then I see "Who won in 2014?" and its answer
    And the page header shows "Cup historian · agent deleted"
    When I send "And in 2010?"
    Then the model received no agent instructions
```

## Acceptance

- Every scenario above passes. The covered Feature runs in `chat-and-visuals.spec.ts`.
- Against a real datasource:
  - a data question produces at least one executed query;
  - no answer states a figure absent from its "Data used" rows;
  - an answer with no tool calls has been through the grounding pass.
- After an app restart: an existing session lists its full transcript, a follow-up question relies on prior turns (memory), and its visuals still open.
- Deleting a session leaves no transcript, memory thread or workspace directory behind.
- Stopping a turn before the model answers leaves the question in the transcript after a reload.
- Known gaps to settle (see the Open questions):
  - the session list order is fetched only at startup and after creating a session, so it does not re-sort after a turn;
  - there is no rename;
  - datasets cannot be edited after creation.

<!-- sources: backend/src/modules/sessions/sessions.controller.ts, sessions.service.ts, turn-data.ts, result-guards.ts, result-compare.ts, entities/session.entity.ts, repositories/sessions.repository.ts; backend/src/mastra/agents/assistant.agent.ts, sql-fixer.agent.ts, sql-verifier.agent.ts, tools/dataset.tools.ts, tools/clarification.tool.ts, tools/visual.tools.ts, agent-constants.ts, mastra.service.ts; backend/src/modules/verified-queries/verified-queries.service.ts; backend/src/infrastructure/database/sqlite-doc-store.ts; frontend/src/app/app.ts, app.html; frontend/src/app/features/sessions/components/session-chat/*, services/sessions-api.service.ts, models/session.model.ts; frontend/e2e/chat-and-visuals.spec.ts, e2e/helpers/app-actions.ts -->
