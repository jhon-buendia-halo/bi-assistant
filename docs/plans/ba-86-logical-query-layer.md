# BA-86 — Logical query layer: the assistant reasons over abstract entities

Roadmap 1.2.2 · ADR-0007 · depends on 1.2.1 (BA-85, merged into this branch's base). Decision record: [ba-2-data-model-dsl-alternatives.md](ba-2-data-model-dsl-alternatives.md) §4b.

## Goal

The assistant never sees `catalog.schema.table`, SQL dialects or storage kinds. It reasons over the data model (entities, attributes, relationships, metrics) and asks for data with a **logical query**; one compiler per binding kind turns it into SQL. Raw SQL survives only as a flagged last resort. Repair and verification move up to the logical level. The eval harness can run the same cases through the new path and the legacy path.

## 1. Session model (`backend/src/modules/data-models/session-model.ts`, pure)

`composeSessionModel(models: { dataset: string; model: DataModel }[]): SessionModel` — the union of the current models of a session's datasets.
- Entities keep their logical name when unique across datasets, or when two datasets bind the same physical table (same entity, dedupe; remember both datasets). When two datasets bind *different* tables under the same name, qualify as `<datasetSlug>__<entity>` and say so in the rendered block.
- Each entity carries `dataset`, `datasourceId`, `kind` (`sql` | `rest`), `table` (physical, for the compiler only), `columns` map, attributes, and the relationships and metrics that touch it.
- `renderModelBlock(sessionModel, { budgetChars = 8_000, samples = 3 })` → the ONE system block that replaces `entityOrientationLines` + `joinHintBlock` + `metrics.definitionBlock`. Shape per entity:
  ```
  Entities in this session (logical names; query them with query_entities):
  - matches (dataset "World Cup Core") — One played match of a tournament
      key: match_id
      attributes: match_id key integer; tournament_id key integer -> tournaments.id (many_to_one); match_date time date [e.g. 2018-06-14]; attendance measure integer [e.g. 78011, 43472]; …
      metrics: avg_attendance (Average attendance) = avg(attendance)
  ```
  Whole model, no pruning; sample values inline (≤ 3, ≤ 40 chars); descriptions only when present. Never emits physical table names, datasource ids, kinds or dialect words. Budget: drop sample values first, then descriptions, then truncate with a `(… N more entities; call describe_entity)` line.

## 2. Logical query (`backend/src/modules/data-models/query/logical-query.ts`)

Zod schema `logicalQuerySchema` (also used as the tool input schema, so the model is constrained):
```ts
interface LogicalQuery {
  from: string;                                  // entity
  joins?: { via: string; as?: string }[];        // via = relationship ref ('matches.home_team_id->teams.team_id' or a relationship name); as = alias for the joined entity (default: target entity name)
  select: SelectItem[];                          // ≥ 1
  where?: Predicate;                             // the DSL's portable predicate; attr refs as below
  group_by?: AttrRef[];
  order_by?: { by: string; dir?: 'asc' | 'desc' }[];   // by = alias or attr ref
  limit?: number;                                // 1..500, default 100
}
type AttrRef = string;   // 'attendance' (own), 'home_team.name' (join alias), 'teams.name' (target entity when exactly one path exists)
type SelectItem =
  | { attr: AttrRef; alias?: string; bucket?: 'year' | 'quarter' | 'month' | 'week' | 'day' }
  | { metric: string; alias?: string }                       // a model metric
  | { agg: Aggregation; of?: AttrRef; alias: string; where?: Predicate };   // ad-hoc aggregation
```
Semantic validation (structured, before any compilation): unknown entity / attribute / metric / relationship, ambiguous auto-path (two relationships between the same entities → "use joins[].via"), order_by naming nothing selected, group_by missing when aggregations and plain attributes are mixed (auto-fill group_by from the plain attributes instead of failing — say so in a `notes` field), entities bound to different datasources in one query (rejected: "query one datasource at a time"). Errors are `{ code, message, path }` so the fixer can act on them.

## 3. Compiler (`backend/src/modules/data-models/query/compile-sql.ts`)

`compileLogicalQuery(sessionModel, query, dialect: 'postgres' | 'databricks' | 'sqlite'): CompiledQuery` → `{ sql, datasourceId, entities: string[], notes: string[] }` or throws `LogicalQueryError` with the structured issues.
- Identifiers: `"x"` for postgres and sqlite, `` `x` `` for databricks; physical column via the binding `columns` map, else the attribute name; table = `sql` binding `table`, or the `rest` binding `endpoint` key (REST runs as sqlite — confirm the exact key the connector materialises in `rest.connector.ts`).
- Joins from relationships: `JOIN <table> AS <alias> ON <from>.<col> = <alias>.<col>`; `one_to_many` from the `from` side is allowed only with aggregation (fan-out guard: plain attributes from a one_to_many join raise an issue explaining the duplication risk).
- Metrics: portable `agg`/`of`/`where` → `AVG("attendance")`, `SUM(CASE WHEN <pred> THEN "x" END)`, `COUNT(*)`, `COUNT(DISTINCT "x")`; `ratio` → `(<num>) * 1.0 / NULLIF(<den>, 0)`; `expressions.sql` inserted verbatim (documented: written against the binding's physical columns of that entity).
- Predicates: eq/ne/gt/gte/lt/lte/in/not_in/between/is_null/not_null; `contains` / `starts_with` → `LOWER(x) LIKE LOWER('%v%')` (portable); literals: strings single-quote-escaped, numbers validated, booleans `TRUE/FALSE` (sqlite `1/0`), dates as ISO strings cast per dialect when the attribute type is date/datetime.
- Buckets: postgres `date_trunc('month', x)::date`; databricks `date_trunc('MONTH', x)`; sqlite `strftime('%Y-%m-01', x)`; `year` → `EXTRACT(YEAR FROM x)::int` / `year(x)` / `CAST(strftime('%Y', x) AS INTEGER)`; quarter and week analogously.
- Always appends `LIMIT n`. Deterministic output (golden tests per dialect).

## 4. Tools (`backend/src/mastra/tools/model.tools.ts`) and services

Replace `datasetTools` on the assistant with `modelTools`:
- `list_entities()` → `[{ entity, label, description, attributeCount, dataset }]`.
- `describe_entity(entity)` → attributes (name, type, role, description, samples), relationships in/out (as refs with cardinality), metrics on the entity.
- `query_entities(query: LogicalQuery, rationale)` → compiles and runs via `getDatasetToolServices().runLogicalQuery(sessionDatasets, query)`; returns `{ columns, rows, rowCount, truncated?, notes?, warnings? }`; compile/semantic failures return `{ error: { code, message, path }, hint }` WITHOUT any database call.
- `sample_records(entity, limit, rationale)` → first rows of the entity through a compiled `select *`-equivalent (all attributes).
- `run_raw_sql(sql, rationale)` → the flagged fallback: description says "only when query_entities reported it cannot express the question; the answer will be marked as outside the data model". Executes through the existing `runReadOnlySql` repair path; the tool result and the turn record carry `outsideModel: true`.
- `SessionsService` installs `runLogicalQuery` in `setDatasetToolServices`: compose the session model from `DataModelsService` current versions of the session's datasets, compile for the datasource kind (`postgres` → postgres, `databricks` → databricks, `rest` → sqlite), run through `runSqlWithRepair` (runtime errors on compiled SQL are still repaired by `sql-fixer` as a safety net), record the turn data (`tool: 'query_entities'`, `input` = compiled SQL, plus `logicalQuery` JSON) so visuals and provenance keep working.
- `agentContext`: the first system block becomes `renderModelBlock(...)` + the visuals lines; drop the metrics block; keep knowledge and verified-query blocks. `KNOWLEDGE_USED` unchanged. Record `modelVersions: { dataset, version }[]` on the turn for provenance.
- Turn/answer records: add `outsideModel?: boolean` on `ToolDataRecord` and on the persisted assistant message (`SessionMessage`), set when any `run_raw_sql` ran in the turn. Expose it in the message JSON (frontend badge is 1.4.1, not here).

## 5. Assistant instructions (`assistant.agent.ts`)

Rewrite the instructions to the model vocabulary. No mention of catalogs, schemas, tables, SQL dialects, Databricks, PostgreSQL or SQLite. Steps: (1) map the question to entities and attributes with the session model block, `describe_entity` and `sample_records`; (2) answer with `query_entities` (prefer metrics and aggregations; join through declared relationships; identifiers are not answers, join to the entity holding the name); (3) explain. Keep the clarification, grounding, curated-knowledge, rationale, visual and warning rules, rewritten without SQL vocabulary. `run_raw_sql`: one bullet, last resort, must be stated in the answer. Add a unit test that asserts the instructions and the rendered block for the World Cup fixture contain none of: a fully-qualified table key, "PostgreSQL", "Postgres", "Databricks", "SQLite", "SQL dialect".

## 6. Repair and verification at the logical level

- `query-fixer` agent (replaces `sql-fixer` for compile/semantic failures — the SQL fixer stays for runtime errors on compiled SQL): input = the logical query, the structured issues, the rendered model block; structured output = a corrected `LogicalQuery`. `query_entities` runs it automatically once when the issue is `unknown_attribute` / `unknown_metric` / `ambiguous_path` before returning an error to the assistant; the tool result says what was corrected.
- `query-verifier` agent (replaces `sql-verifier` in careful mode): from question + rendered model block (+ verified references) produce an independent `LogicalQuery`; compile, run, compare with `compareResults` exactly as today. Remove the old `verifierContext` schema-snapshot path.
- Register both in `mastra/index.ts`; keep `sql-fixer` registered; keep `sql-verifier` registered but unused by sessions only if something else depends on it — otherwise remove it and update CLAUDE.md's agent list.

## 7. Evals on both paths

- Register a second agent `assistant-legacy` = the pre-change assistant (old instructions + `datasetTools`) so the comparison is real.
- `runAssistantEvals(datasets, onCase, caseIds, sessions, knowledgeBlock, options?: { path?: 'model' | 'legacy' })`: `model` (default) builds the context from `renderModelBlock` and runs `assistant`; `legacy` builds `entityOrientationLines` + metrics block and runs `assistant-legacy`. Each `AssistantEvalCaseResult` gains `path` and `outsideModel: boolean` (any `run_raw_sql` call). `EvalRunDoc`/`EvalRunView` carry `path` and an `outsideModelCount`; the in-app Evals tab shows the path label and the count; the CLI takes `EVAL_PATH=legacy|model`.
- No LLM key is available in this environment: unit-test the plumbing (path selection, agent selection, counters, report fields) with a stubbed agent; document the two commands to run the real comparison in `evidence/1.2.2/README.md` and leave the eval numbers as "to be run by the team".

## 8. API for the editor (used by 1.2.3) and for e2e

- `POST /datasets/:name/model/compile` body `{ query, dialect? }` → `{ sql, entities, notes }` or 400 with issues. Pure, no database call.
- `POST /datasets/:name/model/query` body `{ query, limit? }` → runs it on the dataset's datasource (through the same service path). Not used by e2e (no live DB in Jest).

## 9. Gherkin / E2E

- `gherkin.md` → *Feature: Data model*: add "Compiling a logical query returns dialect SQL without touching the database" and "A logical query naming an unknown attribute or an undeclared relationship is rejected before any database call". *Feature: Chat and visuals*: steps unchanged (the Playwright spec uses a deterministic fake stream) — re-run as-is.
- `backend/test/data-models.e2e-spec.ts`: add the two scenarios (focused module boot; `import request from 'supertest'`; typed bodies — follow the existing file).
- Unit specs: session model composition and collisions; render block budget and vocabulary; compiler golden SQL per dialect (postgres, databricks, sqlite) for: plain select, metric, ad-hoc agg with where, join via relationship, auto-path, ambiguous path error, one_to_many fan-out guard, buckets, ratio, limits, literal escaping; tools (mocked services); fixer/verifier plumbing (mocked agents); evals path selection.

## 10. Out of scope

Mongo/file adapters; the editing UI (1.2.3); the frontend badge for `outsideModel` (1.4.1); knowledge-store concept retrieval (1.3.3).

## Acceptance (from the roadmap)

No `catalog.schema.table` or dialect names in the prompt or tool calls; logical queries compile to valid SQL on Postgres, Databricks and the REST materialisation; unknown attributes or undeclared relationships are rejected before any database call; metrics are computed by the compiler; the eval report shows per-question results for both paths and the raw-SQL fallback count.

## Workflow step 6 — component impact analysis on E2E (added during implementation)

Every component touched by this change, the Gherkin scenarios that exercise it, and the add/update/delete/re-run-as-is decision taken.

| Component | Scenario(s) | Decision | Why |
|---|---|---|---|
| `backend/src/modules/data-models/data-models.controller.ts` (`POST .../model/compile`) | *Feature: Data model* — "Compiling a logical query returns dialect SQL without touching the database" | **Add** | New endpoint, no prior coverage. |
| `backend/src/modules/data-models/data-models.controller.ts` (`POST .../model/compile`, error path) | *Feature: Data model* — "A logical query naming an unknown attribute or an undeclared relationship is rejected before any database call" | **Add** | New rejection path, no prior coverage. |
| `backend/src/modules/data-models/data-models.controller.ts` (`POST .../model/query`) | — | **Add, backend-only, not e2e-covered** | Brief §8 explicitly scopes this out of e2e ("no live DB in Jest"); covered only by the pure `/compile` path and by code review. |
| `mastra/agents/assistant.agent.ts` (instructions + tools) | *Feature: Agents* — "Opens an agent from the Agents list and switches between its tabs" (`frontend/e2e/agents.spec.ts`) | **Update** | The Tools tab no longer lists `run_readonly_sql` (replaced by `query_entities`); the spec and `gherkin.md` were updated to assert `query_entities` instead. The Prompt tab's opening line is unchanged, so that assertion needed no edit. |
| `mastra/agents/sql-verifier.agent.ts` removal / `query-verifier.agent.ts` addition | *Feature: Agents* — same spec, "All agents" list check | **Update** | The spec asserted `agent-sql-verifier` is visible after navigating back to the list; updated to `agent-query-verifier` (the replacement agent's registry key). |
| `mastra/agents/assistant-legacy.agent.ts`, `query-fixer.agent.ts` additions | *Feature: Agents* | **Re-run as-is** | Both show up as additional rows in the Agents list (`AgentsService.list()` enumerates every registered mastra agent indiscriminately), but no existing scenario asserts an exact agent count, so no scenario needs a row-count edit. Known gap: `assistant-legacy` is intended as eval-harness-internal only, but the Agents tab has no concept of "hidden" agents, so it is visible there too — left as-is, flagged here rather than silently accepted. |
| `mastra/tools/dataset.tools.ts`, `model.tools.ts` | *Feature: Data sandbox and schema inspection* (dataset browsing, unrelated to the assistant's tool surface) | **Re-run as-is** | That feature exercises the Datasets UI's own schema browser, not the assistant's tools; untouched behaviourally. |
| `modules/sessions/sessions.service.ts` (`agentContext`, `crossCheckAnswer`) | *Feature: Chat and visuals* (`frontend/e2e/chat.spec.ts` / visuals specs) | **Re-run as-is** | The Playwright specs drive a deterministic fake stream (mocked `/messages/stream` responses), never the real agent/model context build, so the rendered-model-block switch is invisible to them. Confirmed by reading the fixture; not re-run in this environment per the orchestrator's constraint (frontend e2e requires port 3000 + Postgres and is run by the orchestrator, not this agent). |
| `features/agents` Evals tab (`agent-detail.ts/html`, `agents-api.service.ts`) | *Feature: Agents* — eval run / eval report scenarios | **Re-run as-is** | The new path label and outside-the-model count are additive UI (a new line of text); no existing assertion targets that region of the DOM, so no existing scenario breaks. No new scenario was added for the label itself — out of scope per the task's "Evals tab path label" framing (display only, not a new interactive flow). |

**Backend e2e** (`backend/test/data-models.e2e-spec.ts`) implements the two "Add" rows above directly (workflow step 7), run and green before implementation per `git log`/test output in `evidence/1.2.2/`. **Frontend e2e** (`frontend/e2e/agents.spec.ts`, `gherkin.md`) was updated to match (the "Update" rows) but not executed in this environment — Playwright needs the real Electron app, port 3000 and, for some specs, the World Cup Postgres fixture, which this task's constraints reserve for the orchestrator.
