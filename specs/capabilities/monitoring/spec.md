# Monitoring

The **Monitoring** area shows every LLM call the app's agents make, so a person can spot the slow, failing or expensive ones without a developer tool. It also shows what the agents did across a whole session. It has two tabs and two detail pages. The **LLM calls** tab is a filterable, paged table of calls, newest first. A **call page** opens from a row and shows the call's facts, what filled its **context window** (seven boxes, each tagged by who owns it, with an estimated size and the exact text), and the model steps of the run. The **Sessions** tab is a filterable, paged table of sessions, most recent first. A **session page** opens from a row and shows the **session flow**: each question with the path the agent took (model requests and tool calls, in order), its answer, and, on demand, a **waterfall** of the turn's timeline.

The app records nothing of its own for this. It reads the trace store the agent framework already writes (ADR-0038). The area is read-only: it edits no prices, deletes and exports no calls, and sends nothing anywhere.

## Concepts

Defined in [../../product/glossary.md](../../product/glossary.md): LLM call, context window box, session, session flow, waterfall, framework span, dataset, agent, assistant.

Capability-local vocabulary is limited to the UI words "LLM calls", "Sessions", "Clear filters", "Context window", "Steps", "Show text", "Hide text", "Open call", "Open timeline", "Hide timeline", "Show more" and "Show framework spans".

A **turn** is one question of a session and the agent's work to answer it. In the trace store a turn is one trace (`traceId`), and the session is the `threadId` its agent run carries ([../../system/data-model.md](../../system/data-model.md) 1.2).

## Rules

The table
- R1. The system SHALL list **LLM calls**: one row per model call of one agent run, read from the trace store `observability.duckdb` ([../../system/data-model.md](../../system/data-model.md) 1.2, ADR-0038). Calls recorded before this feature existed are listed too. A model call the agent framework does not trace is not listed.
- R2. Rows SHALL be ordered by start time, newest first.
- R3. Each row SHALL show: **Started** (local date and time), **Agent** (its display name), **Model** (with its provider below it, muted), **Session** (its name; when the session has no name, the first 8 characters of its id; a dash when the call belongs to no session), **Tokens in / out** (for example `61,185 / 2,445`; the input count includes cache reads and writes), **Duration** (for example `17.3 s`), **Cost** (for example `$0.0213`) and **Status**. A value the trace does not hold is shown as a dash.
- R4. **Status** SHALL be **Succeeded**, **Failed** or **Running**. A call with no end recorded yet is Running. A call whose end carries an error is Failed. Any other call is Succeeded.
- R5. **Cost** SHALL be an estimate computed from a price table shipped with the app: USD per million tokens for input, output and cache reads, as of 2026-11-03. Cache writes are priced at 1.25 times the input price. The cost is the uncached input tokens at the input price, plus the cache reads at the cache-read price, plus the cache writes at the cache-write price, plus the output tokens at the output price. A model is matched by its exact id or an id that starts with a table key followed by `-`, and the longest key wins. A model not in the table has no cost, shown as a dash, and no context limit. The table is code, not a setting, and the user cannot edit it.

Filters
- R6. The page SHALL offer these filters: **Agent**, **Model**, **Provider**, **Status** (Any status, Succeeded, Failed, Running), **Session** and **Date**. Their choices SHALL be the values present among all calls, sorted by name, and SHALL NOT shrink as other filters are set. A session without a name is offered by the first 8 characters of its id.
- R7. **Date** SHALL offer Any time, Last hour, Last 24 hours, Last 7 days and Custom. Custom SHALL show a **From** and a **To** date-time input. A call is kept when its start time is inside the range, ends included.
- R8. Filters SHALL combine (a call must match all of them) and SHALL be applied on the server before paging, so the total counts only matching calls.
- R9. Changing any filter or the page size SHALL return to page 1. **Clear filters** SHALL reset every filter and SHALL be disabled when no filter is set.

Paging
- R10. The table SHALL show 25 rows per page by default. A **Rows per page** choice SHALL offer 25, 50 and 100. The footer SHALL show the range and total, for example `1–25 of 132`, and **Previous** and **Next**, disabled on the first and last page.
- R11. The system SHALL reject a page that is not a positive whole number (`Page must be a positive whole number`), a page size other than 25, 50 or 100 (`Page size must be 25, 50 or 100`), a status other than `succeeded`, `failed` or `running` (`Status must be succeeded, failed or running`), and a From or To that is not a date (`From is not a valid date`, `To is not a valid date`), with HTTP 400.

States
- R12. With no calls at all, the page SHALL show "No LLM calls yet.". With calls but none matching the filters, it SHALL show "No LLM calls match these filters.". A data dir whose trace store does not exist yet SHALL show the first message, not an error. While loading the page SHALL show a loading state, and a failed load SHALL show an inline error (`role="alert"`).

The call page
- R13. Clicking a row, or pressing Enter on it, SHALL open that call's page. **Monitoring** SHALL stay the current rail item. A **Monitoring** back control above the page, and choosing **Monitoring** on the rail, SHALL return to the table with its filters, page and page size as they were left.
- R14. The call page SHALL show a heading with the agent's name (or "Model call" when the call has no agent) and the model, and these facts: **Started**, **Duration**, **Time to first token**, **Status**, **Session** (a link that opens the session's chat when the session has a name), **Provider**, **Finish reason**, **Tokens in** (with the cache reads and cache writes), **Tokens out** (with the reasoning tokens) and **Estimated cost**. A fact the trace does not hold is a dash.
- R15. A failed call SHALL show its error message in a highlighted box. A running call SHALL show Status Running and dashes for what is not known yet.
- R16. A call that does not exist SHALL fail with `LLM call not found` (HTTP 404), and the call page SHALL show that message.

The context window
- R17. The call page SHALL show a **Context window** section with a caption of the estimated tokens against the model's context limit, for example `≈ 17,647 tokens of 1,000,000 (1.8 %)`; without a known limit the caption is `≈ 17,647 tokens`. Below it a stacked bar SHALL show one coloured part per non-empty box, in order, with a legend and a tooltip `<Label>: ≈ <N> tokens (<P> %)`.
- R18. The section SHALL show seven boxes, always in this order and even when empty, each with its label, an owner chip, `≈ <N> tokens · <P> %` and the number of items:

  | # | Box | Owner |
  |---|---|---|
  | 1 | System prompt | US Health |
  | 2 | Skill injection | US Health |
  | 3 | Tools injection | US Health |
  | 4 | Chat history | Custom |
  | 5 | Dataset | Custom |
  | 6 | User prompt | Custom |
  | 7 | Tool calls and results | Custom |

  **US Health** marks what the app ships and controls. **Custom** marks what comes from the user's data and conversation.
- R19. Each box SHALL have a **Show text** control that reveals the exact text of each of its items, with a title, in a monospace block that wraps and scrolls; the control then reads **Hide text**. A box with no items SHALL show "Nothing in this call." instead.
- R20. The text SHALL be sorted into the boxes from what was recorded for the call:
  - **System prompt**: the agent's own system message (the first system message) and any other system message that is neither a skills message nor one of the per-turn context blocks, for example the workspace message.
  - **Skill injection**: the system messages that list the available skills or say that skills are not tools, plus the input and output of each call to the skill tools (`skill`, `skill_read`) in this run.
  - **Tools injection**: one item per tool definition sent to the model (its name, description and JSON parameters).
  - **Chat history**: every message of the call's input that is not a system message and comes before the last user message, including the earlier tool calls and results; reasoning signatures are left out.
  - **Dataset**: the per-turn context blocks, which are the system messages after the first one: the session's datasets, metrics, curated knowledge, persona and the like ([../../system/agents.md](../../system/agents.md) 4.1).
  - **User prompt**: the text of the last user message.
  - **Tool calls and results**: one item per tool call of this run other than the skill tools, titled by the tool name, holding its arguments and its result.
- R21. Box sizes SHALL be estimates. Each box's tokens are its characters divided by 4. When the real input tokens of the run's largest request (its last step) are known, the seven estimates SHALL be scaled so that they add up to that number, with the rounding remainder added to the largest box. Each box's share is its tokens over the total. The UI SHALL mark every box size with "≈". Only the total is a real count.
- R22. The context window SHALL be built only from what the trace holds. A call whose messages were not recorded SHALL show its facts and empty boxes, not an error.

Steps
- R23. The call page SHALL show a **Steps** table, one row per model request of the run: step number, tokens in, tokens out, finish reason and duration.

General
- R24. The area is read-only. Nothing the user does here changes a call, an agent, a session or a price. Viewing a call page SHALL NOT start any model call.
- R25. The Monitoring page SHALL work in the light and dark themes, and its controls SHALL have accessible names (each filter, the table, the row buttons, the paging controls and the box toggles).

Tabs
- R26. The Monitoring page SHALL show two tabs under its heading, **LLM calls** and **Sessions** (`role="tablist"`, the arrow keys move between them). **LLM calls** is chosen when the page opens for the first time. The note under the heading follows the tab: "LLM calls made by the app's agents, newest first." or "Sessions with recorded agent runs, most recent first.". The chosen tab, and each tab's own filters, page and page size, SHALL be kept while the app runs, so leaving to a call page or a session page and coming back finds them as they were left.

The Sessions table
- R27. The **Sessions** tab SHALL list **sessions**: one row per session that has at least one recorded agent run, read from the trace store (ADR-0038). A session is a distinct `threadId` on the agent runs. Rows SHALL be ordered by last activity, newest first. A session whose chat was deleted, or that was a preview or an eval, is listed too.
- R28. Each row SHALL show: **Session** (its name, read from the sessions collection; "Unnamed session" with the first 8 characters of its id, muted, when it has no name), **Agent** (the display names of the agents that ran in it), **Turns**, **Last activity** (local date and time), **Wall time** (the sum of the turns' durations), **Model time** (the sum of the model calls' durations), **Tools** (the number of tool calls), **Tokens in / out**, **Cost** (the sum of the estimated costs, R5) and **Status**. A value the trace does not hold is shown as a dash.
- R29. A session's **Status** SHALL be **Failed** when it has at least one failed span (an agent run, a model call or a tool call that ended with an error or `success: false`), else **Running** when a turn has no end recorded yet, else **Succeeded**. The row's error count SHALL equal the number of those failed spans.
- R30. The tab SHALL offer the filters **Agent** (sessions in which that agent ran) and **Date** (Any time, Last hour, Last 24 hours, Last 7 days, Custom with **From** and **To**; a session is kept when one of its turns started inside the range, ends included), and **Clear filters**. Agent choices SHALL be the agents present among all sessions and SHALL NOT shrink as the date is set. R8 and R9 apply to these filters, and R10 and R11 to the paging, with the same page sizes and messages.
- R31. With no sessions at all, the tab SHALL show "No sessions yet.". With sessions but none matching the filters, it SHALL show "No sessions match these filters.". Loading and failed loads behave as in R12. Clicking a row, or pressing Enter on it, SHALL open that session's page, and **Monitoring** SHALL stay the current rail item.

The session page
- R32. The session page SHALL show a heading with the session's name ("Unnamed session" when it has none), a totals strip (**Turns**, **Wall time**, **Model time**, **Tool calls**, **Tokens**, **Cost**, **Errors**) and, when the session still exists as a chat, an **Open chat** link that opens it. Then it SHALL show the session's turns in the order they started.
- R33. Each turn SHALL show, in this order: the question as a bubble on the right; a meta line (`Turn n`, its duration, the number of model requests, the number of tool calls, tokens, cost and, when the turn did not succeed, a status chip); the **path**; the answer as a bubble on the left; and, when the turn failed, its error in a highlighted box. The question is the last user message of the turn's first model call, and the answer is the text of the last finished request of the turn's last finished model call (the call's own output joins the commentary of every request, so it is used only when the requests hold no text), cut to 4,000 characters. A question or answer the trace does not hold is shown as a dash.
- R34. The **path** SHALL list, in time order across all the model calls of the turn, **steps**. A **model step** shows "Model", its duration, its tokens in and out, its finish reason (muted) and an **Open call** link that opens that call's page (R14), and under them, on one muted truncated line, what that request said (its text with whitespace collapsed, cut to 200 characters; the full text as the tooltip; nothing when it said nothing). A **tools step** holds the tool calls that ran between two model steps, grouped by tool name: each group shows "<name> ×<count>" (no count for one call), the summed duration, a short summary of the input (for `describe_entity` the entity, for `run_readonly_sql` the first 80 characters of the SQL on one line, otherwise the first text value), the row count when the result reports one, and a failed mark when any call of the group failed.
- R35. A long answer SHALL be cut to 6 lines with a **Show more** control that reveals the rest, and **Show less** folds it again. Line breaks in the answer SHALL be kept.
- R36. A session that does not exist in the trace store SHALL fail with `Session not found` (HTTP 404), and the session page SHALL show that message. A session page SHALL work for a session with a running turn: its duration is a dash and its status is Running.

The waterfall
- R37. Each turn SHALL have an **Open timeline** button, which becomes **Hide timeline** while the waterfall is shown inline under the turn's meta line (`aria-expanded` tells which). The waterfall SHALL be loaded when it is first opened, not with the page.
- R38. The waterfall SHALL show one row per span of the turn, depth first and children by start time, each with: the label indented by depth, a colour dot for its kind, a bar on a track and its duration. Bars SHALL be drawn to scale from the span's start offset and duration against the turn's total, with a small minimum width so a very short span stays visible. A span still running SHALL show a bar to the end of the turn, marked as running. An axis above the rows SHALL show five ticks in seconds: 0, a quarter, a half, three quarters and the total.
- R39. Span kinds SHALL be: **Agent** (the agent run), **Model** (a model call), **Request** (one model request, a step of a model call), **Tool** (a tool call), **Memory** (a memory operation, labelled "memory · recall" or "memory · save") and **Framework** (a **framework span**: skill actions, processor runs, workspace actions and the model inference that repeats its request). Any other span is shown with its own name. A legend SHALL name the kinds.
- R40. Framework spans SHALL be hidden by default. A switch **Show framework spans** SHALL show them and, while off, show how many are hidden, for example "(14 hidden)". A hidden span's children SHALL move up under its nearest shown ancestor, so no row is lost and depth stays meaningful. Streaming chunks are never shown.
- R41. Selecting a row SHALL show a detail panel for that span: label, kind, start offset, duration, status and its details (for a model call or request: agent, model, tokens, cache, cost and finish reason; for a tool call: the input summary and the row count; the error when it failed), then its **Input** and **Output** in collapsible monospace blocks, each cut to 4,000 characters, for tool calls. The first model request is selected when the waterfall opens. A model call or request span SHALL offer **Open call**, which opens that call's page (R14).
- R42. The waterfall SHALL show a message when the turn's trace does not exist (`Trace not found`, HTTP 404) or cannot be read, inline (`role="alert"`). On a wide window the rows and the detail panel sit side by side; on a narrow one the panel goes under the rows. The rows area SHALL scroll sideways inside itself and SHALL NOT make the page scroll sideways.

Navigation
- R43. The back control of the call page SHALL return to where the call was opened. Opened from the table, it reads **Monitoring** and returns to the table (R13). Opened from a session page (an **Open call** link of a step or of the waterfall), it reads **Session** and returns to that session page, with its open timelines as they were left. The session page's own back control reads **Monitoring** and returns to the Sessions tab with its filters, page and page size as they were left. Choosing **Monitoring** on the rail from a call page or a session page SHALL return to the Monitoring page with the tab that was chosen.
- R44. Viewing a session page or a waterfall SHALL NOT start any model call and SHALL change nothing (R24).

Workflow runs
- R45. A workflow run's agent turn runs on a temporary host `run-<runId>` (ADR-0041, amending ADR-0038), so its calls carry that id as their thread. Monitoring SHALL treat such a thread like a session: it SHALL read the run `<runId>` from `workflow_runs` and name the thread `<workflow name>: <run title>` (the run's question, else its workflow's name, as the history titles it). The calls table (R3), the Session filter (R6), the call page (R14), the Sessions tab (R28) and the session page (R32) use that name. The call page's Session link for a run SHALL open the run's session page (its execution flow), not a chat, and the session page of a run SHALL show a **Run** chip instead of **Open chat**. A run that was deleted, or an unknown `run-` id, has no name and no link, like a deleted chat. Sessions already listed are unchanged.

## Edge cases and errors

- Fresh data dir, or a trace store with no table yet: "No LLM calls yet." (R12).
- A call of a run that was deleted: its session shows the short id of the host, with no link (R45).
- A call from a preview, an eval or a deleted session: its session shows a dash, and the Session filter still offers its id.
- A model with no price: Cost is a dash and the context caption has no limit (R5, R17).
- A call still running: Status Running, no duration, tokens and cost as far as known, and no end time (R4, R15).
- A call whose request failed: Status Failed and its error message on the call page (R15).
- A very long text in a box stays inside its scrolling block (R19).
- A filter set that matches nothing: "No LLM calls match these filters." with **Clear filters** enabled (R12, R9).
- The trace store is unreadable: the page shows an inline error and the rest of the app works.
- A session with a running turn: Status Running, its duration a dash, its waterfall bar for the running span runs to the end (R29, R36, R38).
- A turn that failed: a Failed chip on its meta line and its error in a highlighted box; the session is Failed (R29, R33).
- A turn with no tool calls: its path holds only model steps (R34).
- A session whose chat was deleted: "Unnamed session" with its short id, and no **Open chat** link (R28, R32).
- A very long answer: clamped to 6 lines with **Show more** (R35).
- A turn with only framework spans besides its agent run: the waterfall shows the agent row and "(N hidden)" (R40).

## Contracts

- Endpoints: `GET /monitoring/llm-calls`, `GET /monitoring/llm-calls/:id`, `GET /monitoring/sessions`, `GET /monitoring/sessions/:id` and `GET /monitoring/traces/:traceId`. See [../../system/api.md](../../system/api.md) (section 2.8c).
- Source data: the `span_events` table of `observability.duckdb`, read in-process, no new collection. See [../../system/data-model.md](../../system/data-model.md) (1.2).
- Decision: [../../system/architecture.md](../../system/architecture.md) ADR-0038.
- Related: [../app-shell/spec.md](../app-shell/spec.md) R3b (the rail item and the page), [../../system/agents.md](../../system/agents.md) 4.1 (the per-turn context blocks that fill the Dataset box), [../developer-settings/spec.md](../developer-settings/spec.md) (the opt-in trace viewers this area does not depend on).

## UI

Placement: the **Monitoring** item on the navigation rail opens the Monitoring page ([../app-shell/spec.md](../app-shell/spec.md) R3b, [../../system/ui.md](../../system/ui.md) 4.8d). A row opens the call page under a **Monitoring** back control ([../../system/ui.md](../../system/ui.md) 4.8e). A session row opens the session page under a **Monitoring** back control ([../../system/ui.md](../../system/ui.md) 4.8f, 4.8g). Monitoring stays the current rail item on all of them.

- Monitoring page: heading "Monitoring", the tabs **LLM calls** and **Sessions**, the note that follows the tab, then the tab's content.
- LLM calls tab: a filter bar (Agent, Model, Provider, Status, Session, Date, **Clear filters**), the table, and the footer with the range, **Rows per page**, **Previous** and **Next**.
- Call page: heading, the facts grid, the error box when failed, **Context window** (caption, stacked bar, legend, seven boxes), **Steps**.
- Sessions tab: a filter bar (Agent, Date, **Clear filters**), the table and the same footer.
- Session page: heading, the totals strip, **Open chat**, then each turn (question, meta line, path, answer, **Open timeline**) and the waterfall under the turn that opened it.

## Flows

E2E: `frontend/e2e/monitoring.spec.ts`

```gherkin
Feature: LLM calls

  Scenario: A new install has no LLM calls
    Given the app starts with a new data dir
    When I click "Monitoring" on the rail
    Then I see the "Monitoring" heading and "Monitoring" is the current rail item
    And I see "No LLM calls yet."

  Scenario: A chat turn appears in the table
    Given I asked the assistant a question in a session
    When I open "Monitoring"
    Then the newest row shows the assistant, its model and provider, the session's name, tokens in and out, a duration, a cost and the status "Succeeded"

  Scenario: Filters narrow the list and Clear filters restores it
    Given the table lists calls from two agents and two models
    When I choose an agent in "Agent"
    Then every row shows that agent and the footer shows the new total
    When I also choose a model in "Model"
    Then only the calls of that agent and that model are listed
    When I click "Clear filters"
    Then all calls are listed again and "Clear filters" is disabled

  Scenario: Filter by status and by date range
    Given the table lists a failed call and a succeeded call
    When I choose "Failed" in "Status"
    Then I see only failed calls, each with the status "Failed"
    When I choose "Last hour" in "Date"
    Then only the calls started in the last hour are listed
    When I choose "Custom" in "Date"
    Then I see the "From" and "To" inputs

  Scenario: Paging and the page size
    Given the table lists more than 25 calls
    Then I see "1–25 of <total>" and "Previous" is disabled
    When I click "Next"
    Then I see the second page and "Previous" is enabled
    When I choose 50 in "Rows per page"
    Then I am on page 1 and up to 50 rows are listed

  Scenario: No call matches
    Given I filter by a session that has no calls in the chosen date range
    Then I see "No LLM calls match these filters."

Feature: LLM call detail

  Scenario: Opens a call and reads its context window
    Given the table lists a call made by a chat turn
    When I click its row
    Then I see the call page with the agent and model in the heading and "Monitoring" is still the current rail item
    And I see the facts: started, duration, status, provider, tokens in and out, estimated cost
    And I see the "Context window" caption and a stacked bar
    And I see seven boxes in order: "System prompt", "Skill injection", "Tools injection", "Chat history", "Dataset", "User prompt", "Tool calls and results"
    And the first three are tagged "US Health" and the last four "Custom"
    When I click "Show text" on "User prompt"
    Then I see the question I asked, word for word
    And I see the "Steps" table with at least one step

  Scenario: An empty box says so
    Given I am on the page of a call with no earlier turns
    Then the "Chat history" box shows "Nothing in this call."

  Scenario: Back keeps the filters and the page
    Given I chose an agent in "Agent" and opened one of its calls
    When I click the "Monitoring" back control
    Then I see the table with that agent still chosen and the same page

  Scenario: The rail returns to the table
    Given I am on a call page
    When I click "Monitoring" on the rail
    Then I see the table, with my filters as I left them

  Scenario: A call that does not exist
    When I open the page of a call id that does not exist
    Then I see "LLM call not found"

Feature: Session flow

  Scenario: The Sessions tab lists a session with its totals
    Given I asked the assistant two questions in one session
    When I open "Monitoring" and choose the "Sessions" tab
    Then I see the note "Sessions with recorded agent runs, most recent first."
    And the session's row shows its name, the assistant, 2 turns, a last activity time, a wall time, a model time, the tool count, tokens in and out, a cost and the status "Succeeded"

  Scenario: A new install has no sessions
    Given the app starts with a new data dir
    When I open "Monitoring" and choose the "Sessions" tab
    Then I see "No sessions yet."

  Scenario: Filters narrow the sessions and Clear filters restores them
    Given the Sessions tab lists sessions from two agents
    When I choose an agent in "Agent"
    Then every row shows that agent
    When I click "Clear filters"
    Then all sessions are listed again and "Clear filters" is disabled

  Scenario: No session matches
    Given I choose "Last hour" in "Date" and no session had a turn in the last hour
    Then I see "No sessions match these filters."

  Scenario: Opens a session and reads the trajectory
    Given the Sessions tab lists my two-question session
    When I click its row
    Then I see the session page with its name and the totals: turns, wall time, model time, tool calls, tokens, cost and errors
    And "Monitoring" is still the current rail item
    And I see turn 1 and turn 2, each with my question on the right and the answer on the left
    And each turn's path lists "Model" steps and tool groups in time order
    And a tool group reads like "run_readonly_sql" with its time and the start of its SQL
    And each model step shows its tokens in and out and an "Open call" link

  Scenario: A long answer is clamped
    Given a turn's answer is longer than 6 lines
    Then I see the first 6 lines and "Show more"
    When I click "Show more"
    Then I see the whole answer

  Scenario: Opens a turn's timeline and switches framework spans
    Given I am on the session page
    When I click "Open timeline" on turn 1
    Then I see the waterfall under that turn with an axis of five ticks
    And I see a row for the agent run, the model call, its requests and its tool calls, each with a bar and a duration
    And I see the legend and a details panel for the first model request
    And the button reads "Hide timeline"
    And I see "Show framework spans" with a count of hidden spans
    When I turn on "Show framework spans"
    Then more rows appear and the hidden count is gone
    When I click a tool row
    Then the details panel shows its input and output
    When I click "Hide timeline"
    Then the waterfall is gone

  Scenario: Open call from a step returns to the session
    Given I am on the session page
    When I click "Open call" on a model step
    Then I see that call's page and its back control reads "Session"
    When I click the "Session" back control
    Then I see the session page again

  Scenario: Back keeps the tab and the filters
    Given I chose the "Sessions" tab, chose an agent in "Agent" and opened one of its sessions
    When I click the "Monitoring" back control
    Then I see the "Sessions" tab with that agent still chosen
    When I open the session again and click "Monitoring" on the rail
    Then I see the "Sessions" tab with my filters as I left them

  Scenario: A call opened from the table still goes back to the table
    Given I am on the "LLM calls" tab and I click a row
    Then the call page's back control reads "Monitoring"
    When I click it
    Then I see the "LLM calls" table

  Scenario: A session that does not exist
    When I open the page of a session id that does not exist
    Then I see "Session not found"

Feature: Runs in Monitoring

  Scenario: A workflow run's call is attributed to the run
    Given I ran the Assistant workflow on a question
    When I open Monitoring
    Then the call is listed under the run "Assistant: <title>"
    When I open the call and follow its run link
    Then I see the run with one turn, its path and its waterfall
```

## Acceptance

- Every Gherkin scenario above passes against the running app. Backend unit tests cover R1–R11 and R16–R22 at service and controller level, including the reader of the trace store pinned to a fixture of Mastra's real `span_events` shape (ADR-0038).
- After a chat turn the call is listed with its agent, model, session, tokens, duration, cost and status; each filter narrows the list and Clear filters restores it; paging and the page-size choice work; a failed call shows Failed (R1–R10).
- A chat turn's call page shows the seven boxes with text matching what was sent: the system prompt, the skills list, the tool definitions, the earlier turns, the session's dataset blocks, the question, and the SQL run with its rows; the box estimates add up to the step's real input tokens (R18–R21).
- Back keeps the filters and page (R13).
- After two chat turns in one session the Sessions tab lists it with 2 turns and totals (tokens, cost, tool calls) equal to the sum of its LLM calls (R27–R29).
- The session page shows both questions, each model request and tool group in order, and both answers (R32–R34). **Open timeline** shows the waterfall with bars to scale, and the framework switch adds the housekeeping spans (R37–R40).
- A run's call is listed under `<workflow>: <title>`, offered in the Session filter, and its link opens the run's session page with one turn, its path and its waterfall (R45).
- Back keeps the tab, filters and page, and a call opened from a session returns to it (R26, R43). Backend unit tests cover R27–R30, R33, R34, R36 and R38–R41 at service and controller level, pinned to the same real-shape fixture.

<!-- sources: backend/src/modules/monitoring/**, backend/src/mastra/storage.ts, frontend/src/app/features/monitoring/**, frontend/src/app/app.html (monitoring and llm-call views) -->
