# Agent answers

An agent answers a business question over one or more datasets. It plans the analysis, writes and runs read-only SQL against the datasets' datasources, and streams back its reasoning, each tool call and a final Markdown answer. Since 1.23.22 the turn is always one run of a workflow, on a temporary run host ([workflows](../workflows/spec.md), [agents.md](../../system/agents.md) 5.14); no chat is started or continued, and the stored sessions of earlier versions open read-only ([past-chats](../past-chats/spec.md)). Every answer shows how it was produced: the queries it ran and why, the rows each returned, the entities it touched, the curated knowledge it was given, and reliability signals (automatic SQL repair, result-quality warnings, a verified-query badge and an optional independent cross-check). Users can trust a number because they can see where it came from. They can stop a run and answer the assistant's clarifying questions.

This spec is what stayed of the former sessions-chat capability when it was split into agent-answers and past-chats (1.23.27). Rule numbers are kept, so older references read; rules about the chat composer and the chat session are retired here or moved to [past-chats](../past-chats/spec.md) (R1–R7, R49, R57, R59, R60, R62, R63, R65, R66).

## Concepts

All terms are defined in [glossary](../../product/glossary.md): **Session**, **Dataset**, **Datasource**, **Entity** (fully-qualified `catalog.schema.table`), **Turn**, **Answer**, **Tool call**, **Data record** (one captured tool result), **Rationale**, **Reasoning trail**, **Interpretation line**, **Clarification**, **Careful mode**, **Cross-check**, **Verified query**, **Ontology item**, **Metric definition**, **Session workspace**, **Agent memory thread**, **Visual** (see [visuals](../visuals/spec.md)), **Deep analysis** (removed 2026-11-12; only old reports remain in stored transcripts).

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
- R28. An empty result SHALL NOT trigger repair. The model is told to verify filters before concluding. A result the connector cut at the requested row limit SHALL be flagged truncated, and the model is told results may be incomplete; a result that lands exactly on the limit with no row dropped SHALL NOT be (when the connector does not say how many rows the statement produced, a full page is flagged).

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
- R32. Under an answer, the chat SHALL show these blocks, each only when non-empty (unless the host shows the query inspector, R67: the coverage line and the query rows of R70 and R71 then replace the first and the last):
  - a collapsible "How I worked this out (N step(s))" list, each step's rationale followed by "N rows" or "failed — <error>";
  - a collapsible "Ontology in context (N)" list (kind, name, dataset or "all datasets", body), with a note that disabled items are never included and that the ontology is edited in the dataset's Ontology tab;
  - the interpretation line;
  - "Data entities" chips;
  - a collapsible "Data used (N query|queries)" list.
- R33. Unless the host shows the query inspector (R67), each entry in "Data used" SHALL show:
  - `<tool> — N row(s)` or `<tool> — failed`;
  - "(truncated)" when clipped;
  - a "Copy SQL" action;
  - the rationale, each warning (with a warning icon), the SQL text and any error.
- R34. The chat SHALL offer "Copy message" on every user message and answer.

### Query inspector

The query inspector (M1-25) shows, for each figure of an answer, which query produced it, and lists the answer's queries with their coverage. Screens and test ids: [ui.md](../../system/ui.md) 4.12.2. Plan: `docs/plans/m1-25-query-inspector.md`.

- R67. A host turns the inspector on with the answer view's `queryInspector` input; the hosts are the Run panel and the run detail page of any workflow run whose answer holds queries ([workflows](../workflows/spec.md) R31). Past chats of any agent are a host too ([past-chats](../past-chats/spec.md) R70); the other hosts (a user agent's Try it) keep R32 and R33 until a later story connects them. With the input off, an answer SHALL render exactly as before.
- R68. Each persisted answer MAY carry `evidence`: one entry per `run_readonly_sql` or `sample_rows` record, failed ones included, in `data` order (`index` = the record's index in `data`). An entry holds the coverage, the statement's own top-level LIMIT, the datasource, the row total before the tool's cap and the cap, and, filled later, the size of each table read and the explanation. Coverage is the first rule that applies, read from the SQL with literals masked, at bracket depth 0: `sample_rows` is `sample`; rows cut by the tool's cap is `partial`; a top-level LIMIT (or `FETCH FIRST n`) that the result reached is `top-n` with an ORDER BY before it and `sample` without; anything else is `whole-table` (a LIMIT that returned fewer rows than it allowed cut nothing). A failed record has no coverage. The facts never reach a model: no agent's request changes.
- R69. In inspector mode each figure of the answer text SHALL carry a numbered source chip (`n` = the record's index + 1, shown as the number alone, `1`, `2`; the word is `Source n` everywhere else) after it, linked in code at render time from the stored rows (at most 200 per record) and never by a model, so it works for every agent and every past answer:
  - the index holds the cells of every record that did not fail: numbers and bigints as they are, strings that read as a number (`1204`, `1,204.5`, `1e3`) once trimmed, and ISO dates (`YYYY-MM-DD…`) as date keys; booleans and other text are skipped, and so is a column that identifies or ranks a row (`id`, `*_id`, `rnk`, `rank`, `rn`, `row_number`);
  - a record that names its `figureColumns` contributes only those columns: the rows behind a readiness finding (roadmap 1.28.11) link a figure through their `matching_rows` or `occurrences` count only, never through their raw cells, which would match the report's scores by chance;
  - the text is read for dates first (`14 Nov 2025`, `November 14, 2025`, `2025-11-14`), consumed whole so their parts never match as numbers; then for numbers (an optional sign and currency sign, digits with or without thousands separators, optional decimals, an optional `%` or scale `k`, `K`, `M`, `bn`, `B`), not glued to a letter, digit or underscore; a bare whole number under 10 is skipped, and so is a whole number the question itself names (`the top 100`, `in 2018`), when the host gives the question;
  - a shown value `t` with `d` decimals and scale `s` matches a cell `c` when `|c/s - t| <= 0.5 x 10^-d`; for a percentage `c x 100` is tried too;
  - a value found in several queries gets one chip: of a query that is not a sample first, then of the query that holds the most figures of the answer, then of the earliest, the card naming the others (`Also in sources 2, 3`); text inside `code`, `pre`, `a`, `th`, `td` and existing chips is skipped, so a table cell never carries a chip (R85), while headings do; in a paragraph, list item or heading only the first figure of each source gets a chip;
  - the chips are added to the already sanitized HTML with DOM APIs only (labels through `textContent`) and the result is then trusted: nothing in the answer text can add markup after the sanitizer;
  - a figure whose only matching queries are samples gets the warning tone and the card line `From a sample: not a reliable figure`;
  - hovering or focusing a chip shows one **card** (`role="tooltip"`, `data-testid="figure-ref-card"`, tied to the chip with `aria-describedby`; a native `title` is not used): `Source 1 · <purpose>` (the rationale, or `Query 1`), a line `<N> rows · <coverage>` (`+` after N when the rows were cut; the coverage chip text when the answer has evidence), the sample warning and `Also in sources 2, 3` when they apply, and `Click to see how it was computed`. Escape hides it, it takes no focus, and the chip's `aria-label` is `Source 1: <purpose>, the source of 1,204`.
- R70. Under the answer, in place of `How I worked this out` and `Data used`, the answer view SHALL show a **coverage line**, only when the answer has `evidence` and at least one query did not fail:
  - every query is fine (`whole-table` or `top-n`): `The whole returns table was read (48,912 rows).`, with two tables `The whole returns (48,912 rows) and products (1,870 rows) tables were read.`; a size is left out while it is unknown, and the sentence is left out when no table is known;
  - a query was cut: `Source 2 was cut at 500 rows, so figures from it may be incomplete.`; several sources cut at the same limit share one sentence, their numbers as ranges: `Sources 4–7 and 9–20 were cut at 200 rows, so figures from them may be incomplete.`;
  - a query is a sample: `Source 1 is a sample of rows, not a ranking: no figure should come from it.`;
  - a query is a page of an earlier result (its evidence has a `view`, R83): `Source 1 shows page 2 of 8 of an earlier result.`, never a cut; a line holding only such pages has the success tone;
  - then the link `Inspect the 2 sources` or `Inspect the source`, which opens the first source.
- R71. The answer view in inspector mode SHALL list one **row** per `data` record: the number chip (`1`), a `·`, the rationale as the title (one line, the full text in the tooltip; `Query <n>` when there is none) and a coverage chip: `Whole table`; `Top 100 after ranking`, which reads `Top 100 of 1,870` once the step counts are verified; `Sample`; `Partial result`; `Failed` (a failed record). A chip or a row SHALL emit `inspectQuery` with the record's index.
- R72. An answer stored before the feature has `data` but no `evidence`: the rows SHALL show without a coverage chip, there SHALL be no coverage line, and the chips of R69 still appear (they need only `data`). The inspector asks the host to build the evidence once when it opens (endpoint 139).
- R73. Opening a query (a chip, a row or the coverage line's link) SHALL show the **query inspector**: a non-modal sheet over the workflow page's canvas column, flush with the Run panel, at most 720 px wide, with the tabs `Step by step`, `Result (<n> rows)` and `SQL`, and the buttons `Download all rows (CSV)`, `Re-run` and `Copy SQL`. The answer stays visible beside it. Focus moves to the close button; Escape closes it and returns focus to the chip or row that opened it; another chip swaps the query shown.
- R74. `Step by step` shows the SQL as a funnel of business steps (`Start from`, `Keep`, `Add`, `Combine`, `Group`, `Count`, `Compute`, `Sort`, `Show`), each with the rows it leaves. The steps are explained by the System agent `query-explainer`, lazily, when a query is first opened; the explanation is stored with the run and never asked twice. A reply that is not usable falls back to steps built by code. The last step, `Show`, is always built by code and says in plain words what a LIMIT or the tool's cap dropped: `(LIMIT 100: only the list is shortened)` for `top-n`, a sample for a LIMIT with no sort, `(the query tool stops at 500 rows: the rest of the result was not read)` for `partial`.
- R75. The size of each table a query reads is counted in code (`SELECT COUNT(*)`, exact) when the evidence is prepared, never when the answer is saved. Row counts per step run only on demand (`Count rows at each step`) and are shown only when they pass these checks: the first step's count equals the table's measured size; every count statement names only tables the original query reads; each returns one finite integer of 0 or more; `sort` and `compute` inherit the previous count, `keep` and `group` cannot increase it; and `min(outerLimit, last count)` equals the rows the query produced. Otherwise no step count is shown, only the start and show counts, and the sheet says `The row counts could not be verified, so they are not shown.`
- R76. The `Result` tab SHALL first show the rows stored with the answer (at most 200) and, when they are fewer than the total, `Showing the first 200 of 1,870 rows. Download all rows for the rest.` Paging, sorting or filtering (R79 to R81) asks the server for the query's full result (api.md 152 and 154, ADR-0050) and shows the page it returns; `Show the answer's rows` goes back to the stored rows. A sample has no full result and offers none of these. **Download all rows (CSV)** builds the file in the browser when the stored rows are the complete result of a `whole-table` query, and otherwise asks the server, which runs the statement again with its LIMIT raised to 50,001 and keeps 50,000 rows.
- R77. **Re-run** SHALL run the same statement again, with no repair, on the datasource it first ran on, and show the result; it SHALL NOT change the stored answer, so the chips keep pointing at the rows the answer was written from. It is offered only for a finished run with a single datasource in scope.
- R79. The `Result` tab SHALL have a pager: `Previous` and `Next` ask the server for the page before or after, with the current filters and sort, and a label reads `Rows 51–100 of 2,034`, `Rows 1–50 of 312 matching` once filtered, and `Rows 1–50 of 50,000+` when the result is capped, with the note `Paging stops at 50,000 rows. Add a filter to narrow the result.` A `top-n` query adds `Paging the full result, not only the top 100 the answer used`.
- R80. Each column header of the `Result` tab SHALL be a button that sorts by that column on the server: a click cycles ascending, descending and none (`aria-sort` on the header), one column at a time, and the view returns to its first page.
- R81. The `Result` tab SHALL let the reader add column filters (`Add filter`: a column, an operator named in words (is, is not, greater than, at least, less than, at most, between, is one of, is not one of, contains, does not contain, starts with, is empty, is not empty) and a value; two for between, a comma-separated list for the list operators, none for the empty operators). Each filter shows as a chip with a remove button, `Clear filters` removes them all, a view with no match says `No rows match these filters.`, and a failed request says `Could not load this page: <message>` with `Retry`. Every change returns to the first page.
- R82. In a query that can be paged, the `Result` tab SHALL offer `Filter in words` (a text box and `Apply`; Enter applies). The words go to the `result-explorer` agent with the view being shown (api.md 153 and 155); the filters, sort and page it returns replace the current ones and the page is requested, and the tab says `Understood as: <what the agent understood>`, plus what it ignored when it left a part out. A request that is not a filter on this result, or that the agent cannot turn into one, says `Could not turn that into a filter: <reason>` and leaves the view as it was. Apply is disabled while the agent answers. A sample offers none of this.
- R83. When the evidence of a query holds a `view` (an `explore_result` record of the assistant), the inspector SHALL open its `Result` tab on that view at once and say `Page 2 of 41 · Country is Brazil · sorted by Goals, high to low`.
- R84. An answer that paged, filtered or sorted an earlier query with `explore_result` (a chat turn, a node chat, Try it or a user agent; [agents.md](../../system/agents.md) 3.15) SHALL link that query through the shared query-inspector layer like any other: its record is the source query (re-run and CSV act on it), its rows are the page, its coverage is `partial` when more rows matched than the page holds, and the inspector opens on the page's view (R83).
- R85. After each table of the answer text whose figures a query holds, the answer view SHALL add one source line (`data-testid="table-source"`, a button): `Source 3 · <purpose> · <N> rows`, which emits `inspectQuery` with that record's index like a chip. When the figures of one table come from several queries the line reads `Sources 1, 3`, each number a button of its own. A table with no matched figure gets no line.
- R78. The explanation, the step counts and the evidence are written to the run's answer under one lock per run, so two writes cannot overwrite each other (this includes the rating of an answer).

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
- R48. Background work (grounding pass, SQL repair, cross-check, visual design) SHALL NOT write into the session's memory thread.

### Retired chat rules

- R50. Retired (1.23.27). The empty chat's welcome block and its starter prompts went with the chat composer.
- R51. Moved to past-chats R66 (the history strip of a transcript; see ../past-chats/spec.md).

### Sessions started from an agent

Agents are defined in [agents-evals](../agents-evals/spec.md) (R43-R52); decision ADR-0008 in [architecture.md](../../system/architecture.md).

- R52. Retired (1.24.12). **Start chat** (on a workflow, never on an agent) created a session from the workflow or its agent. No card, page or button starts a chat now: a workflow runs through its **Run** ([workflows](../workflows/spec.md) R5, R12) and `POST /sessions` with a `workflowId` is refused with `Workflow "<id>" runs on an input` ([api.md](../../system/api.md) 3). `POST /sessions` was removed in 1.23.27 ([api.md](../../system/api.md) 3): no route creates a session, and a run of an agent workflow refuses a missing or unpublished agent with the texts of [workflows](../workflows/spec.md) R12.
- R53. A session started from an agent SHALL keep the datasets it was created with ([past-chats](../past-chats/spec.md) R5). Republishing the agent with other datasets SHALL NOT change them.
- R54. Every assistant call made for a session bound to a user agent that still exists (chat turns and the grounding pass) SHALL apply the agent's **current Live version**:
  - its instructions, when not empty, as a system context block labelled as user-supplied, after every other context block (R24; the block is in [agents.md](../../system/agents.md) section 4.1, and only the grounding pass's own nudge follows it);
  - its model override and reasoning-effort override, when set (R56);
  - its tool selection: only the tools it selects are offered, and the prompt's tool list and working rules match them ([agents.md](../../system/agents.md) 2.1);
  - its skills: the copies taken when it was published, given to the model through the framework's skill catalog and skill tool, from those copies ([agents.md](../../system/agents.md) 7.3).

  Publishing a new version SHALL change the next turn of every session bound to the agent. A draft SHALL never apply to a session. The only exception is the agent editor's draft run, an in-memory run host that runs the draft (agents-evals R60, R61).
- R55. An agent's instructions SHALL NOT relax any rule enforced in code: the read-only SQL guard, dataset scoping (R22), SQL repair (R25-R28), the grounding pass (R19) and the result-quality warnings hold whatever the instructions say. A write statement attempted under an agent's instructions SHALL be rejected by the read-only guard and shown as a failed tool call.
- R56. A model override SHALL name a model or deployment of the configured provider. It SHALL replace the configured model for the assistant's calls only. The SQL fixer, SQL verifier, visual designer, ontology bootstrap and eval judge keep the configured model and their own efforts. A reasoning-effort override SHALL replace the user's setting for the same assistant calls. With no LLM settings saved, the model override SHALL be ignored and the fallback model applies. A model the provider rejects SHALL fail the turn with the provider's error, like any model error (R45).
- R58. Retired (1.23.27). The welcome block of a session bound to an agent went with the chat composer.
- R61. A session bound to a built-in agent (today the Data Readiness Agent and Insights Analyst, R52) SHALL run that agent on every turn, not the assistant: its own prompt, tools, skill and per-turn context ([agents.md](../../system/agents.md) 4.1, 5.1). The assistant-only passes (the grounding pass R19, careful mode and the result-quality warnings) SHALL NOT apply to it. R54-R56 and R59 do not apply; R57 and R58 do, with the built-in agent's name, description and starter questions. Their behaviour is specified in [../data-readiness/spec.md](../data-readiness/spec.md). A session stored with the removed agent `rfp` (2026-11-12) is a plain session now: it runs the assistant if it is ever continued and its stored RFP fields are ignored. **Insights Analyst** (`insights-analyst`, BA-320) is bound the same way but runs on the user's own datasets: a session of an earlier version stored `agentKey: "assistant-v2"` and `agentName: "Questions to Insights v2"` (rewritten to `insights-analyst` and `Insights Analyst` by [data-model](../../system/data-model.md) M16), every turn runs Insights Analyst with its own tools (the four data tools and `ask_clarification`), its on-demand skills, its shipped prompt and the assistant's curated context blocks ([agents.md](../../system/agents.md) 2.11, 4.1), and a v2 turn runs like the other bound agents' turns: no grounding pass and no careful mode. A clarifying question ends a v2 turn with its card, as an assistant turn's does, and the user's pick continues it. A streamed v2 turn is a workflow defined in code (ADR-0034, [agents.md](../../system/agents.md) 5.11) whose steps `Receive question`, `Load catalog`, `Analyse` and `Wrap up` show in the workflow bar ([agent-panel](../agent-panel/spec.md) R8a); the answer streams in the Analyse step exactly as above, and a failed step ends the turn with its error. The chat header and the session chip name the agent as for the other built-in agents (R57). A session bound to a built-in agent runs that agent's workflow (R65): an Answer a Business Question session runs `answer-business-question`, the RFP Builder's `agent:rfp` and the Data Readiness Agent's `agent:data-readiness` ([workflows](../workflows/spec.md) R2, R4). Every streamed turn of any session, plain, bound or started from a user agent, is one run of its workflow ([agents.md](../../system/agents.md) 5.1): a one-step workflow's single step runs the turn above, with the same answer, events, workflow bar and stored message, and nothing else changes. The non-streamed turn was removed in 1.23.27.
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
- Related capabilities: [agents-evals](../agents-evals/spec.md) (user agents and the Agent Hub), [workflows](../workflows/spec.md) (the Workflows pages and their **Run**), [visuals](../visuals/spec.md) (visual cards, tailoring from chat, follow-up chips), [verified-queries](../verified-queries/spec.md), [dataset-ontology](../dataset-ontology/spec.md), [metrics](../metrics/spec.md), [datasets](../datasets/spec.md), [datasources](../datasources/spec.md).

## UI

Shell placement and tokens are in [ui.md](../../system/ui.md).

- **Where an answer shows**: the Run page of a workflow run ([workflows](../workflows/spec.md)) and, read-only, a past chat ([past-chats](../past-chats/spec.md)). There is no chat composer: since 1.23.27 nothing starts or continues a chat.
- **Run page, while a turn runs**: the Thinking block of R13, then the answer.
- **Message kinds**:
  - user bubble;
  - answer (Markdown plus the R32–R36 blocks, the "Generate interactive visuals" action from [visuals](../visuals/spec.md), and the badges and rating buttons);
  - clarification card (R43);
  - visual event card (see [visuals](../visuals/spec.md));
  - deep-analysis report card (legacy: shown on old answers only; Deep analysis was removed 2026-11-12).
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

E2E: none (chats are retired; `frontend/e2e/chat-clarification.spec.ts` was deleted 2026-11-12 with the chat).

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

  Scenario: only Answer a Business Question can be run, and no agent page offers a chat
    Given a draft user agent "Claims triage" over "World Cup Core"
    When I click "Workflows"
    Then I see only the workflow "Answer a Business Question"
    And I see no "Cup historian" and no "Claims triage"
    When I click "Agents" and show every System agent
    Then no agent card offers Start chat

  Scenario: a Answer a Business Question run can't write: the read-only guard rejects a DELETE
    Given the model answers by running "DELETE FROM world_cup.matches"
    When I run "Answer a Business Question" on "Tidy up the data" over "World Cup Core"
    Then the "run_readonly_sql" call shows "failed" with "Only read-only SELECT / WITH queries can be run."
    And the matches table still has all its rows

  Scenario: A Answer a Business Question run runs v2 on every question
    When I run "Answer a Business Question" on "World Cup Core" with "How many matches are there?"
    Then the model received the prompt starting "You are Questions to Insights" and not the assistant's
    And the model was offered only "list_entities", "describe_entity", "sample_rows", "run_readonly_sql", "ask_clarification" and the skill tools "skill", "skill_search" and "skill_read"
    When I run it again with "And in 2014?"
    Then the model again received v2's prompt and only its own tools
```

### Feature: Page, sort and filter a query's result

E2E: `frontend/e2e/query-result-paging.spec.ts`

Feature: Page, sort and filter a query's result (outside a `gherkin` fence: `check-specs` reads one E2E file per capability spec)

- Scenario: I page, sort and filter the full result of an answer query

### Feature: Every workflow whose answer ran queries gets the query inspector

E2E: `frontend/e2e/readiness-sources.spec.ts`

Feature: Every workflow whose answer ran queries gets the query inspector (outside a `gherkin` fence: `check-specs` reads one E2E file per capability spec)

- Scenario: an Assess Data Readiness run with a drill-down query shows its sources and opens the inspector

### Feature: Filter a query's result in words

E2E: `frontend/e2e/query-result-filter-text.spec.ts`

Feature: Filter a query's result in words (outside a `gherkin` fence: `check-specs` reads one E2E file per capability spec)

- Scenario: I filter the result of an answer query by typing what I want

### Feature: Skills the assistant is given

E2E: `frontend/e2e/assistant-skills.spec.ts`

What a Answer a Business Question run is told about skills, checked on the request the model receives. "The model" is the recording stub described under the Feature "Sessions started from an agent". Which skills each agent gets and how they load: [agents.md](../../system/agents.md) sections 7.3 and 7.4; decisions ADR-0018, ADR-0021 and ADR-0025; the prompt's sections are in agents.md 2.1, and the framework's catalog and skill tools in agents.md 3.9 and 7.5. The plain assistant gets only the skills that ship with the app. The old skills folder is written into the test's data dir before the app starts. Curated knowledge is seeded through the backend API ([dataset-ontology](../dataset-ontology/spec.md) R15-R19).

```gherkin
Feature: Skills the assistant is given

  Background:
    Given a "World Cup Core" dataset exists
    And the model is the recording stub

  Scenario: a Answer a Business Question run is offered its built-in skills only, and an old skills folder is ignored
    Given the data dir holds a skills folder from an older version, with a skill "sql-style" described "Use when writing SQL for the World Cup data."
    When I run "Answer a Business Question" and ask "Who won the 2022 World Cup?"
    Then the model's system text names "You are Questions to Insights", has no "## Skills" section, and its skill catalog lists "curated-knowledge", "sql-analysis" and "result-validation"
    And the model is offered the "skill" tool and no "read_file" or "run_skill_script" tool
    And nothing of the "sql-style" skill reaches any model request

```

## Acceptance

- Every scenario above passes. The scenario that generated an interactive visual from a chat answer is retired with the chat composer; a run's visual returns with plans 1.24.5 and 1.25.4.
- Against a real datasource:
  - a data question produces at least one executed query;
  - no answer states a figure absent from its "Data used" rows;
  - an answer with no tool calls has been through the grounding pass.
- A run's stored answer lists its full transcript and its visuals still open after an app restart; the stored sessions that remain are specified in [past-chats](../past-chats/spec.md).

<!-- sources: backend/src/modules/sessions/sessions.controller.ts, sessions.service.ts, turn-data.ts, result-guards.ts, result-compare.ts, entities/session.entity.ts, repositories/sessions.repository.ts; backend/src/mastra/agents/assistant.agent.ts, sql-fixer.agent.ts, sql-verifier.agent.ts, tools/dataset.tools.ts, tools/clarification.tool.ts, tools/visual.tools.ts, agent-constants.ts, mastra.service.ts; backend/src/modules/verified-queries/verified-queries.service.ts; backend/src/infrastructure/database/sqlite-doc-store.ts; frontend/src/app/app.ts, app.html; frontend/src/app/features/sessions/components/session-chat/*, answer-view/*, services/sessions-api.service.ts, models/session.model.ts; frontend/e2e/chat-and-visuals.spec.ts, e2e/helpers/app-actions.ts -->
