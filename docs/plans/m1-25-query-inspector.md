# M1-25 — Query inspector: plan and contract

Roadmap: Milestone 1.25. Epic spec: `specs/epics/M1-25/spec.md`. Working branch: `jhon-buendia-halo/limit-100-query-proposals`. Planned 2026-11-15.

## 1. Summary and decisions

Users of Answer a Business Question could not tell how the agent's queries were built, and distrusted an answer after seeing a `LIMIT 100`. The row cap is applied after the statement ran, but nothing in the UI said so.

End state, confirmed by the user on 2026-11-15:

1. Each figure in an answer carries a reference chip (`Q1`, `Q2`) linking to the query that produced it.
2. Under the answer: a coverage line and one row per query (Q number, the query's rationale, a coverage chip).
3. A chip or a query row opens the **query inspector** for that query, with three tabs: **Step by step** (the SQL as a funnel of business steps with row counts), **Result** and **SQL**, and the buttons Download all rows (CSV), Re-run and Copy SQL.
4. In a host that shows the inspector, it replaces `How I worked this out` and `Data used`.

Decisions (do not reopen):

- **Figures are linked in code**, never by the model, so the pattern works for every agent with no prompt change and no evals.
- **A model explains the steps, lazily**, when the user first opens a query: one new System agent, cached with the stored run. No step is added to any Mastra workflow.
- **Row counts.** The cheap ones are always shown (the size of each table read, the rows the query produced, the rows shown). Exact counts per step run only on demand and are shown only when they pass the checks of section 3f.
- **First delivery: the Run panel of Answer a Business Question.** The layer is shared, so other hosts of the answer view (a user agent's Try it, past chats, the Data Readiness Agent) are connected later as small stories.
- **The new facts do not go on `ToolDataRecord`.** Whole records are fed to models (tool-only synthesis, the visual designer, the eval harness). The facts go in a parallel array, `ChatMessage.evidence`.

## 2. Contract

### 2.1 Types

Committed before any story (wave 0): `backend/src/modules/sessions/query-evidence/query-evidence.types.ts` (framework-free) and its frontend copy `frontend/src/app/shared/query-evidence/query-evidence.model.ts` (which adds `QueryRerunResult`, `QueryEvidenceApi` and the token `QUERY_EVIDENCE_API`). `ChatMessage.evidence?: QueryEvidence[]` exists on both sides: one entry per `run_readonly_sql` or `sample_rows` record, failed ones included, in `data` order.

**Coverage rules** (`coverageOf`, applied in order; it reads only the SQL with literals masked, at bracket depth 0):

1. `sample_rows` is `sample`.
2. Rows cut by the tool's cap is `partial`. "Cut" is `totalRows > rowCount`; for a record stored without `totalRows`, it is `capOf(...) !== null`.
3. The SQL has its own top-level LIMIT (or `FETCH FIRST n`) and `rowCount >= outerLimit`: with an ORDER BY before the LIMIT it is `top-n`, without one it is `sample`.
4. Anything else is `whole-table`: nothing was dropped. This includes a LIMIT that returned fewer rows than it allowed.

A failed record has no coverage.

### 2.2 Endpoints

The highest number in `specs/system/api.md` is 138. The new endpoints are 139 to 143, in section 2.6.3. Story 1.25.1 owns the routes 139, 142 and 143 and writes all five api.md sections. Story 1.25.3 owns the routes 140 and 141.

Rules for all five:

- Errors: `404 "Run \"<id>\" not found"`, `404 "Run \"<id>\" has no answer"`, `400 "Wait for the run to finish"` (the run is `running` or `suspended`), `400 "Query <index> not found in the run's answer"` (an `:index` that is no `evidence[].index`).
- Every write to a run's `answer` goes through one lock per run, so two writes cannot overwrite each other. This includes the existing 128 (rate an answer).

| # | Method and path | Response | Behaviour and errors |
|---|---|---|---|
| 139 | `POST /workflow-runs/:id/answer/evidence` | `201 { ok: true, run }` | Builds `evidence` for an answer stored before this feature (from `data`, with `capOf`). Fills `datasourceKind` and `tables`: one `SELECT COUNT(*)` per distinct table, at most 3 at a time. Called again with nothing missing, it runs no query. A count that fails gives `rows: null, error`, never an HTTP error. |
| 140 | `POST /workflow-runs/:id/answer/queries/:index/explanation` | `201 { ok: true, run }` | Returns the stored explanation when there is one. Otherwise: for `sample_rows`, code builds the steps; for SQL, one call to `query-explainer`. A second request for the same run and index while one is running waits for the same result. `400 "Query <index> has no SQL to explain"` (a failed record). `400 "The query could not be explained: <model error>"`. A reply that is no JSON object is stored with `fallback: true` and answers 201. |
| 141 | `POST /workflow-runs/:id/answer/queries/:index/stage-counts` | `201 { ok: true, run }` | `400 "Explain query <index> first"`. Runs each `countSql` in turn, at most 8. Stores each step's `rows` and `stageCounts`. `unverified` is a stored result, not an error. Called again once verified, it returns the stored result. |
| 142 | `POST /workflow-runs/:id/answer/queries/:index/rerun` | `201 { ok: true, result: QueryRerunResult }` | Runs the same statement again, with no repair, at its `rowLimit`. Nothing is stored. `400 "Query <index> has no SQL to run"`. `400 "Several datasources are in scope for this run; this query cannot be re-run"`. The connector's own 400 otherwise. |
| 143 | `GET /workflow-runs/:id/answer/queries/:index/csv` | `200 text/csv; charset=utf-8`, file `query-<Q>-<first 8 of the run id>.csv` | The checks of 142. Raises the top-level LIMIT to 50 001, or appends `LIMIT 50001` when there is none, and keeps 50 000 rows. Sends `X-Rows-Cut: 50000` when more existed. Header row is the columns; quoting follows RFC 4180. |

### 2.3 The System agent `query-explainer`

| Item | Value |
|---|---|
| Registry key and Mastra id | `query-explainer` (`QUERY_EXPLAINER_AGENT_KEY` in `agent-constants.ts`, added to `SYSTEM_AGENT_KEYS`) |
| Technical name | `Query Explainer` |
| Persona | `Hannah`, job title `Query Explainer`, domain `sql` (check the name is unused) |
| Registered in | the agents map of `mastra/index.ts`, `agent-personas.ts`, and `SHIPPED` in `shipped-agent-prompts.ts` (so its job description can be overridden) |
| Catalogue data | framework-free files only, plus a new framework-free `mastra/agents/query-explainer.prompts.ts` |
| Call | like `analysis-planner` and `answer-writer`: `maxSteps: 1`, `toolChoice: 'none'`, structured output by inline JSON prompt injection, `resolveAgentModel()`, through `MastraService.explainQuery` |
| Evals | none in this delivery: its count statements are checked at run time (3f) |

Its request holds the dialect, the rationale, the tables with their sizes, the columns and the SQL. It never holds result rows.

### 2.4 Test ids

- Answer view, inspector mode: `figure-ref` (a `button.figure-ref` with `data-query-index`), `query-evidence`, `query-coverage-line`, `query-inspect-all`, `query-row-<index>`, `query-coverage-chip` (with `data-coverage`).
- Inspector: `query-inspector`, `query-inspector-position`, `query-inspector-title`, `query-inspector-meta`, `query-inspector-close`, `query-inspector-prev`, `query-inspector-next`, `query-inspector-tab-steps`, `query-inspector-tab-result`, `query-inspector-tab-sql`, `query-funnel`, `query-funnel-step` (with `data-verb` and `data-rows`), `query-count-steps`, `query-counts-unverified`, `query-explain-error`, `query-explain-retry`, `query-result-table`, `query-result-note`, `query-rerun-banner`, `query-sql`, `query-download-csv`, `query-rerun`, `query-copy-sql`.

### 2.5 Copy

- **Figure chip.** `Q1`, `Q2`. `aria-label`: `Open query Q2, the source of 1,204`. A figure whose only match is a sample has the warning tone and the title `From a sample: not a reliable figure`.
- **Coverage chips.** `Whole table` (success); `Top 100 after ranking`, which reads `Top 100 of 1,870` once the counts are verified (info); `Sample` and `Partial result` (warning); `Failed` (danger).
- **Coverage line.**
  - Every query is fine: `The whole returns table was read (48,912 rows).` With two tables: `The whole returns (48,912 rows) and products (1,870 rows) tables were read.` The size in brackets is left out while it is unknown.
  - A query was cut: `Q2 was cut at 500 rows, so figures from it may be incomplete.`
  - A query is a sample: `Q1 is a sample of rows, not a ranking: no figure should come from it.`
  - The link after it reads `Inspect the 2 queries` or `Inspect the query` and opens the first query.
- **Query row.** The Q chip, the rationale as the title (one line, the full text in `title`), the coverage chip. A record without a rationale reads `Query <n>`.
- **Inspector header.** `Query 2 of 2`; the title is the rationale; the meta line is `PostgreSQL · 100 rows` (`Databricks SQL`, `REST API`).
- **Tabs.** `Step by step`, `Result (100 rows)`, `SQL`.
- **Step labels.** `Start from`, `Keep`, `Add`, `Combine`, `Group`, `Count`, `Compute`, `Sort`, `Show`. Counts read `48,912 rows` or `1,870 products`.
- **The Show step**, always built by code:

  | Coverage | Text | Note |
  |---|---|---|
  | top-n | `Show the first 100` | `(LIMIT 100: only the list is shortened)` |
  | sample (a LIMIT with no sort) | `Show 100 rows in no set order` | `(LIMIT 100 without a sort: a sample, not the top 100)` |
  | partial | `Show the first 500` | `(the query tool stops at 500 rows: the rest of the result was not read)` |
  | whole-table | `Show all 37 rows` | none |
  | the `sample_rows` tool | `Show 10 sample rows` | `(a sample to see what the data looks like: no figure should come from it)` |

  Its count reads `100 of 1,870` only once the counts are verified; before that, `100 rows`.
- **Step by step states.** Loading: `Reading the query…`. Error: `The steps could not be explained: <error>. The SQL tab shows the query.` with `Try again`. The count button: `Count rows at each step`, then `Counting rows…`. Counts that fail the check: `The row counts could not be verified, so they are not shown.`
- **Result tab notes.** `Showing the first 200 of 1,870 rows. Download all rows for the rest.` After a re-run: `Re-run at 14:32: 100 rows. The answer was written from 98 rows.` with `Show the answer's rows`.
- **Buttons.** `Download all 1,870 rows (CSV)`, or `Download all rows (CSV)` when the total is unknown; `Re-run` (`Running…`); `Copy SQL` (toast `SQL copied to clipboard`). Close: `Close query inspector`. Navigation: `Previous query`, `Next query`.

Where this departs from the wireframe: the header has no short title and no duration (neither is recorded); the coverage line leaves out the rows that fall in the period (that needs the step counts, and shows in the funnel once they run); `Top 100 of 1,870` appears only after verified counts.

## 3. Decisions on the hard parts

### 3a. Linking figures to queries (frontend, at render time, not stored)

A pure function of `data` (the stored rows, at most 200 per record) and the answer text, so it works for every past answer and every agent.

- **Index.** Every record that did not fail. A column that identifies or ranks a row (`id`, `*_id`, `rnk`, `rank`, `rn`, `row_number`) is left out: its values are not figures, and a small rank matches too many numbers. Cells that are numbers or bigints as they are. Strings are parsed after trimming, when they match `^-?\d+(\.\d+)?([eE][+-]?\d+)?$` or `^-?\d{1,3}(,\d{3})+(\.\d+)?$`. ISO dates (`YYYY-MM-DD…`) become a date key. Booleans and other text are skipped.
- **Reading the text.** Dates are read first and consumed whole (`14 Nov 2025`, `November 14, 2025`, `2025-11-14`), so their parts never match as numbers. Then numbers: an optional sign, an optional currency sign, digits with or without thousands separators, optional decimals, an optional `%` or scale (`k`, `K`, `M`, `bn`, `B`), not glued to a letter, digit or underscore on either side. A bare whole number under 10 is skipped. So is a whole number the question itself names (`the top 100`), when the host passes the question: the answer is echoing it, not reporting a result.
- **Match.** A text value `t` shown with `d` decimals and scale `s` matches a cell `c` when `|c/s − t| ≤ 0.5·10^-d`. For a percentage, `c × 100` is tried too.
- **A value in several queries** gets one chip (amended after the first look at the real app, where two chips per figure crowded a table): a query that is not a sample first, then the query that holds the most figures of the answer, then the earliest. The chip's title names the others (`Also in Q2`).
- **Placement.** Text inside `code`, `pre`, `a`, `th` and existing chips is skipped. Headings and table cells (`td`) get chips.
- **Rendering.** `renderMarkdown` (the pipe's sanitized string, unchanged), then `linkFigures`: it parses the string into a `<template>`, walks the text nodes, and builds `<sup><button type="button" class="figure-ref" data-query-index>` with DOM APIs (labels set with `textContent`, never assembled as a string). The result is trusted with `bypassSecurityTrustHtml`: only code-made integers and labels are added after sanitizing.
- **Clicks.** One click handler on the prose element (`closest('button.figure-ref')`).

### 3b. Where the inspector opens on the workflow page

A non-modal sheet (`role="dialog"`, `aria-modal="false"`) over the canvas column, flush with the Run panel's left edge, at most 720 px wide, covering the canvas and the Logs. The answer stays visible beside it. If the Run panel is maximized it is restored first. Focus moves to the close button; Escape closes it and returns focus to the chip or row that opened it; opening another chip swaps the query shown. Later, in the sessions chat, the same component is a view of the app's right panel with a session adapter on `QUERY_EVIDENCE_API`.

### 3c. Storage, row copies and download

- The explanation is stored at `run.answer.evidence[k].explanation`, written under the run's lock (re-read the run, patch one entry, write `answer`).
- The Result tab always uses `answer.data[index].rows` (at most 200).
- The CSV is built in the browser when the stored rows are the complete result (`rows.length === (totalRows ?? rowCount)` and the coverage is `whole-table`). Otherwise Download all rows runs the query again through 143.
- Re-run (142) never overwrites what was stored: the chips keep pointing at the rows the answer was written from.

### 3d. Table sizes

The same `SELECT COUNT(*) AS n FROM <entity>` for PostgreSQL, Databricks and REST, through `DatasourcesService.runReadOnlySql` (the connector's guard and PostgreSQL's READ ONLY transaction apply). Exact, never an estimate, because 3f needs equality. The tables are the catalog entities whose name the SQL contains (`tablesOfQuery`, as `queriedTables` does, also accepting PostgreSQL `schema.table`; `queriedTables` itself is not changed). Sizes are computed through 139, not when the answer is saved, so no answer gets slower.

### 3e. Re-run

The rules of the visual data refresh (133): the run is finished, only the run's datasets, a single datasource. Two differences: it uses `evidence.datasourceId` when present (after checking it belongs to the run's datasets), and it calls `DatasourcesService.runReadOnlySql` directly, with no repair, because a re-run must execute the same statement.

### 3f. The checks on the step counts (`checkStageCounts`)

- The start step also carries a `countSql`; its count must equal the table size measured in code.
- Every `countSql` names only tables the original query reads; otherwise it is never run and the result is unverified.
- Each statement returns one finite integer of 0 or more.
- `sort` and `compute` inherit the previous count. `keep` and `group` cannot increase it. `add` and `combine` may.
- `min(outerLimit ?? ∞, lastCount)` must equal `totalRows ?? (truncated ? undefined : rowCount)`.
- If any rule fails, no step count is stored (except the cheap start and show counts), `status` is `unverified` and the reason is stored.

`explanationOf` reads the model's reply leniently: an unknown verb becomes `compute`; a `show` or limit step from the model is dropped (code adds the Show step); a `start` is put first when missing; at most 8 steps; text at most 160 characters; a `countSql` is dropped when it does not start with `select` or `with`, contains `;`, or is over 4 000 characters.

## 4. Stories, waves and what breaks

| Wave | Story | Model | Runs with |
|---|---|---|---|
| 0 | The lead commits the types, this plan, the roadmap stories and the epic spec | lead | — |
| 1 | 1.25.1 backend evidence layer | Opus (the turn path every agent uses, and the connectors) | 1.25.2 |
| 1 | 1.25.2 answer view: chips, coverage line and query rows | Sonnet | 1.25.1 |
| 2 | 1.25.3 the query explainer and the step counts, after 1.25.1 | Sonnet | 1.25.4 |
| 2 | 1.25.4 the inspector and its Run panel host, after 1.25.2 | Sonnet | 1.25.3 |

On a merge conflict in `specs/INDEX.md`, regenerate it with `node scripts/spec-index.mjs`; never merge it by hand.

Assertions the change makes false (fixed by the story named):

| File | Assertion | Story |
|---|---|---|
| `frontend/e2e/workflow-runs.spec.ts` (about line 209) | `Data used (1 query)` and its `pre` | 1.25.4 |
| `frontend/e2e/agent-sessions.spec.ts` (151-158) | `Data used (2 queries)`, `run_readonly_sql — failed` | 1.25.4 |
| `frontend/e2e/world-cup-workflow.spec.ts` (54) | `Data used (1 query)` | 1.25.4 |
| `frontend/e2e/chat-and-visuals.spec.ts` (89-91) | `Data used (1 query)` | 1.25.4 |
| `frontend/e2e/agent-hub.spec.ts` (166) | the sql cards gain `query-explainer` | 1.25.3 (edit only; the lead runs it) |
| `backend/src/mastra/agent-personas.spec.ts` (38-44) | the sql personas | 1.25.3 |

Spec text that becomes false: `specs/system/ui.md` 4.4b (the answer sentence) and 4.12; `specs/capabilities/agent-answers/spec.md` R32, R33 and their Gherkin; `specs/capabilities/datasources/spec.md` (`Data used (1 query)`); `specs/capabilities/workflows/spec.md` R13; the stale note in `specs/system/agents.md` 5.11 that calls the two step agents unregistered. `visuals` R23 stays true.

What to cut first if the delivery must shrink: the step counts (141); date matching (keep consuming date tokens); Re-run (142); the server CSV (143); table sizes in 139.

## 1.25.1 — Backend evidence layer

1. **Row totals from the connectors.** `runReadOnlySql` of the three connectors (`postgres.connector.ts`, `databricks.connector.ts`, `rest.connector.ts`) sets `totalRows` to the row count before it slices. `QueryResult` (`entities/datasource.entity.ts`) gets `totalRows?`. `runReadOnlySql` gets an optional `maxRows` (the default clamp stays 500; 143 passes 50 001), through `connector.ts` and `datasources.service.ts`. `SqlRunResult` (`tool-services.ts`) gets `totalRows?`.
2. **Facts beside the tool result** (`dataset.tools.ts`, both tools): remove `totalRows` from the result before returning it, so the model's input stays byte-identical, and write `{ datasourceId, totalRows, rowLimit }` into a Map held in the request context (`QUERY_FACTS_CONTEXT_KEY`, defined in `tool-services.ts`), keyed by the tool call id, or by the SQL text when there is none.
3. **Capture in the turn engine** (`turn-engine.ts`): a fresh Map per turn next to `TURN_RECORDS_CONTEXT_KEY`; at capture, remember each record's facts; at persist (the clarification branch and the answer branch), add `evidence: evidenceOf(data, facts)`. `toolDataRecord` in `turn-data.ts` does not change.
4. **Pure modules** in `backend/src/modules/sessions/query-evidence/`, each with a spec: `query-coverage.ts` (`coverageOf`, `outerLimitOf`, `withExportLimit`, over `maskLiterals`, which `result-guards.ts` now exports with `capOf`, behaviour unchanged); `query-tables.ts` (`tablesOfQuery`, `countStatement(entity, kind)`); `query-evidence.ts` (`evidenceOf`, `csvOf`).
5. **`QueryEvidenceService`** (`query-evidence.service.ts`, exported from `sessions.module.ts`): `prepare`, `datasourceFor`, `rerun`, `exportRows`, and `countRows(datasourceId, sql)` for 1.25.3. Queries go through `DatasourcesService.runReadOnlySql` directly.
6. **Runs**: in `workflow-runs.service.ts` a lock per run (`withAnswerLock(id, fn)`), `patchEvidence(id, index, patch)`, the existing 128 routed through the lock, then `prepareEvidence`, `rerunQuery`, `queryCsv`; in `workflow-runs.controller.ts` the routes 139, 142 and 143.

First failing test, `query-coverage.spec.ts`: `… ORDER BY n DESC LIMIT 100` with 100 rows is `top-n` with `outerLimit` 100; the same without ORDER BY is `sample`; a LIMIT only inside a CTE with 500 of 1 870 rows is `partial`; `LIMIT 100` returning 37 rows is `whole-table`; a `'LIMIT 5'` inside a literal is ignored; `sample_rows` is `sample`. Second: the result of `run_readonly_sql` has no `totalRows` key.

Specs: `api.md` (the 2.6.3 table, the five sections 139 to 143, and `answer.evidence` in 3.6); `data-model.md` (`evidence` on ChatMessage and a section for `QueryEvidence`); `agents.md` (3.3 and 3.4: the side channel, `totalRows` never reaches the model; 5.7: persist derives `evidence`; correct the stale note in 5.11).

Must not touch: the `answer-business-question.*` files, any prompt or tool description, `ToolDataRecord`, what `inspectResult` returns, the frontend.

## 1.25.2 — Answer view: figure chips, coverage line and query rows

- New in `frontend/src/app/shared/query-evidence/`: `figure-refs.ts` (`figureIndex`, `findFigures`, `linkFigures`, per 3a); `query-labels.ts` (`queryRows`, `coverageLine`, the chip labels of 2.5); the component `query-evidence-summary/` (the coverage line and the rows; output `inspect: number`).
- `shared/pipes/markdown.pipe.ts`: export `renderMarkdown(value): string` (the sanitized string); the pipe calls it and its output does not change.
- `answer-view.ts` and `.html`: a new input `queryInspector = input(false)` and output `inspectQuery = output<number>()` (the record index). In inspector mode the body comes from a `computed` safe-HTML value and clicks are caught on the prose element; the `reasoningTrail` outlet and the `Data used` details are replaced by the summary, in the answer and the clarification branches alike. Data entities and the interpretation line stay. With `queryInspector` false everything renders exactly as today.
- `styles.scss`: `.prose-dark .figure-ref` and `.figure-ref--sample`, with tokens that exist in `tokens.css`.

When `evidence` is missing (an answer stored before the feature, until 139 has run), the summary derives each query's coverage as unknown: it shows the rows with no coverage chip and no coverage line.

First failing test, `figure-refs.spec.ts`: `1,204` matches the cell `"1204"`; `1.2k` matches 1204; `12.5%` matches 0.125 and `"12.50"`; `14 Nov 2025` matches `2025-11-14T00:00` and its `14` alone does not; `7 products` gets no chip; a number inside `code` or `th` gets no chip; a value found in Q1 and Q2 gets two chips.

Specs: `specs/capabilities/agent-answers/spec.md` gets a subsection `### Query inspector` holding all the feature's rules, written from this contract (take the next free rule numbers), and R32 and R33 gain "unless the host shows the query inspector"; `specs/system/ui.md` 4.12 gets a note and a new section for the query inspector (the whole component: tabs, copy, test ids), which 1.25.4 implements.

Must not touch: `features/workflows/`, the backend.

## 1.25.3 — The query explainer and the step counts

- Creates `mastra/agents/query-explainer.agent.ts` (the `Agent` and `explainQueryWithModel`) and the framework-free `mastra/agents/query-explainer.prompts.ts` (`QUERY_EXPLAINER_INSTRUCTIONS`, the reply schema, `explainRequest(record, evidence)`, `explanationOf`, `showStep(evidence)`, `fallbackExplanation`, `checkStageCounts`, per 2.3, 2.5 and 3f).
- Changes `agent-constants.ts`, `agent-personas.ts`, `shipped-agent-prompts.ts`, `mastra/index.ts`, `mastra.service.ts` (`explainQuery`), and `workflow-runs.service.ts` and `.controller.ts` (the routes 140 and 141, on 1.25.1's lock, `patchEvidence` and `QueryEvidenceService.countRows`).

First failing test: `checkStageCounts` with 48 912 → 11 306 → 11 306 → 1 870, a limit of 100 and `totalRows` 100 is verified; a wrong start count, a wrong final count and a `keep` step with no `countSql` are each unverified. `explanationOf` drops a `show` step the model wrote.

Tests to update: `backend/src/mastra/agent-personas.spec.ts` (the sql personas) and the sql cards of `frontend/e2e/agent-hub.spec.ts` (edit only).

Specs: `agents.md` (a row in the 1.1 table, a new section for `query-explainer` in 2, and its shipped wording in an appendix).

Must not touch: the frontend's source, the Answer a Business Question workflow and its prompts, 1.25.1's pure modules except through their exports.

## 1.25.4 — The inspector and its Run panel host

- Creates `shared/query-evidence/query-inspector/` (inputs `message` and `index`; it uses `QUERY_EVIDENCE_API`; outputs `close` and `navigate`; tabs as the node dialog's segmented tablist), `shared/query-evidence/rows-csv.ts` (a CSV from stored rows and saving a blob), and `features/workflows/services/run-query-evidence-api.ts` (the adapter: it calls the API and applies the returned run to the designer).
- Changes `workflow-runs-api.service.ts` (methods for 139 to 143), `workflow-designer.service.ts` (`openQueryIndex`, `openQuery`, `closeQuery`; `prepare()` once per run id when a stored answer is shown; `runDockMaximized`, moved from `workflow-run-dock.ts`), `workflow-run-dock.ts`, `workflow-detail.html` and `.ts` (the sheet of 3b and the provider of the token), and `workflow-run-chat.html` (`[queryInspector]` true for a run of Answer a Business Question, by the catalogue's id constant and not a string written in the template, and `(inspectQuery)`).
- Fixes the Playwright assertions listed in section 4 and writes the story's main scenario.

First failing test: the designer's `openQuery` sets the index, and showing a stored answer of Answer a Business Question calls `prepare` once per run. Then the inspector: the Show step reads `100 of 1,870` only when `stageCounts.status` is `verified`.

Specs: `ui.md` 4.4b (the sheet, and the sentence about the answer's blocks); `specs/capabilities/workflows/spec.md` (amend R13, add a rule for the inspector); `specs/capabilities/datasources/spec.md` (the `Data used` line).

Must not touch: the backend.

## 1.25.6 — An answer that lists more than 50 rows shows all of them

Approach B of three (2026-11-15): the code writes the table. The workflow's shape, steps and agents do not change.

- **Rows an attempt passes on.** `ATTEMPT_ROWS_CAP` (`sessions/turn/turn-workflow.ts`) goes from 50 to 200, the rows a data record keeps. The schema text of `analyseQuerySchema.rows` says so; the contract hash and its snapshot change on purpose. Check that a step whose data grows past `STEP_OUTPUT_CAP` still shows in the Logs as truncated data, as today.
- **What Write answer reads.** `ANSWER_ROWS_CAP` stays 50. `queryLines` says how many rows the result has and how many are shown (`102 rows, the first 50 shown`), so the writer never reports rows as missing.
- **The marker.** The instructions (`WRITE_ANSWER_INSTRUCTIONS`, Appendix F) gain one rule, the last of the list: when a query's line says only its first rows are shown and the answer must list that result, write no table for it (first written as "more than 10 rows"; narrowed after the evals, see the note below); put, alone on a line where the table goes, `[[rows:<n>]]` (`n` = the query's number in the request), optionally with the columns to show and their headers, `[[rows:2 | name=Driver, total_race_starts=Race starts]]`. A result the request shows whole is written as before. Never say that rows are missing or were cut because only some were shown.
- **Expansion** (`expandRowTables(answer, queries)`, pure, in `answer-business-question.steps.ts`, called at the end of `writeAnswerWithModel` so the turn engine and the eval target share it): each marker line becomes a Markdown table of the query's rows (at most 200): the named columns in that order with their headers, else every column with its name made readable (`total_race_starts` reads `Total race starts`); cells as stored, with `|` and line breaks escaped and null as an empty cell. When the result has more rows than the table (`rowCount` over the rows held), a line follows: `Showing the first 200 of 1,870 rows. Open the query to download all of them.` A marker naming a query that does not exist, failed or has no rows is removed. A column name the result does not have is ignored; if none is left, every column is shown. The headline is never expanded.
- **Streaming.** The streamed text never shows a marker: a complete marker is left out and an unfinished `[[` is held back until it closes or proves not to be a marker. The stored answer is the expanded one.

First failing test: `expandRowTables` turns `[[rows:1]]` into a table of 102 rows from a query holding 102; with `| name=Driver` it shows that column under `Driver`; with 200 rows held of 1 870 it adds the note; an unknown query number, a failed query and an empty result remove the line; a `|` in a cell is escaped. Then: the request reads `102 rows, the first 50 shown`; the streamed deltas of an answer holding a marker never contain `[[`.

Note from the evals (2026-11-15, `claude-sonnet-5-5`, case `v2-ranking-ties-top-scorers-2018`, an 18-row result): with the rule worded "more than 10 rows" and placed in the middle of the rules, the answer carried a plan assumption no query had checked (how penalty shootouts count) in 7 of 12 runs, against 1 of 9 on the base build, and the judge failed 3 of 12 against 1 of 9. The rule now fires only on the request's own cue (`the first 50 shown`), and sits last, so an answer over a result the writer sees whole is written as before.

## 1.25.7 — Validate fails an attempt that rests on a sample

- A fourth failing check in `validateAttempt`, after `No result cut at its row limit`: `No answer from a sample`. It fails when a successful query's coverage is `sample` (`coverageOf` of `sessions/query-evidence/query-coverage.ts`, framework-free: its own top-level LIMIT was reached and nothing sorts the rows before it) and no later successful query is anything else. Detail when it fails: `<n> result(s) kept an arbitrary sample of rows (a LIMIT with no sort) and no later query read the whole data.`; when it passes: `No result the answer reads is an arbitrary sample.`
- `ok` is the first four checks passing; `Measures covered` stays a warning.
- The retry block and Write answer's findings carry it as they carry the others.
- A question that asks for examples (`show me 5 orders`) fails the check once and is answered after the second attempt, with the finding as a caveat: accepted.

Note, not in scope: the SQL bridge (`sessions/turn/sql-checks.ts`) sets `truncated` when a result lands exactly on the tool's row limit, so a `LIMIT 100` that returns 100 rows under the default limit of 100 is told `row limit reached` although nothing was cut. `totalRows` now tells the two apart. Fixing it changes a tool result every agent's model reads, so it needs the evals of each agent that uses the tool.

First failing test: `LIMIT 50` with no ORDER BY returning 50 rows, alone, fails the check; followed by an aggregate that succeeds, it passes; `ORDER BY … LIMIT 50` passes; a failed sample query does not count.
