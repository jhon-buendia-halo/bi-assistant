# Agent answers

An agent answers a business question over one or more datasets. It plans the analysis, writes and runs read-only SQL against the datasets' datasources, and streams back its reasoning, each tool call and a final Markdown answer. Since 1.23.22 the turn is always one run of a workflow, on a temporary run host ([workflows](../workflows/spec.md), [agents.md](../../system/agents.md) 5.14); no chat is started or continued, and the stored sessions of earlier versions open read-only ([past-chats](../past-chats/spec.md)). Every answer shows how it was produced: the queries it ran and why, the rows each returned, the entities it touched, the curated knowledge it was given, and reliability signals (automatic SQL repair, result-quality warnings, a verified-query badge and an optional independent cross-check). Users can trust a number because they can see where it came from. They can stop a run and answer the assistant's clarifying questions.

This spec is what stayed of the former sessions-chat capability when it was split into agent-answers and past-chats (1.23.27). Rule numbers are kept, so older references read; rules about the chat composer and the chat session are retired here or moved to [past-chats](../past-chats/spec.md) (R1–R7, R49, R57, R59, R60, R62, R63, R65, R66).

## Concepts

All terms are defined in [glossary](../../product/glossary.md): **Session**, **Dataset**, **Datasource**, **Entity** (fully-qualified `catalog.schema.table`), **Turn**, **Answer**, **Tool call**, **Data record** (one captured tool result), **Rationale**, **Reasoning trail**, **Interpretation line**, **Clarification**, **Careful mode**, **Cross-check**, **Verified query**, **Ontology item**, **Metric definition**, **Session workspace**, **Agent memory thread**, **Visual** (see [visuals](../visuals/spec.md)), **Deep analysis** (see [deep-analysis](../deep-analysis/spec.md)).

## Rules

### Sending a message and streaming

- R8. The system SHALL reject an empty or whitespace-only question: a run refuses it before it starts ([workflows](../workflows/spec.md)).
- R9. Retired (1.23.27). The composer's Enter and Shift+Enter went with it.
- R10. The system SHALL persist the user's message before the model starts, so it survives a reload even if the turn is stopped or fails.
- R11. Retired (1.23.27). A retry reused an unanswered user message in a stored session; a run host starts empty.
- R12. While a turn runs, the system SHALL stream, in order of arrival:
  - the model's reasoning text;
  - each tool call, with its stated rationale when it has one;
  - each tool result summary (input, row count or error);
  - the answer text as it forms;
  - a visual-updated notice when a visual is created or tailored.

  The turn ends with exactly one terminal event: `done`, carrying the persisted session, or `error`, carrying a message.
- R13. While a turn runs, the Run page SHALL show a "Thinking" block with:
  - the last ~90 characters of reasoning on one line;
  - one row per tool call: tool name, then "failed", "N rows" or a spinner;
  - the rationale and the input (SQL) of each call;
  - for a tool that emits `tool-progress` events (today `assess_data_readiness`), the latest progress message on its row while it runs, cleared when its result lands;
  - the answer as rendered Markdown while it streams;
  - an elapsed-seconds counter with one decimal.
- R14. Retired (1.23.27). The chat replaced its transcript with the persisted one on `done`; a run's page shows the run's stored answer.
- R15. Retired (1.23.27). The one-turn-per-session rule and the "Stop response" control went with the chat composer; a run is stopped from its page.
- R16. Stopping a run SHALL abort the turn on the server. The server persists partial answer text when it was stopped mid-answer.
- R17. The assistant SHALL use at most 15 model steps per turn.
- R18. If a turn ends with no answer text and no visual, the system SHALL run one extra tool-free pass that writes an answer from the data already collected. If that also yields nothing, the answer is the fixed text "I completed the data analysis but could not produce a final response. Please retry your question."
- R19. If a turn produced a non-empty answer without calling any tool, the system SHALL run one corrective pass, tools allowed, at most once per turn. That pass tells the model to re-answer data claims from executed queries, or to say the data does not cover the question. Its answer replaces the original. Any queries it runs join the answer's data records. The pass does not write to the session's memory thread.
- R20. A turn that only created or tailored a visual and wrote no text SHALL be persisted with the text `Created interactive visual "<title>" (v<N>).` or `Updated interactive visual "<title>" (v<N>).`.
- R21. Retired (1.23.27). A same-session refresh that must not disturb an in-flight chat turn went with the live chat.

### Grounding and tools

- R22. The assistant SHALL only query entities from the session's datasets. It works only through these tools:
  - list entities;
  - describe an entity (columns, types, captured sample values);
  - sample rows (default 10, max 100);
  - run one read-only `SELECT`/`WITH` statement (default limit 100, max 500).

  Tools that need a datasource SHALL ask the model to name one when several datasources are in scope, and refuse when none is bound.

  Every agent also has `show_in_panel`, which shows a file, a document, a query result, a visual or its workflow in the right panel ([agent-panel](../agent-panel/spec.md) R1).
- R23. Every row-sampling or SQL tool call SHALL carry a rationale: one or two plain business sentences saying why the step is taken. It is stored flattened and clipped to 400 characters.
- R24. Each turn's context SHALL give the assistant:
  - the session's dataset and entity orientation;
  - the session's visuals (id, title, current version) and which one is open;
  - the curated metric definitions for those entities;
  - the enabled ontology items for the session's datasets (its datasets' own items and shared ones);
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
  - the ontology items that were in its context.
- R31. The interpretation line SHALL be built from the successful SQL runs only, never from model output: `Computed from <N> quer(y|ies)[ over <entity, …>] — <R> row(s) analyzed.` It is absent when no SQL succeeded.
- R32. Under an answer, the chat SHALL show these blocks, each only when non-empty:
  - a collapsible "How I worked this out (N step(s))" list, each step's rationale followed by "N rows" or "failed — <error>";
  - a collapsible "Ontology in context (N)" list (kind, name, dataset or "all datasets", body), with a note that disabled items are never included and that the ontology is edited in the dataset's Ontology tab;
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

  The rating is persisted on the answer. A workflow run's answer is rated the same way on the Run tab ([../workflows/spec.md](../workflows/spec.md) R22). The library itself is specified in [verified-queries](../verified-queries/spec.md).

### Careful mode (cross-check)

- R37. Careful mode is asked for per run (the `careful` option of a run's turn). It applies to that run only and is never stored.
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
- R42. A clarification SHALL end the turn immediately: the model stops. A clarification the model sends malformed SHALL NOT be shown: the model is told and asks again, so a card always has its options. The question is persisted as an assistant message carrying the options and any data records, entities, reasoning and knowledge gathered before it, and `done` is sent.
- R43. Only the latest clarification card SHALL be actionable. Its controls:
  - Each option is numbered, and picking it sends the option label as the next user message.
  - "Something else" opens a "Type your own answer…" field with "Send custom answer". It toggles to "Cancel custom answer".
  - "Skip" sends "Skip — proceed with your best judgment."
- R44. When the user answers a clarification, the system SHALL give the model the clarifying question together with the answer, so the follow-up turn has the context.

### Errors

- R45. Retired (1.23.27). The chat error bubble, its toast and **Retry** went with the composer. A run that fails ends `failed` with its error on the Run page ([workflows](../workflows/spec.md)); the provider's error text is the run's error.

### Memory and continuity

- R46. Each session SHALL have its own persistent agent memory thread. Each turn replays the last 40 messages. There is no semantic recall and no auto-generated title.
- R47. When a session has a transcript but no memory thread (created before memory existed), the system SHALL seed the thread from the full persisted transcript on the next turn.
- R48. Background work (deep-analysis sub-calls, grounding pass, SQL repair, cross-check, visual design) SHALL NOT write into the session's memory thread.

### Retired chat rules

- R50. Retired (1.23.27). The empty chat's welcome block and its starter prompts went with the chat composer.
- R51. Moved to past-chats R66 (the history strip of a transcript; see ../past-chats/spec.md).

### Sessions started from an agent

Agents are defined in [agents-evals](../agents-evals/spec.md) (R43-R52); decision ADR-0008 in [architecture.md](../../system/architecture.md).

- R52. Retired (1.24.12). **Start chat** (on a workflow, never on an agent) created a session from the workflow or its agent. No card, page or button starts a chat now: a workflow runs through its **Run** ([workflows](../workflows/spec.md) R5, R12) and `POST /sessions` with a `workflowId` is refused with `Workflow "<id>" runs on an input` ([api.md](../../system/api.md) 3). `POST /sessions` was removed in 1.23.27 ([api.md](../../system/api.md) 3): no route creates a session, and a run of an agent workflow refuses a missing or unpublished agent with the texts of [workflows](../workflows/spec.md) R12.
- R53. A session started from an agent SHALL keep the datasets it was created with ([past-chats](../past-chats/spec.md) R5). Republishing the agent with other datasets SHALL NOT change them.
- R54. Every assistant call made for a session bound to a user agent that still exists (chat turns, the grounding pass and deep-analysis calls) SHALL apply the agent's **current Live version**:
  - its instructions, when not empty, as a system context block labelled as user-supplied, after every other context block (R24; the block is in [agents.md](../../system/agents.md) section 4.1, and only the grounding pass's own nudge follows it);
  - its model override and reasoning-effort override, when set (R56);
  - its tool selection: only the tools it selects are offered, and the prompt's tool list and working rules match them ([agents.md](../../system/agents.md) 2.1);
  - its skills: the copies taken when it was published, given to the model through the framework's skill catalog and skill tool, from those copies ([agents.md](../../system/agents.md) 7.3).

  Publishing a new version SHALL change the next turn of every session bound to the agent. A draft SHALL never apply to a session. The only exception is the agent editor's draft run, an in-memory run host that runs the draft (agents-evals R60, R61).
- R55. An agent's instructions SHALL NOT relax any rule enforced in code: the read-only SQL guard, dataset scoping (R22), SQL repair (R25-R28), the grounding pass (R19) and the result-quality warnings hold whatever the instructions say. A write statement attempted under an agent's instructions SHALL be rejected by the read-only guard and shown as a failed tool call.
- R56. A model override SHALL name a model or deployment of the configured provider. It SHALL replace the configured model for the assistant's calls only. The SQL fixer, SQL verifier, visual designer, ontology bootstrap and eval judge keep the configured model and their own efforts. A reasoning-effort override SHALL replace the user's setting for the same assistant calls. With no LLM settings saved, the model override SHALL be ignored and the fallback model applies. A model the provider rejects SHALL fail the turn with the provider's error, like any model error (R45).
- R58. Retired (1.23.27). The welcome block of a session bound to an agent went with the chat composer.
- R61. A session bound to a built-in agent (today the Data Readiness Agent and Questions to Insights v2, R52) SHALL run that agent on every turn, not the assistant: its own prompt, tools, skill and per-turn context ([agents.md](../../system/agents.md) 4.1, 5.1). The assistant-only passes (the grounding pass R19, careful mode and the result-quality warnings) SHALL NOT apply to it. R54-R56 and R59 do not apply; R57 and R58 do, with the built-in agent's name, description and starter questions. Their behaviour is specified in [../data-readiness/spec.md](../data-readiness/spec.md). A session stored with the removed agent `rfp` (2026-11-12) is a plain session now: it runs the assistant if it is ever continued and its stored RFP fields are ignored. **Questions to Insights v2** (`assistant-v2`, BA-320) is bound the same way but runs on the user's own datasets: a session of an earlier version stored `agentKey: "assistant-v2"` and `agentName: "Questions to Insights v2"`, every turn runs v2 with its three data tools and shipped prompt ([agents.md](../../system/agents.md) 2.11), and a v2 turn runs like the other bound agents' turns: no grounding pass and no careful mode. A streamed v2 turn is a workflow defined in code (ADR-0034, [agents.md](../../system/agents.md) 5.11) whose steps `Receive question`, `Load catalog`, `Analyse` and `Wrap up` show in the workflow bar ([agent-panel](../agent-panel/spec.md) R8a); the answer streams in the Analyse step exactly as above, and a failed step ends the turn with its error. The chat header and the session chip name the agent as for the other built-in agents (R57). A session bound to a built-in agent runs that agent's workflow (R65): Questions to Insights v2's session runs `qti-v2-turn`, the RFP Builder's `agent:rfp` and the Data Readiness Agent's `agent:data-readiness` ([workflows](../workflows/spec.md) R2, R4). Every streamed turn of any session, plain, bound or started from a user agent, is one run of its workflow ([agents.md](../../system/agents.md) 5.1): a one-step workflow's single step runs the turn above, with the same answer, events, workflow bar and stored message, and nothing else changes. The non-streamed turn was removed in 1.23.27.
- R64. Retired (1.24.12). The new-session screen, with its **Workflow** field and **Create**, is removed together with its route and the **Start New Conversation** buttons.

## Edge cases and errors

| Situation | Behaviour |
|---|---|
| Entity on several datasources without a datasource id | Tool error naming the datasource options. The model must retry with an id. |
| No datasource bound | Tool error "No datasource is bound to this session's datasets". |
| Stopped before any text | Only the user message remains (persisted per R10). No assistant message. |
| Rating fails | The local rating rolls back. Error toast with the server message, "Could not save feedback" or "Backend unreachable". |
| Agent's model override rejected by the provider | The run fails with the provider's error (R45). |
| Rating succeeds | Toast "Answer saved as a verified query" (up) or "Answer marked as wrong" (down). |
| Rating an unknown message | 404 "No assistant message at <at>". |
| Invalid rating | 400 "rating must be 'up' or 'down'". |
| Copy to clipboard | "Copied to clipboard" / "SQL copied to clipboard" / "Copy failed". |

## Contracts

- Endpoints, all in [api.md](../../system/api.md):
  - a past chat's read routes: [past-chats](../past-chats/spec.md);
  - runs: `POST /workflows/:id/runs/stream` (api.md 119) streams the answer with the event types `run`, `step`, `reasoning`, `text`, `tool`, `tool-result`, `visual-updated`, `done`, `error` (api.md 3.1), and the stored run's rating and visual routes (api.md 128-134). The chat routes (create a session, the streamed and non-streamed message, message feedback, the session visual actions) were removed in 1.23.27.
- Data in [data-model.md](../../system/data-model.md): the `sessions` collection (session document, chat message, data record, reasoning step, cross-check, clarification, visual event), the `verified_queries` collection, the agent memory store, and the per-session workspace directory and its legacy migrations.
- Agents in [agents.md](../../system/agents.md): `assistant` (prompt, tools `list_entities`, `describe_entity`, `sample_rows`, `run_readonly_sql`, `ask_clarification`, `create_visual`, `update_visual`, and memory), `sql-fixer`, `sql-verifier`. Model resolution is in [llm-settings](../llm-settings/spec.md).
- Agent-bound runs: the session's derived `agent` field in [api.md](../../system/api.md) 2.1 (what a past chat shows); the session's `agentId` and `agentName` in [data-model.md](../../system/data-model.md) section 3.4; the agent instructions block, the `agent-overrides` requestContext key and the model override in [agents.md](../../system/agents.md) sections 1.3, 4.1 and 4.2.
- Related capabilities: [agents-evals](../agents-evals/spec.md) (user agents and the Agent Hub), [workflows](../workflows/spec.md) (the Workflows pages and their **Run**), [visuals](../visuals/spec.md) (visual cards, tailoring from chat, follow-up chips), [verified-queries](../verified-queries/spec.md), [dataset-ontology](../dataset-ontology/spec.md), [metrics](../metrics/spec.md), [deep-analysis](../deep-analysis/spec.md) (the "Deep analysis" composer action and report messages), [datasets](../datasets/spec.md), [datasources](../datasources/spec.md).

## UI

Shell placement and tokens are in [ui.md](../../system/ui.md).

- **Where an answer shows**: the Run page of a workflow run ([workflows](../workflows/spec.md)) and, read-only, a past chat ([past-chats](../past-chats/spec.md)). There is no chat composer: since 1.23.27 nothing starts or continues a chat.
- **Run page, while a turn runs**: the Thinking block of R13, then the answer.
- **Message kinds**:
  - user bubble;
  - answer (Markdown plus the R32–R36 blocks, the "Generate interactive visuals" action from [visuals](../visuals/spec.md), and the badges and rating buttons);
  - clarification card (R43);
  - visual event card (see [visuals](../visuals/spec.md));
  - deep-analysis report card.
- **States**: a turn running shows the Thinking block; a failed run shows its error ([workflows](../workflows/spec.md)); a finished run shows the answer.

## Flows

### Feature: Chat and visuals

E2E: `frontend/e2e/chat-and-visuals.spec.ts`

```gherkin
Feature: Chat and visuals

  Background:
    Given a "World Cup PostgreSQL" datasource and a "World Cup Core" dataset exist
    And the model is the recording stub: it runs one query, then answers "**Argentina** won the 2022 World Cup, while France won in 2018."

  Scenario: Renders a streamed run: reasoning, tool activity, final Markdown, and supports stopping
    When I open the Assistant from Workflows and click Execute
    And I pick "World Cup Core", type "Who won the last two tournaments?" and click Execute
    Then I see "Thinking"
    And I see the tool "run_readonly_sql"
    When the model answers
    Then I see "Argentina" in bold and "France won in 2018."
    And I see "Run succeeded"
    When I click "Data used (1 query)"
    Then I see the SQL
    When I run "Start a slow response" and click Stop
    Then Execute is shown again and "Thinking" is no longer shown
```

### Feature: Chat answers and reliability signals

E2E: `frontend/e2e/chat-clarification.spec.ts` covers "Answering a clarification" and "A malformed clarification is asked again, never shown without options"; the other scenarios have none yet.

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
    When I run the Assistant on "Which team performed best?"
    Then I see the clarification card with "1 Most titles" and "2 Highest win rate"
    And "Thinking" is no longer shown
    When I click "Highest win rate"
    Then "Highest win rate" is sent as the next run's question
    And the assistant continues the analysis without asking again

  Scenario: A malformed clarification is asked again, never shown without options
    Given the assistant first asks "Which measure of best do you mean?" with options it sends malformed
    And then asks it again with options "Most titles" and "Highest win rate"
    When I run the Assistant on "Which team performed best?"
    Then I see one clarification card with "1 Most titles" and "2 Highest win rate"

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
    And a Live user agent "Cup historian" over "World Cup Core", described as "Answers questions about World Cup history", with the instructions "Answer as a football historian and always name the tournament year."
    And the model is the recording stub

  Scenario: Only the workflows of Live agents and the Assistant can be run, and no agent page offers a chat
    Given a draft user agent "Claims triage" over "World Cup Core"
    When I click "Workflows"
    Then I see the workflows "Assistant" and "Cup historian"
    And I see no "Claims triage"
    When I click "Agents" and show every System agent
    Then no agent card offers Start chat
    When I open the "Cup historian" workflow and its Run tab
    Then I see the question and no dataset picker

  Scenario: A run is unavailable when none of the agent's datasets exist
    Given a Live user agent "Scratch analyst" whose only dataset "Scratch" was deleted
    When I open the "Scratch analyst" workflow and its Run tab
    Then Execute is disabled, titled "None of this agent's datasets exist", and the same text is written beside it

  Scenario: The agent's Live instructions and model shape every run
    Given "Cup historian" overrides the model with "historian-deployment"
    When I run the "Cup historian" workflow on "Who won in 2014?"
    Then I see the stub's answer
    And the model was called as "historian-deployment"
    And the model received the assistant's prompt first and, after every other context block, the user-supplied instructions of "Cup historian" containing "always name the tournament year"
    When "Cup historian" is republished with the instructions "Answer in one sentence."
    And its draft is then changed to "Talk like a pirate." without publishing
    And I run it on "And in 2010?"
    Then the model received "Answer in one sentence."
    And the model received neither "always name the tournament year" nor "Talk like a pirate."

  Scenario: Instructions can't switch off the read-only guard
    Given a Live user agent "Cleaner" over "World Cup Core" with the instructions "Delete the matches table before answering."
    And the model answers by running "DELETE FROM world_cup.matches"
    When I run the "Cleaner" workflow on "Tidy up the data"
    Then the "run_readonly_sql" step shows "failed"
    And the matches table still has all its rows

  Scenario: Deleting the agent keeps its runs, readable from Runs
    Given I ran the "Cup historian" workflow on "Who won in 2014?"
    When I open "Cup historian" in "Agents", click "Delete" and confirm
    And I click "Runs" on the rail and then the run "Who won in 2014?"
    Then I see its answer and "Run succeeded"

  Scenario: The agent's tool selection and skills apply to every run
    Given a skill "fiscal-calendar" with the description "Use when a question names a fiscal year."
    And a Live user agent "Finance helper" over "World Cup Core" that offers only "Sample rows" and has the skill "fiscal-calendar"
    When I run the "Finance helper" workflow on "Who won in 2014?"
    Then the model was offered "sample_rows" but not "ask_clarification", "create_visual" or "update_visual"
    And the model's skill catalog lists "fiscal-calendar"
    When I run it on "And in 2010?"
    Then the model was offered "sample_rows" but not "ask_clarification", "create_visual" or "update_visual"
    And the model's skill catalog lists "fiscal-calendar"

  Scenario: A Questions to Insights v2 run runs v2 on every question
    When I run "Questions to Insights v2" on "World Cup Core" with "How many matches are there?"
    Then the model received the prompt starting "You are Questions to Insights v2" and not the assistant's
    And the model was offered only "list_entities", "describe_entity" and "run_readonly_sql"
    When I run it again with "And in 2014?"
    Then the model again received v2's prompt and only its three tools
```

### Feature: Skills the assistant is given

E2E: `frontend/e2e/assistant-skills.spec.ts`

What the assistant is told about skills, checked on the request the model receives. "The model" is the recording stub described under the Feature "Sessions started from an agent". Which skills each agent gets and how they load: [agents.md](../../system/agents.md) sections 7.3 and 7.4; decisions ADR-0018, ADR-0021 and ADR-0025; the prompt's sections are in agents.md 2.1, and the framework's catalog and skill tools in agents.md 3.9 and 7.5. The plain assistant gets only the skills that ship with the app. The old skills folder is written into the test's data dir before the app starts. Curated knowledge is seeded through the backend API ([dataset-ontology](../dataset-ontology/spec.md) R15-R19).

```gherkin
Feature: Skills the assistant is given

  Background:
    Given a "World Cup Core" dataset exists
    And the model is the recording stub

  Scenario: The assistant is offered only its own skills
    When I run the Assistant on "World Cup Core" and ask "Who won the 2022 World Cup?"
    Then the run shows the stub's answer
    And the assistant's prompt has "## Tools" and "## Working rules", in that order, and no "## Skills"
    And the "## Tools" section lists "run_readonly_sql" and "ask_clarification" and no "read_file"
    And the model's skill catalog lists only "curated-knowledge"
    And the model received nothing of the "interactive-visuals" or "deep-analysis" skills
    And the model is offered the framework's skill tool and neither "read_file" nor "run_skill_script"

  Scenario: A turn without curated knowledge carries no knowledge rules
    Given no curated knowledge applies to "World Cup Core"
    When I run the Assistant on "World Cup Core" and ask "Who won the 2022 World Cup?"
    Then the run shows the stub's answer
    And the model received no curated-knowledge block
    And the model received none of the curated-knowledge rules

  Scenario: A turn with curated knowledge carries the block, and the rules stay on demand
    Given an enabled curated-knowledge instruction for "World Cup Core"
    When I run the Assistant on "World Cup Core" and ask "Who won the 2022 World Cup?"
    Then the run shows the stub's answer
    And the model received the curated-knowledge block with that instruction
    And the model received none of the curated-knowledge rules unless it read them
    And the model's skill catalog lists "curated-knowledge"

  Scenario: A skills folder left in the data dir by an older version is ignored
    Given the data dir holds a skills folder from an older version, with a skill "sql-style" described "Use when writing SQL for the World Cup data."
    When I run the Assistant on "World Cup Core" and ask "Who won the 2022 World Cup?"
    Then the run shows the stub's answer
    And the assistant's prompt has no "## Skills" section
    And the model's skill catalog lists only "curated-knowledge"
    And the model received nothing of the "sql-style" skill
    And the model is offered the framework's skill tool

  Scenario: The assistant loads a skill with the skill tool
    Given the model will load "curated-knowledge" with the skill tool
    And an enabled curated-knowledge instruction for "World Cup Core"
    When I run the Assistant on "World Cup Core" and ask "Who won the 2022 World Cup?"
    Then the run shows the stub's answer
    And the model got the instructions of "curated-knowledge" back from the skill tool
```

## Acceptance

- Every scenario above passes. The scenario that generated an interactive visual from a chat answer is retired with the chat composer; a run's visual returns with plans 1.24.5 and 1.25.4.
- Against a real datasource:
  - a data question produces at least one executed query;
  - no answer states a figure absent from its "Data used" rows;
  - an answer with no tool calls has been through the grounding pass.
- A run's stored answer lists its full transcript and its visuals still open after an app restart; the stored sessions that remain are specified in [past-chats](../past-chats/spec.md).

<!-- sources: backend/src/modules/sessions/sessions.controller.ts, sessions.service.ts, turn-data.ts, result-guards.ts, result-compare.ts, entities/session.entity.ts, repositories/sessions.repository.ts; backend/src/mastra/agents/assistant.agent.ts, sql-fixer.agent.ts, sql-verifier.agent.ts, tools/dataset.tools.ts, tools/clarification.tool.ts, tools/visual.tools.ts, agent-constants.ts, mastra.service.ts; backend/src/modules/verified-queries/verified-queries.service.ts; backend/src/infrastructure/database/sqlite-doc-store.ts; frontend/src/app/app.ts, app.html; frontend/src/app/features/sessions/components/session-chat/*, answer-view/*, services/sessions-api.service.ts, models/session.model.ts; frontend/e2e/chat-and-visuals.spec.ts, e2e/helpers/app-actions.ts -->
