# Monitoring

The **Monitoring** area shows every LLM call the app's agents make, so a person can spot the slow, failing or expensive ones without a developer tool. It has two pages. The **LLM calls** page is a filterable, paged table of calls, newest first. A **call page** opens from a row and shows the call's facts, what filled its **context window** (seven boxes, each tagged by who owns it, with an estimated size and the exact text), and the model steps of the run.

The app records nothing of its own for this. It reads the trace store the agent framework already writes (ADR-0037). The area is read-only: it edits no prices, deletes and exports no calls, and sends nothing anywhere.

## Concepts

Defined in [../../product/glossary.md](../../product/glossary.md): LLM call, context window box, session, dataset, agent, assistant.

Capability-local vocabulary is limited to the UI words "LLM calls", "Clear filters", "Context window", "Steps", "Show text" and "Hide text".

## Rules

The table
- R1. The system SHALL list **LLM calls**: one row per model call of one agent run, read from the trace store `observability.duckdb` ([../../system/data-model.md](../../system/data-model.md) 1.2, ADR-0037). Calls recorded before this feature existed are listed too. A model call the agent framework does not trace is not listed.
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

## Edge cases and errors

- Fresh data dir, or a trace store with no table yet: "No LLM calls yet." (R12).
- A call from a preview, an eval or a deleted session: its session shows a dash, and the Session filter still offers its id.
- A model with no price: Cost is a dash and the context caption has no limit (R5, R17).
- A call still running: Status Running, no duration, tokens and cost as far as known, and no end time (R4, R15).
- A call whose request failed: Status Failed and its error message on the call page (R15).
- A very long text in a box stays inside its scrolling block (R19).
- A filter set that matches nothing: "No LLM calls match these filters." with **Clear filters** enabled (R12, R9).
- The trace store is unreadable: the page shows an inline error and the rest of the app works.

## Contracts

- Endpoints: `GET /monitoring/llm-calls` and `GET /monitoring/llm-calls/:id`. See [../../system/api.md](../../system/api.md) (section 2.8c).
- Source data: the `span_events` table of `observability.duckdb`, read in-process, no new collection. See [../../system/data-model.md](../../system/data-model.md) (1.2).
- Decision: [../../system/architecture.md](../../system/architecture.md) ADR-0037.
- Related: [../app-shell/spec.md](../app-shell/spec.md) R3b (the rail item and the page), [../../system/agents.md](../../system/agents.md) 4.1 (the per-turn context blocks that fill the Dataset box), [../developer-settings/spec.md](../developer-settings/spec.md) (the opt-in trace viewers this area does not depend on).

## UI

Placement: the **Monitoring** item on the navigation rail opens the Monitoring page ([../app-shell/spec.md](../app-shell/spec.md) R3b, [../../system/ui.md](../../system/ui.md) 4.8d). A row opens the call page under a **Monitoring** back control ([../../system/ui.md](../../system/ui.md) 4.8e). Monitoring stays the current rail item on both.

- Monitoring page: heading "Monitoring", the note "LLM calls made by the app's agents, newest first.", a filter bar (Agent, Model, Provider, Status, Session, Date, **Clear filters**), the table, and the footer with the range, **Rows per page**, **Previous** and **Next**.
- Call page: heading, the facts grid, the error box when failed, **Context window** (caption, stacked bar, legend, seven boxes), **Steps**.

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
```

## Acceptance

- Every Gherkin scenario above passes against the running app. Backend unit tests cover R1–R11 and R16–R22 at service and controller level, including the reader of the trace store pinned to a fixture of Mastra's real `span_events` shape (ADR-0037).
- After a chat turn the call is listed with its agent, model, session, tokens, duration, cost and status; each filter narrows the list and Clear filters restores it; paging and the page-size choice work; a failed call shows Failed (R1–R10).
- A chat turn's call page shows the seven boxes with text matching what was sent: the system prompt, the skills list, the tool definitions, the earlier turns, the session's dataset blocks, the question, and the SQL run with its rows; the box estimates add up to the step's real input tokens (R18–R21).
- Back keeps the filters and page (R13).

<!-- sources: backend/src/modules/monitoring/**, backend/src/mastra/storage.ts, frontend/src/app/features/monitoring/**, frontend/src/app/app.html (monitoring and llm-call views) -->
