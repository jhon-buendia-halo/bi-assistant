# Monitoring

The **Monitoring** area shows every LLM call the app's agents make, so a person can spot the slow, failing or expensive ones without a developer tool. It also shows what the agents did across a whole session. It has three tabs and two detail pages. The **LLM calls** tab is a filterable, paged table of calls, newest first. A **call page** opens from a row and shows the call's facts, what filled its **context window** (seven boxes, each tagged by who owns it, with an estimated size and the exact text), and the model steps of the run. The **Sessions** tab is a filterable, paged table of sessions, most recent first. The **Agent quality** tab shows, for each agent persona, how it scores on its evals and how it behaves in live calls. A **session page** opens from a row and shows the **session flow**: each question with the path the agent took (model requests and tool calls, in order), its answer, and, on demand, a **waterfall** of the turn's timeline.

The app records nothing of its own for this. It reads the trace store the agent framework already writes (ADR-0038). The area is read-only: it edits no prices, deletes and exports no calls, and sends nothing anywhere.

## Concepts

Defined in [../../product/glossary.md](../../product/glossary.md): LLM call, eval call, live call, pass^3, context window box, session, session flow, waterfall, framework span, dataset, agent, assistant.

Capability-local vocabulary is limited to the UI words "LLM calls", "Runs", "Agent quality", "Clear filters", "Context window", "Steps", "Show text", "Hide text", "Open call", "Open timeline", "Hide timeline", "Show more" and "Show framework spans".

A **turn** is one question of a session and the agent's work to answer it. In the trace store a turn is one trace (`traceId`), and the session is the `threadId` its agent run carries ([../../system/data-model.md](../../system/data-model.md) 1.2).

## Rules

The table
- R1. The system SHALL list **LLM calls**: one row per model call of one agent run, read from the trace store `observability.duckdb` ([../../system/data-model.md](../../system/data-model.md) 1.2, ADR-0038). Calls recorded before this feature existed are listed too. A model call the agent framework does not trace is not listed.
- R2. Rows SHALL be ordered by start time, newest first.
- R3. Each row SHALL show: **Started** (local date and time), **Agent persona** (its display name), **Model** (with its provider below it, muted), **Run** (its name; when the session has no name, the first 8 characters of its id; a dash when the call belongs to no session), **Tokens in / out** (for example `61,185 / 2,445`; the input count includes cache reads and writes), **Duration** (for example `17.3 s`), **Cost** (for example `$0.0213`) and **Status**. A value the trace does not hold is shown as a dash.
- R4. **Status** SHALL be **Succeeded**, **Failed** or **Running**. A call with no end recorded yet is Running. A call whose end carries an error is Failed. Any other call is Succeeded.
- R5. **Cost** SHALL be an estimate computed from a price table shipped with the app: USD per million tokens for input, output and cache reads, as of 2026-11-03. Cache writes are priced at 1.25 times the input price. The cost is the uncached input tokens at the input price, plus the cache reads at the cache-read price, plus the cache writes at the cache-write price, plus the output tokens at the output price. A model is matched by its exact id or an id that starts with a table key followed by `-`, and the longest key wins. A model not in the table has no cost, shown as a dash, and no context limit. The table is code, not a setting, and the user cannot edit it.

Filters
- R6. The page SHALL offer these filters: **Agent persona**, **Model**, **Provider**, **Status** (Any status, Succeeded, Failed, Running), **Run** and **Date**. Their choices SHALL be the values present among all calls, sorted by name, and SHALL NOT shrink as other filters are set. A session without a name is offered by the first 8 characters of its id.
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
- R14. The call page SHALL show a heading with the agent's name (or "Model call" when the call has no agent) and the model, and these facts: **Started**, **Duration**, **Time to first token**, **Status**, **Run** (a link that opens the session's chat when the session has a name), **Provider**, **Finish reason**, **Tokens in** (with the cache reads and cache writes), **Tokens out** (with the reasoning tokens) and **Estimated cost**. A fact the trace does not hold is a dash.
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
- R26. The Monitoring page SHALL show three tabs under its heading, **LLM calls**, **Runs** and **Agent quality** (`role="tablist"`). ArrowRight and ArrowLeft SHALL move to the next and previous tab and wrap around (from **Agent quality** to **LLM calls** and back); Home and End SHALL choose the first and the last. **LLM calls** is chosen when the page opens for the first time. The note under the heading follows the tab: "LLM calls made by the app's agent personas, newest first.", "Runs with recorded agent persona calls, most recent first." or "How each agent persona scores on its evals and behaves in live calls.". The chosen tab, and each tab's own filters, page and page size, SHALL be kept while the app runs, so leaving to a call page or a session page and coming back finds them as they were left.

The Sessions table
- R27. The **Runs** tab (named **Sessions** until 2026-11-11, roadmap 1.23.21; its test ids keep `sessions`) SHALL list **sessions**, which the tab and the page now call runs: one row per session that has at least one recorded agent run, read from the trace store (ADR-0038). A session is a distinct `threadId` on the agent runs. Rows SHALL be ordered by last activity, newest first. A session whose chat was deleted, or that was a preview or an eval, is listed too.
- R28. Each row SHALL show: **Run** (its name, read from the sessions collection; "Unnamed run" with the first 8 characters of its id, muted, when it has no name), **Agent persona** (the display names of the agents that ran in it), **Turns**, **Last activity** (local date and time), **Wall time** (the sum of the turns' durations), **Model time** (the sum of the model calls' durations), **Tools** (the number of tool calls), **Tokens in / out**, **Cost** (the sum of the estimated costs, R5) and **Status**. A value the trace does not hold is shown as a dash.
- R29. A session's **Status** SHALL be **Failed** when it has at least one failed span (an agent run, a model call or a tool call that ended with an error or `success: false`), else **Running** when a turn has no end recorded yet, else **Succeeded**. The row's error count SHALL equal the number of those failed spans.
- R30. The tab SHALL offer the filters **Agent persona** (sessions in which that agent ran) and **Date** (Any time, Last hour, Last 24 hours, Last 7 days, Custom with **From** and **To**; a session is kept when one of its turns started inside the range, ends included), and **Clear filters**. Agent choices SHALL be the agents present among all sessions and SHALL NOT shrink as the date is set. R8 and R9 apply to these filters, and R10 and R11 to the paging, with the same page sizes and messages.
- R31. With no sessions at all, the tab SHALL show "No runs yet.". With sessions but none matching the filters, it SHALL show "No runs match these filters.". Loading and failed loads behave as in R12. Clicking a row, or pressing Enter on it, SHALL open that session's page, and **Monitoring** SHALL stay the current rail item.

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
- R46. The Plan and Write answer steps of the former Answer a Business Question (removed 2026-11-23) ran two System agents (`Analysis Planner` and `Answer Writer`, removed on 2026-11-26), and their model calls appeared in the LLM calls list like any agent's under those technical names. A call stored under either name stays listed and the Agent filter (R6) offers the name while such a call exists; nothing makes a new one.

Costs (usage and cost)
- R47. The **Costs** page (its own rail item, [../app-shell/spec.md](../app-shell/spec.md) R3c) SHALL summarise the estimated cost of the LLM calls of R1: every call counts once, priced as in R5. A call whose model has no price, or whose tokens are not known, SHALL count as a call and add its known tokens but no cost. The page records nothing and reads the same trace store (ADR-0038); it changes nothing (R24).
- R48. A **Period** choice SHALL offer This month, Last 30 days (the default), Last 90 days, This year and All time. A period starts at local midnight of its first day (Last 30 days: today and the 29 days before) and ends now; All time has no start. Days and months SHALL follow the time zone of the computer that shows the page.
- R49. Five tiles SHALL show: **Today** and **This month** (cost and number of calls of the current day and calendar month, whatever the period), the period's cost and calls (titled with the period's name), **Avg per workflow run** (R54) with the number of runs, and **Avg per chat question** (R54) with the number of questions; a dash when there are none. When some calls of the period have no cost (R47), a line SHALL say how many.
- R50. **Daily cost** SHALL show one bar per day of the period, days without calls at zero; for All time the days start at the first call. **Monthly cost** SHALL show the 12 calendar months ending with the current one, whatever the period. Both are single-series column charts on a scale from $0 to a round ceiling, with a tooltip per bar (`<day or month>`, cost, calls) and a **Show table** control that shows the same values as a table (**Show chart** returns).
- R51. Two rankings over the period SHALL list the cost and calls, highest cost first: **By model** (the model with its provider; "No price" for a model without one) and **By agent persona** (its name; calls made by no agent under "No agent persona"). The workflows are compared per run (R55).
- R52. Choosing a model or an agent in a ranking SHALL open Monitoring's LLM calls tab filtered to that model or agent, with the Date filter set to Custom from the period's start (Any time for All time), and Monitoring the current rail item.
- R53. With no calls in the period the page SHALL show the tiles, "No LLM calls in this period." and the monthly chart, and no daily chart, per-run table, top runs, cost split or rankings. A fresh data dir with no trace table shows the same, not an error. Loading and failed loads behave as in R12. `GET /monitoring/usage` SHALL reject a From or To that is not a date (`From is not a valid date`, `To is not a valid date`), a From after To (`From must not be after To`) and an unknown time zone (`Time zone is not valid`) with HTTP 400.
- R54. A **workflow run** is every call whose thread is the run's host `run-<runId>` or one of its step agents' threads `run-<runId>:<agent key>` (ADR-0041, [../../system/agents.md](../../system/agents.md) 5.14); its cost is the sum of those calls in the period. A **chat question** is one trace (turn) of the calls outside any workflow run. **Avg per workflow run** and **Avg per chat question** SHALL be the period's mean cost of each.
- R55. **Cost per workflow run** SHALL list, for each workflow with runs in the period, its runs, the mean, the median and the 95th percentile (nearest rank) of their costs, and its total, highest total first; the runs of deleted runs under "Deleted workflow run"; then "No workflow" (chats, the agent panel, previews and evals) with its total only.
- R56. **Most expensive runs** SHALL list the period's 10 costliest workflow runs, highest first: the run's title (its question, as the run history titles it; "Run" and the first 8 characters of its id for a deleted run), its workflow, the start of its first call in the period, its calls and its cost. Choosing a stored run SHALL open it as the Runs page does ([../workflows/spec.md](../workflows/spec.md) R19); a deleted run is not a link.
- R57. **Where the cost goes** SHALL split the period's cost into **Input** (uncached input tokens at the input price), **Cache writes**, **Cache reads** and **Output**, priced as in R5, each with its cost, its share of the total and its tokens, and SHALL say how much the cache reads saved against the full input price when they saved anything.

Agent quality (2026-11-22, ADR-0054, roadmap plan `monitoring-agent-quality`)
- R58. The **Agent quality** tab SHALL list one row per built-in agent persona that has at least one eval set ([../agents-evals/spec.md](../agents-evals/spec.md) R26, R34), sorted by persona name. A row SHALL show: **Agent persona** (its name, with its role muted below), **Eval pass rate (last run)** (R62), **pass^3** (R63), **Tool calls per question** (one decimal), **Tool errors** (`x %`), **p95 latency (live)** (`17.3 s`), **Cost per call (live)** (`$0.0213`) and **Last eval** (`Nov 21`). A value that is not known is shown as a dash.
- R59. The eval figures SHALL come from the agent persona's eval runs ([../agents-evals/spec.md](../agents-evals/spec.md) R112) and the live figures from its LLM calls outside eval runs. A model call is an **eval call** when any span of its trace carries `metadata."eval-run-id"` (ADR-0054, [../agents-evals/spec.md](../agents-evals/spec.md) R114); every other call is a **live call**, including calls recorded before the marker existed. The live figures SHALL leave the eval calls out. The tab reads eval runs and the trace store and changes neither (R24).
- R60. The filters SHALL be **Agent persona** (`All agent personas`), **Eval set** (`All sets`; its options narrow to the chosen agent persona's sets, and choosing another agent persona clears the set), **Model** (`All models`), **Date** (Last 7 days, **Last 30 days** by default, Last 90 days, All time; a period starts at local midnight of its first day and ends now, as the Costs page, R48) and **Clear filters** (resets the defaults; disabled at the defaults). Their options (the facets) SHALL NOT be narrowed by the filters: the agent personas with sets, every set, and the models of their runs plus the models of their live calls, sorted, with `Unknown` last.
- R61. **Which runs count.** Only runs with status `completed`. An old run's set is the stored one; with none stored, the single set of the agent whose cases hold every one of the run's case ids, and none when no single set does (such a run counts only under All sets). Its model is the stored one, else `Unknown`. A run is in scope when its set matches the Eval set filter, its finish time (start time when none) is inside the period, and its model matches the Model filter. **M**, the model the eval figures are on, is the Model filter when set, else the model of the newest run in scope; the figures are over the runs in scope on M, newest first.
- R62. **Eval pass rate (last run)** SHALL be the newest run's passed questions over its questions, shown as `<passed>/<total> · <rate> %` rounded to a whole number, in a chip that is success when the rate is exactly 100 %, warning from 80 %, else danger. **Last eval** is that run's finish date.
- R63. **pass^3** is the share of questions that passed in each of their last 3 runs on the same model M, not the unbiased estimator of the literature. Runs with model `Unknown` are never pooled: the cell is a dash with the tooltip `Model not recorded for these runs`. Otherwise the questions counted are those of the runs on M that are still in the agent persona's current sets (only the chosen set's with the Eval set filter); a question counts once it has 3 results on M, and the figure is the share of those whose 3 latest results all passed, with the muted `(k of N)` when k of the N questions have 3. With no question counted the cell reads `needs 3 runs (n of 3)`, n being the most results any question has, up to 2. The chip has the tones of R62.
- R64. **Tool calls per question** SHALL be the tool calls of the runs on M over their question results, and **Tool errors** the share of those calls that ended with an error; each is a dash when its denominator is 0.
- R65. **p95 latency (live)** SHALL be the nearest-rank 95th percentile of the duration of the agent persona's finished live calls in the period (succeeded or failed; running ones excluded), and **Cost per call (live)** the mean estimated cost of its priced live calls (R5); a model with no price adds no cost, and a call of an unpriced model does not count in the mean. With the Model filter, only calls of that model count (`Unknown` matches none). With no live call the cell is a dash with the tooltip `No live calls in this period`.
- R66. A row with no completed run ever SHALL show `No eval run yet` in the pass-rate cell and dashes in the other eval cells; with runs but none matching the filters, `No eval run matches these filters`. While loading the tab SHALL show `Loading agent quality…`; a failed load shows an inline alert with the backend's message; with no row, `No agent persona matches these filters.`. A legend SHALL read: `pass^3: share of questions that passed in each of their last 3 runs on the same model. Eval figures come from the agent persona's eval runs; live figures from its LLM calls outside eval runs. Choose a row to open its eval executions.`
- R67. Choosing a row (click or Enter) SHALL open that agent persona's page on its **Evals** tab, sub-tab **Executions** ([../agents-evals/spec.md](../agents-evals/spec.md) R34), with **Agent personas** the current rail item.
- R68. `GET /monitoring/agent-quality` SHALL reject a From or To that is not a date (`From is not a valid date`, `To is not a valid date`) and a From after To (`From must not be after To`) with HTTP 400. An unknown agent, set or model is not an error: it matches nothing. A data dir with no trace table gives live figures of 0 calls. The endpoint is read-only (R24).

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
- Costs page with calls of a model that has no price: they count in the calls, the tiles say how many have no cost, and the model ranks with "No price" (R47, R49, R51).
- Costs page on a period with no calls: the tiles at $0.00, "No LLM calls in this period." and the monthly chart (R53).
- Agent quality: an agent persona with sets but no completed run shows `No eval run yet` (R66); runs recorded before the model was stored have model `Unknown` and no pass^3 (R61, R63); a set filter keeps only that set's runs and cases (R61, R63); fewer than 3 runs of a question show `needs 3 runs (n of 3)` (R63); a model with no price adds no cost to the live cost per call (R65).

## Contracts

- Endpoints: `GET /monitoring/llm-calls`, `GET /monitoring/llm-calls/:id`, `GET /monitoring/sessions`, `GET /monitoring/sessions/:id`, `GET /monitoring/traces/:traceId`, `GET /monitoring/usage` (the Costs page) and `GET /monitoring/agent-quality` (the Agent quality tab, #163). See [../../system/api.md](../../system/api.md) (section 2.8c).
- Source data: the `span_events` table of `observability.duckdb`, read in-process, and, for Agent quality, the `eval_runs` collection read-only; no new collection. See [../../system/data-model.md](../../system/data-model.md) (1.2).
- Decision: [../../system/architecture.md](../../system/architecture.md) ADR-0038 and ADR-0054 (the eval marker and Agent quality).
- Related: [../app-shell/spec.md](../app-shell/spec.md) R3b (the rail item and the page), [../../system/agents.md](../../system/agents.md) 4.1 (the per-turn context blocks that fill the Dataset box), [../developer-settings/spec.md](../developer-settings/spec.md) (the opt-in trace viewers this area does not depend on).

## UI

Placement: the **Monitoring** item on the navigation rail opens the Monitoring page ([../app-shell/spec.md](../app-shell/spec.md) R3b, [../../system/ui.md](../../system/ui.md) 4.8d). A row opens the call page under a **Monitoring** back control ([../../system/ui.md](../../system/ui.md) 4.8e). A session row opens the session page under a **Monitoring** back control ([../../system/ui.md](../../system/ui.md) 4.8f, 4.8g). Monitoring stays the current rail item on all of them.

- Monitoring page: heading "Monitoring", the tabs **LLM calls**, **Runs** and **Agent quality**, the note that follows the tab, then the tab's content.
- LLM calls tab: a filter bar (Agent, Model, Provider, Status, Session, Date, **Clear filters**), the table, and the footer with the range, **Rows per page**, **Previous** and **Next**.
- Call page: heading, the facts grid, the error box when failed, **Context window** (caption, stacked bar, legend, seven boxes), **Steps**.
- Runs tab: a filter bar (Agent, Date, **Clear filters**), the table and the same footer.
- Session page: heading, the totals strip, **Open chat**, then each turn (question, meta line, path, answer, **Open timeline**) and the waterfall under the turn that opened it.
- Agent quality tab: a filter bar (Agent persona, Eval set, Model, Date, **Clear filters**), the table (one row per agent persona with sets) and the legend.
- Costs page (rail **Costs**, [../../system/ui.md](../../system/ui.md) 4.8j): heading "Costs", the note and **Period**, the five tiles, **Daily cost**, **Monthly cost**, **Cost per workflow run**, then **Most expensive runs** beside **Where the cost goes**, then **By model** beside **By agent persona** on a wide window.

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
    When I choose an agent in "Agent persona"
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
    Given I chose an agent in "Agent persona" and opened one of its calls
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

  Scenario: The Runs tab lists a session with its totals
    Given I asked the assistant two questions in one session
    When I open "Monitoring" and choose the "Runs" tab
    Then I see the note "Runs with recorded agent persona calls, most recent first."
    And the session's row shows its name, the assistant, 2 turns, a last activity time, a wall time, a model time, the tool count, tokens in and out, a cost and the status "Succeeded"

  Scenario: A new install has no sessions
    Given the app starts with a new data dir
    When I open "Monitoring" and choose the "Runs" tab
    Then I see "No runs yet."

  Scenario: Filters narrow the sessions and Clear filters restores them
    Given the Runs tab lists sessions from two agents
    When I choose an agent in "Agent persona"
    Then every row shows that agent
    When I click "Clear filters"
    Then all sessions are listed again and "Clear filters" is disabled

  Scenario: No session matches
    Given I choose "Last hour" in "Date" and no session had a turn in the last hour
    Then I see "No runs match these filters."

  Scenario: Opens a session and reads the trajectory
    Given the Runs tab lists my two-question session
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
    Given I chose the "Runs" tab, chose an agent in "Agent persona" and opened one of its sessions
    When I click the "Monitoring" back control
    Then I see the "Runs" tab with that agent still chosen
    When I open the session again and click "Monitoring" on the rail
    Then I see the "Runs" tab with my filters as I left them

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
    Given I ran the "Answer a Business Question (Avery + Michael)" workflow on a question
    When I open Monitoring
    Then the call is listed under the run "Answer a Business Question (Avery + Michael): <title>"
    When I open the call and follow its run link
    Then I see the run with one turn, its path and its waterfall

```

E2E: `frontend/e2e/monitoring-agent-quality.spec.ts`

```gherkin
Feature: Agent quality

  Scenario: The tab shows its note and the three tabs cycle with the arrow keys
    Given I open "Monitoring"
    When I choose the "Agent quality" tab
    Then I see the note "How each agent persona scores on its evals and behaves in live calls."
    When I press ArrowRight on the "Agent quality" tab
    Then the "LLM calls" tab is chosen
    When I press ArrowLeft
    Then the "Agent quality" tab is chosen

  Scenario: An agent persona with no eval run shows No eval run yet
    Given an agent persona has eval sets and no completed run
    When I open the "Agent quality" tab
    Then its row shows "No eval run yet" and dashes in the other eval cells

  Scenario: After one eval run the row shows the pass rate and needs 3 runs
    Given I ran the assistant's evals once on one question
    When I open the "Agent quality" tab
    Then the assistant's pass rate chip reads "<passed>/1 · <rate> %"
    And its pass^3 reads "needs 3 runs (1 of 3)"
    And its p95 latency and cost per call are dashes because its eval calls are not live calls

  Scenario: A live run shows its agent persona's p95 latency
    Given I ran Insights Analyst on a question
    When I open the "Agent quality" tab
    Then the Insights Analyst row shows a p95 latency in seconds

  Scenario: The Model filter offers the model of the run
    Given an eval run recorded its model
    When I open the "Model" filter
    Then it offers that model

  Scenario: Clear filters restores the defaults
    Given I chose a model and the period "All time"
    When I click "Clear filters"
    Then the filters are back to "All models" and "Last 30 days"
    And "Clear filters" is disabled

  Scenario: A row opens the agent persona's eval executions
    Given the assistant has an eval run
    When I choose the assistant's row
    Then I see the Agent personas page on the Evals tab, sub-tab Executions, listing the run
    And "Agent personas" is the current rail item
```

## Acceptance

- Every Gherkin scenario above passes against the running app. Backend unit tests cover R1–R11 and R16–R22 at service and controller level, including the reader of the trace store pinned to a fixture of Mastra's real `span_events` shape (ADR-0038).
- After a chat turn the call is listed with its agent, model, session, tokens, duration, cost and status; each filter narrows the list and Clear filters restores it; paging and the page-size choice work; a failed call shows Failed (R1–R10).
- A chat turn's call page shows the seven boxes with text matching what was sent: the system prompt, the skills list, the tool definitions, the earlier turns, the session's dataset blocks, the question, and the SQL run with its rows; the box estimates add up to the step's real input tokens (R18–R21).
- Back keeps the filters and page (R13).
- After two chat turns in one session the Runs tab lists it with 2 turns and totals (tokens, cost, tool calls) equal to the sum of its LLM calls (R27–R29).
- The session page shows both questions, each model request and tool group in order, and both answers (R32–R34). **Open timeline** shows the waterfall with bars to scale, and the framework switch adds the housekeeping spans (R37–R40).
- A run's call is listed under `<workflow>: <title>`, offered in the Session filter, and its link opens the run's session page with one turn, its path and its waterfall (R45).
- The Costs page's totals, daily, model, workflow and agent sums each equal the sum of the LLM calls of the period, a workflow run's calls (its step agents' included) count under its workflow and as one run, and the cost split adds up to the total (R47–R57); backend unit tests cover them on the real-shape fixture and pin the time-zone bucketing.
- Back keeps the tab, filters and page, and a call opened from a session returns to it (R26, R43). Backend unit tests cover R27–R30, R33, R34, R36 and R38–R41 at service and controller level, pinned to the same real-shape fixture.
- The Agent quality tab lists one row per agent persona with eval sets; after one eval run Elena shows her pass rate, `needs 3 runs (1 of 3)` and dashes for the live columns, a live run shows p95 for its agent persona, the Model filter offers the run's model, and a row opens its Executions (R58–R68). Backend unit tests cover the formulas (R61–R65) and the 400 messages (R68) on the real-shape fixture, with eval-marked traces excluded from the live figures (R59).

<!-- sources: backend/src/modules/monitoring/**, backend/src/mastra/storage.ts, frontend/src/app/features/monitoring/**, frontend/src/app/features/costs/**, frontend/src/app/app.html (monitoring, llm-call and costs views) -->
