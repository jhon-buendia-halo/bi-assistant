# M1-27 — Explore a query's full result: page, filter, sort

Plan and contract for [Milestone 1.27](../../roadmap.md) ([epic spec](../../specs/epics/M1-27/spec.md), ADR-0049). Approach B, picked by the user on 2026-11-15 among three (A: shared layer only, no agent; C: an interactive suspend/resume workflow): the paging and filter engine lives in the shared query-evidence layer, so every host of the query inspector gets it, and an auxiliary agent, `result-explorer`, turns the user's words into a structured view. Scope: the results of agents' queries only; raw dataset browsing stays out (datasets R22).

Decisions taken with the user (2026-11-15, "Sí, todas"):

- Default order: the stored query's top-level `ORDER BY` when all its keys are output column names or ordinals, applied on the outer query; else the first column. Every remaining column ordinal follows as a tie-breaker.
- A Databricks warehouse that refuses parameter markers answers 400 `This warehouse does not support query parameters; filtering is unavailable`. Values are never inlined.
- The CSV download stays the source query's rows (no CSV of a filtered view in v1).
- `explore_result` is always given to every agent with the dataset tools, like `run_readonly_sql` (never optional).
- `result-explorer` sees at most 5 distinct stored values per column, never whole rows or SQL.
- Node chats: the run's answer queries, plus earlier chat queries when their SQL is known.

Facts the design rests on (checked at `a07cb4e5`):

- Chats are read-only since 1.23.27. A follow-up is a new workflow run with `context.fromRunId`; its host session gets the earlier question and answer as text only (`RunHostSpec.context`). The explore path is handed the earlier run's queries as `contextQueries`.
- `RunEvidenceApi` serves workflow-detail, run-detail and Try it (`features/agents/services/try-it-inspector.ts`); `SessionQueryEvidenceApi` is the fourth host. Changing those two classes covers every host.
- `assertReadOnlySql` scans the whole statement with `FORBIDDEN_SQL`, quoted identifiers included, so the wrapper is built by the connector, which checks only the stored SQL.

## 0. Contract

### 0.1 Types

`backend/src/modules/datasources/connectors/paged-sql.types.ts` (no framework import) is the source; the frontend copies the wire types into `frontend/src/app/shared/query-evidence/query-evidence.model.ts`.

Additional type changes, each owned by one story:

- `DatasourceConnector.runPagedSql?(config, stmt: PagedStatement): Promise<PagedRows>` and `DatasourcesService.runPagedSql(id, stmt)` are in the contract commit; 1.27.1 implements the method on every connector and makes it required. An empty `stmt.sort` means the default order, resolved by the connector (1 below, 7); `PageResult.view.sort` echoes the request, `[]` for the default.
- `QueryEvidence.view?: ResultView` (backend type and frontend copy), set only on `explore_result` records, carried on evidence, never on `ToolDataRecord` (records are fed to models) (1.27.7; the frontend reads it in 1.27.5).
- `QueryFacts.view?: ResultView`; `EVIDENCE_TOOLS` gains `'explore_result'` (1.27.7).
- Frontend `QueryEvidenceApi` gains `page(index, request: PageRequest): Observable<PageResult>` (1.27.3) and `interpretFilter(index, text, view: ResultView | null): Observable<FilterInterpretation>` (1.27.5). Every host implements both.

### 0.2 Routes (api.md 151–154)

All `POST`, store nothing, answer `201`, the same errors as 142/147 plus the ones below.

| # | Route | Body → success | Story |
|---|---|---|---|
| 151 | `POST /workflow-runs/:id/answer/queries/:index/page` | `PageRequest` → `{ ok: true, result: PageResult }` | 1.27.2 |
| 152 | `POST /workflow-runs/:id/answer/queries/:index/interpret-filter` | `{ text: string, view?: ResultView }` → `{ ok: true, interpretation: FilterInterpretation }` | 1.27.4 |
| 153 | `POST /sessions/:id/messages/:message/answer/queries/:index/page` | as 151 | 1.27.2 |
| 154 | `POST /sessions/:id/messages/:message/answer/queries/:index/interpret-filter` | as 152 | 1.27.4 |

Errors (400 unless stated): `Query <index> is a sample; it has no full result to page` · `Unknown column "<c>"` · `Column "<c>" appears more than once in the result; it cannot be filtered or sorted` · `Filter on <c>: <op> needs a value` · `Page <n> is past the 50,000-row limit` · `This warehouse does not support query parameters; filtering is unavailable`. 152/154 only: `That asks a new question, not a filter on this result` · `The filter could not be understood: <model error>`. Draft runs (Try it) answer 404 as they already do. Each story updates the api.md header counts for the handlers it adds.

### 0.3 `result-explorer` reply

Zod schema in `backend/src/mastra/agents/result-explorer.prompts.ts` (no framework import):

```ts
{ action: 'explore' | 'new-question',
  query: number | null,     // 1-based Q of the candidates listed; null = Q1 / not applicable
  filters: { column: string; op: FilterOp; value: FilterValue | null; valueTo: FilterValue | null; values: FilterValue[] | null }[], // the COMPLETE new filter set
  sort: { column: string; direction: 'asc' | 'desc' }[],
  page: { move: 'keep' | 'first' | 'next' | 'previous' | 'last' | 'to'; to: number | null },
  understood: string }       // one line, business words
```

Request: the user's words, the current `ResultView` and `pageCount`, and the candidates (Q label, rationale, columns with their kind and up to 5 distinct stored values each). Pure code `specOf(reply, candidates, current) → FilterInterpretation`: columns matched exactly then case-insensitively, values coerced by kind, unknown columns to `rejected`, `move` resolved to an absolute page clamped to `pageCount`.

### 0.4 `explore_result` tool (1.27.7)

```ts
input: { query?: string      // the SQL exactly as an earlier run_readonly_sql ran it; omitted = the latest query
         filterText?: string // the user's own words; interpreted by result-explorer
         filters?: FilterSpec[]; sort?: SortSpec[]; page?: number /* 1–1000 */; pageSize?: number /* 1–100 */;
         rationale: string }
```

Explicit `filters`/`sort`/`page` override what `filterText` produced. Full result (captured): `{ sourceSql, datasourceId, view, columns, rows, page, pageCount, matchedRows, capped, understood }`; `toModelOutput` drops `sourceSql`, `datasourceId`, `view`. No match → `{ error: "Unknown query. Earlier queries: Q1 <first 80 chars>; Q2 …" }` (match on whitespace-collapsed SQL without a trailing `;`).

### 0.5 Inspector: test ids and copy (Result tab)

- Pager `query-result-pager`: `query-result-prev-page` (aria-label `Previous page`, text `Previous`), `query-result-next-page` (`Next page` / `Next`), `query-result-page-label` (`Rows 51–100 of 2,034` · filtered: `Rows 1–50 of 312 matching` · capped: `Rows 1–50 of 50,000+`), `query-result-cap-note` (`Paging stops at 50,000 rows. Add a filter to narrow the result.`).
- Sort: each `th` holds a `button` `query-result-sort` with `aria-sort`; a click cycles none → ascending → descending → none.
- Column filters: `query-filter-add` (`Add filter`) opens a row with `query-filter-column` (select), `query-filter-op` (select), `query-filter-value` (input; `query-filter-value-to` for between), `query-filter-apply` (`Apply`). Each active filter is a chip `query-filter-chip` (`Country is Brazil`) with `query-filter-chip-remove` (aria-label `Remove filter Country is Brazil`); `query-filter-clear` (`Clear filters`).
- Operator labels: is, is not, greater than, at least, less than, at most, between, is one of, is not one of, contains, does not contain, starts with, is empty, is not empty.
- Filter in words (1.27.5): input `query-filter-text`, label `Filter in words`, placeholder `e.g. only Brazil, goals over 3, newest first`; `query-filter-text-apply` (`Apply`); `query-filter-understood` (`Understood as: Country is Brazil · Goals at least 3`); failure: `Could not turn that into a filter: <reason>`.
- States: `query-result-empty` (`No rows match these filters.`); `query-page-error` (role alert, `Could not load this page: <message>`, a `Retry` button); `Show the answer's rows` returns to the stored rows.
- Top-N note: when the query's coverage is `top-n`, `Paging the full result, not only the top <n> the answer used`.
- Explore record (1.27.5): opens on its stored `view`; note `Page 2 of 41 · Country is Brazil · sorted by Goals, high to low`.

## 1. SQL generation (1.27.1)

One pure module `paged-sql.ts`: `buildPagedSql(dialect, stmt) → { text, params }`.

1. `cleanReadOnlySql` (exported from `connector.ts`): `assertReadOnlySql` on the stored SQL only, without fences, comments or a trailing `;`.
2. When the stored SQL has its own top-level LIMIT, `withExportLimit(sql, PAGE_MAX_ROWS + 1)` raises it, as the CSV does; without one it stays unlimited, so filters and sort see the whole result (changed at the wave 1 merge: appending 50,001 made filters see only an arbitrary first 50,001 rows). Columns of unknown kind are no tie-breakers (JSON, MAP).
3. Wrapper; the stored SQL is never scanned again, the rest is code, validated identifiers and bound parameters:

   ```sql
   SELECT _qti.*, COUNT(*) OVER () AS <q>__qti_total</q>
   FROM (
   <inner>
   ) AS _qti
   WHERE <p1> AND <p2> …
   ORDER BY <sort keys>, 1, 2, …, k
   LIMIT <n> OFFSET <m>
   ```

   Newlines around `<inner>` keep a trailing `--` comment from swallowing the `)`. LIMIT/OFFSET are integer literals (`Number.isSafeInteger`, capped), never parameters. `matchedRows = min(__qti_total, 50,000)`, `capped = __qti_total > 50,000`; `__qti_total` is removed from rows and columns. An empty page past the end runs one fallback `SELECT COUNT(*)`.
4. Identifiers: Postgres and SQLite `"…"` (`"` doubled); Databricks `` `…` `` (backtick doubled). A column must be in the known list; duplicate names cannot be filtered or sorted.
5. Placeholders: Postgres `$1…` inside the existing `BEGIN READ ONLY` and 30 s `statement_timeout`; Databricks `:p1…` with `executeStatement(text, { namedParameters })`, 120 s timeout; SQLite `?` with `stmt.all(...params)`, booleans as `1`/`0`; REST goes through `rewriteReferences`.
6. Predicates: text `eq`/`neq`/`in` as `LOWER(CAST(c AS TEXT|STRING)) = LOWER(?)`; `neq` and `not_*` keep NULLs (`… OR c IS NULL`); `contains`/`starts_with` with `LIKE`, `%` and `_` escaped (SQLite adds `ESCAPE '\'`); `between` as `c BETWEEN ? AND ?`; dates as ISO strings; numbers and booleans coerced by `ColumnKind` (inferred from stored rows), a value that does not coerce is a 400 before any query.
7. Sort: `ORDER BY c ASC|DESC NULLS LAST`, then every remaining ordinal as a tie-breaker; default order as decided above.
8. Cost: each page re-runs the inner query; measure on one small and one large real table before the wave check.

## 2. The follow-up branch (1.27.8)

A code gate, then one `result-explorer` call that both decides and returns the view. The gate: the run has earlier queries (`runtime.followUp` reads `contextQueries`). `analysis-planner` is untouched; a first run makes no extra model call.

```
receive-question → load-catalog → interpret-follow-up
 .branch([ [!stopped && followUp?.action === 'explore', explore-result: page-result → page-answer],
           [!stopped && otherwise,                      question-path: .dountil(plan-round) → .branch(analysis-path)] ])
```

- `interpret-follow-up`: kind `agent`, `modelOnly`, `stepAgents: { 'interpret-follow-up': 'result-explorer' }`; output `catalogedQuestionSchema.extend({ followUp: followUpSchema.nullable(), stopped? })`.
- `page-result` (code): `runtime.pageResult`; the turn engine runs the engine and pushes an `explore_result` record with its facts and `tool`/`tool-result` events.
- `page-answer` (code): pure `pageAnswer(view, result, queryTitle)` (headline, the `understood` line, a Markdown table of the page rows), `runtime.deliverAnswer(text)`, output `turnSummarySchema`.
- Result: `{ 'explore-result'?: turnSummary, 'question-path'?: { 'analysis-path'?: { 'answer-path'?: turnSummary } } }`; `turnSummaryOf` reads both.
- Edges: remove `load-catalog→plan`; add `load-catalog→interpret-follow-up`, `interpret-follow-up→plan` (branch `New question`), `interpret-follow-up→page-result` (branch `Explore the earlier result`), `page-result→page-answer`, `page-answer→end`.
- `contextQueries?: ExplorableQuery[]` on `RunHostSpec` = `{ ref, sql, datasourceId?, columns, sampleValues, rationale?, view? }`, built by `WorkflowRunsService.contextOf` from the earlier answer's `data`/`evidence` (no error, `run_readonly_sql` or `explore_result`, no rows) and by `WorkflowNodeChatsService` for node chats. An explore answer passes its `view` on, so "next page" moves from page 2.
- Suspended runs from before the upgrade: the clarify path deepens; `prepareResume` compares the run's `contractHash` and answers the existing 410.

## 3. Stories

| Story | Model | Files | Depends on | Failing test first |
|---|---|---|---|---|
| 1.27.0 Contract (lead) | Opus | `paged-sql.types.ts`, frontend type copy, this plan, epic spec, ADR-0049, roadmap | – | – |
| 1.27.1 Paged SQL builder and connectors | Opus | new `connectors/paged-sql.ts` + spec; `connector.ts` (`cleanReadOnlySql`, interface); postgres, databricks, rest connectors; `datasources.service.ts`; datasources spec R37, new R52 | 1.27.0 | `paged-sql.spec.ts` (quoting per dialect, `$n`/`:pn`/`?`, CTE, trailing `--` and `;`, raised LIMIT, a forbidden word inside a column name passes, NULLS LAST, ordinals); `rest.connector.spec.ts` on real better-sqlite3 (boolean binding); `databricks.connector.spec.ts` (`namedParameters`) |
| 1.27.2 Page engine and routes 151/153 | Opus | new `query-evidence/result-view.ts` + spec; `query-evidence.service.ts` `page()`; `answer-evidence.service.ts`; `session-evidence.service.ts`; workflow-runs service and controller; `sessions.controller.ts`; api.md; data-model; non-functional §5 (Result paging table, N72) | 1.27.0 (mocks `runPagedSql`) | `result-view.spec.ts` (unknown/duplicate column, op without value, page past 50,000, coercion, default order); service spec (page stores nothing; a sample is refused) |
| 1.27.3 Inspector: pager, sort, column filters | Sonnet | new `shared/query-evidence/query-result/query-result.{ts,html,spec.ts}`; `query-inspector.html`; `run-query-evidence-api.ts`; `session-query-evidence-api.ts`; the two API services; ui.md 4.12.2; agent-answers R76, new R79–R81 | 1.27.0 | `query-result.spec.ts` (Next requests page 2; sort cycles `aria-sort`; chip shows and removes; cap note; error and Retry). E2E `frontend/e2e/query-result-paging.spec.ts` |
| 1.27.4 `result-explorer` agent and routes 152/154 | Opus | `agents/result-explorer.prompts.ts`, `agents/result-explorer.agent.ts`; `index.ts`; agent constants, personas, shipped prompts; `mastra.service.ts` `interpretResult`; evidence services and controllers; agents.md 1.1, 2.15 | 1.27.2 | `result-explorer.prompts.spec.ts` (`specOf` drops unknown columns, `next` → absolute page, `new-question` → 400 in inspector mode) |
| 1.27.5 Inspector: filter in words, explore preset | Sonnet | `query-result.*`; both API adapters (`interpretFilter`); opening an explore record on its `view`; ui.md; agent-answers R82–R83 | 1.27.3 | `query-result.spec.ts` (understood line, rejected part, preset view). E2E `frontend/e2e/query-result-filter-text.spec.ts` |
| 1.27.6 result-explorer evals | Sonnet | `evals/result-explorer.evals.ts`, `-eval-target.ts`, `-eval-checks.ts` + specs; `eval-sets.ts`; agents.md 8.1 | 1.27.4 | checks unit-tested on one real reply |
| 1.27.7 `explore_result` tool | Opus | `tools/explore-result.tool.ts`; `dataset.tools.ts`; `tool-services.ts` (`pageQuery`, `interpretResult`); `sessions.service.ts` (`RunHostSpec.contextQueries`); `turn-data.ts`; `query-evidence.ts` (`EVIDENCE_TOOLS`, coverage `partial`); turn-engine (`explorable-queries` request-context key, facts `view`); `assistant.agent.ts`; insights-analyst catalogue and agent; `agent-workflows.ts`; workflow-runs and node-chats services (`contextQueries`); agents.md 2.1, 2.11, 3.15, 4.2; agent-answers R84 | 1.27.2, 1.27.4 | `explore-result.tool.spec.ts` (latest by default, unknown SQL lists candidates, `toModelOutput` hides `sourceSql`); `turn-data.spec` (record `input` is the source SQL); `query-evidence.spec` (evidence `view`) |
| 1.27.8 Follow-up branch in Answer a Business Question | Opus | `answer-business-question.{schemas,steps,workflow}.ts`; `workflow-catalog.ts`; turn-engine runtime (`followUp`, `pageResult`, `deliverAnswer`); `insights-analyst-workflow-target.ts`; `workflow-contracts` snapshot; workflows spec R1, R2, R27, new R35; agents.md 5.11, 5.12 | 1.27.4, 1.27.7 | steps spec (`pageAnswer`; `turnSummaryOf` both shapes); workflow spec on the stub (no context: no model call, Plan runs; explore: Plan skipped). E2E `frontend/e2e/result-follow-up.spec.ts` |

Waves: **1** = 1.27.1 ∥ 1.27.2 ∥ 1.27.3 (no agent input changes, no evals). **2** = 1.27.4 ∥ 1.27.5, then 1.27.7 (assistant and insights-analyst evals). **3** = 1.27.8 ∥ 1.27.6 (insights-analyst evals once for 1.27.7 and 1.27.8; result-explorer set first run).

Ownership: only 1.27.0 edits `paged-sql.types.ts`; only 1.27.3 creates the `query-result` component; only 1.27.7 adds `RunHostSpec.contextQueries`; 1.27.2 owns api.md 151 and 153, 1.27.4 owns 152 and 154.

## 4. Specs

- datasources: R37 gains "except a paged read of a stored query's result (R52, ADR-0049)"; new R52.
- agent-answers: R76 (stored rows first; paging, sorting or filtering asks the server); new R79 pager, R80 sort, R81 column filters, R82 filter in words, R83 explore records open on their view, R84 `explore_result` answers link through the shared layer.
- workflows: R1, R2, R27; new R35.
- api.md 151–154 and header counts, `QueryEvidence.view`; data-model 3.4.2a `view`; non-functional §5 Result paging and N72; agents.md 1.1, 2.15, 3.15, 4.2, 5.11, 5.12, 8.1; ui.md 4.12.2.

## 5. Evals

- 1.27.1–1.27.5: no existing agent's input changes.
- 1.27.7: the tool list and generated tool section of `assistant` (every tool selection, user agents too) and `insights-analyst` change: their sets, ≥ 3 runs per case against base.
- 1.27.8: the insights-analyst target runs the whole workflow, so its set runs, in the same round as 1.27.7.
- New set `result-explorer` (World Cup fixture): 1 "next page" → `next`; 2 "page 5" → `to 5`; 3 "only Brazil" → `eq`, spelled as stored; 4 "goals over 3 in 2018"; 5 "between 2000 and 2010"; 6 "teams starting with B"; 7 "highest attendance first"; 8 "clear the filters"; 9 "solo Brasil"; 10 two candidates, picks the right Q; 11–13 negatives (a new measure, a new grouping, a column that does not exist) → `new-question` or `rejected`.

## 6. Risks

- A top-N answer pages the whole result (as the CSV does): the top-N note says so.
- Every page re-runs the query (REST re-fetches its endpoints): measure; timeouts unchanged.
- Wrong routing of a follow-up: the instructions say explore only when the answer is the earlier rows filtered, sorted or paged; negative eval cases.
- Text filters bypass indexes (`LOWER(CAST(…))`); the database does the work, a page returns at most 100 rows.
