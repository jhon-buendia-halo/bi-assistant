# Phase 1 execution plan — Answer reliability

From `docs/research/competitive-research-and-improvement-plan.md` §3 Phase 1. Four items; A–C are implementation workstreams.

## Workstream A — Backend pipeline (items 1, 2-backend, 3)

### Item 1: Execution-guided SQL self-correction

Today `run_readonly_sql` returns `{error}` and retrying is only a prompt suggestion (`assistant.agent.ts:52-54`). Enforce a repair loop inside the DI bridge, following the existing visualization-retry precedent (`visualization.service.ts:341-352`).

- New Mastra agent `sql-fixer` (`backend/src/mastra/agents/sql-fixer.agent.ts`, registered in `mastra/index.ts`): single-step, no tools, structured output `{ sql: string }` (Zod), model `async () => resolveAgentModel()`. Instructions: given a failed SQL statement, the dialect (databricks|postgres), the error message, and the available entities/columns, return one corrected read-only SELECT/WITH statement, nothing else.
- In `ProjectsService.onModuleInit` bridge (`projects.service.ts:65-66`), wrap `runReadOnlySql`: on execution **error** (not on empty results), call the fixer with sql+error+dialect+schema of entities in scope, re-run, max 2 repair attempts. On success after repair, return `{ columns, rows, correctedSql, note: 'original query failed and was auto-corrected' }` so the agent cites the SQL that actually ran. On final failure return the last error.
- Empty result set: return `{ columns, rows: [], note: 'query returned 0 rows — verify filters/values before concluding' }` (no LLM call).
- `ToolDataRecord.input` must show the corrected SQL when repair happened (adjust `toolDataRecord` in `projects.service.ts` if needed).
- Schema context for the fixer: reuse `boundSandboxes` for the project — pass entity keys + columns (names/types only, cap the block ~4k chars).

### Item 2 (backend): Verified query library

Vanna pattern: store thumbs-up question→SQL pairs, retrieve top-k into the prompt.

- New collection: token `VERIFIED_QUERIES_STORE` in `doc-store.ts`, `{ token, table: 'verified_queries' }` in `database.module.ts` COLLECTIONS.
- New module files under `backend/src/modules/projects/` (it is project-feature behavior) or a small `verified-queries/` module — prefer `backend/src/modules/verified-queries/` per feature-module rule: `verified-queries.module.ts`, `verified-queries.service.ts`, `repositories/verified-queries.repository.ts`, entity `VerifiedQueryDoc`:
  ```ts
  interface VerifiedQueryDoc {
    id: string;            // uuid
    question: string;      // the user question that produced the answer
    sql: string;           // last successful run_readonly_sql of that answer
    datasourceId?: string;
    entities: string[];    // from the message's entities provenance
    sourceProjectId: string;
    sourceMessageAt: string;
    createdAt?: string; updatedAt?: string;
  }
  ```
- `ChatMessage` gains `feedback?: 'up' | 'down'` (`entities/project.entity.ts`).
- New endpoint `POST /projects/:id/messages/feedback` body `{ messageAt: string, rating: 'up' | 'down' }` → `{ ok, message, project }`. Behavior: find the assistant message by `at`; persist `feedback` on it; on `'up'`, extract the question (nearest preceding `user` message content) + last successful `run_readonly_sql` record in `message.data` and upsert a verified query (dedupe on `sourceProjectId + sourceMessageAt`); on `'down'`, remove any verified query for that message. No SQL in the message → just persist feedback.
- Retrieval: `VerifiedQueriesService.findSimilar(question: string, k = 3)` — lexical scoring is enough at demo scale (normalize, tokenize, stopword-strip, Jaccard/overlap score, threshold > 0). No embeddings infra.
- Injection: `agentOptions` (`projects.service.ts:112`) gains the current user question as a parameter (thread it from `streamMessage`/`sendMessage`); when similar verified pairs exist, append a system block:
  `Verified reference queries (user-approved earlier — reuse their tables, joins and filters when the question is similar):` followed by `Q: … / SQL: …` pairs (cap 3 pairs, ~3k chars).

### Item 3: Richer schema context (sample values)

Attacks the #1 NL2SQL error class (schema linking / value matching — Genie value dictionaries pattern).

- Extend `SandboxEntitySnapshot['columns']` items with `sampleValues?: string[]` and `description?: string` (`sandbox.repository.ts`; mirror in `SandboxSnapshot` in `mastra/tool-services.ts`).
- Enrichment at sandbox save: in `SandboxController.create` (or a small `SandboxService` if cleaner), after validating the datasource, for each table fetch up to 50 rows via `DatasourcesService.sampleRows` and derive per column up to 5 distinct sample values (stringified, each truncated to 40 chars; skip columns that look high-cardinality-unique like ids — keep it simple: just take first 5 distincts). Best effort per table: enrichment failure must not fail the save (log + continue). Do tables concurrently with a small limit (e.g. 4 at a time).
- If the Databricks inventory cache already stores column comments (check `datasources.service.ts` / `databricks.connector.ts` / `inventory-cache.repository`), merge them into `description`. If not present, skip — do NOT add new catalog round-trips.
- Surface: `describe_entity` returns the enriched columns (it already returns `access.columns` — just include new fields). Also add one line to the assistant instructions (`assistant.agent.ts`): sample values shown by describe_entity reflect real stored values — use them to match user phrasing to data values.
- Existing sandboxes: no backfill; they enrich on next re-save. Note this in the PR description.

## Workstream B — Frontend feedback UI (item 2-frontend)

Contract fixed by Workstream A: `POST /projects/:id/messages/feedback` `{ messageAt, rating: 'up'|'down' }` → `{ ok, message, project }`; `ChatMessage.feedback?: 'up'|'down'`.

- `frontend/src/app/features/projects/models/project.model.ts`: add `feedback` to the chat message model.
- `projects-api.service.ts`: `sendMessageFeedback(projectId, messageAt, rating)`.
- `project-chat` component: on assistant messages that carry `data` (i.e. real analysis answers), render small thumbs-up / thumbs-down icon buttons (lucide `thumbs-up`/`thumbs-down`), bottom of the message, subtle (visible on hover or low-opacity idle). Selected state filled; clicking the same rating again is a no-op; clicking the other switches. Update local message state from the returned project without aborting an in-flight stream (respect the existing gotcha: same-id project refresh must not abort streams — update via the same path visual metadata refreshes use).
- Tooltip: "Save as verified query" / "Mark answer as wrong". Tailwind styling consistent with existing chat affordances.

## Workstream C — Golden-set eval harness (item 4)

- `backend/eval/golden-set.json`: array of `{ name, question, sandbox, expectedSql }` — `expectedSql` is trusted SQL whose live result is the reference. Seed with 3-5 example entries marked clearly as placeholders for the demo dataset (health-claims style), plus a README (`backend/eval/README.md`) explaining how to add cases.
- `backend/scripts/run-eval.ts` (`npm run eval`, script in `backend/package.json`, run with ts-node or compiled — match how other backend scripts run; if none exist, use `tsx`/`ts-node` dev dependency consistent with repo tooling): 
  1. Boots a Nest standalone application context (`NestFactory.createApplicationContext(AppModule)`) — no HTTP needed.
  2. For each case: create a throwaway project bound to `sandbox`, call `ProjectsService.streamMessage` with a no-op `send`, then read the persisted assistant message: final text + last successful `run_readonly_sql` record.
  3. Run `expectedSql` via `DatasourcesService.runReadOnlySql` on the same datasource.
  4. Compare result sets: unordered row multiset compare after normalizing (numbers to 6 sig figs, strings trimmed, column order ignored by matching on values when column names differ). Verdicts: PASS / FAIL(result-mismatch) / FAIL(no-sql) / ERROR.
  5. Delete the throwaway project. Print a summary table + exit code 1 on any FAIL (so it can gate CI later).
- Env: requires configured LLM settings + reachable datasource; the script should fail fast with a clear message when either is missing.

## Verification (all workstreams)

- `npm run build` in backend and frontend; run existing test suites (`projects.service.spec.ts`, frontend specs) and extend: unit tests for feedback endpoint behavior (up saves pair, down removes, question extraction), `findSimilar` scoring, SQL repair loop (fixer mocked), sample-value derivation.
- No AI attribution anywhere in commits/PRs (user global rule).
