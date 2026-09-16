# Phase 4 execution plan — Strategic bets

From `docs/research/competitive-research-and-improvement-plan.md` §3 Phase 4 (items 13-16). Adapted to this codebase's agentic architecture. Executed in waves to avoid file conflicts:

- **Wave 1 (parallel)**: Workstream A (item 13, metrics layer, full-stack) + Workstream D (item 16, multi-visual answers, backend visuals only).
- **Wave 2**: Workstream B (item 14, careful mode / cross-check, full-stack).
- **Wave 3**: Workstream C (item 15, Deep Analysis, full-stack).

## Workstream A — Item 13: Lightweight semantic metrics layer

Genie-style curated semantics, app-managed (no dependency on Unity Catalog Metric Views existing in the user's workspace — noted as future integration).

### Backend
- New collection `METRICS_STORE` / table `metrics`; feature module `backend/src/modules/metrics/`:
  ```ts
  interface MetricDoc {
    id: string;
    name: string;              // e.g. "denial_rate"
    label: string;             // "Denial rate"
    description?: string;      // business meaning
    entity: string;            // fully-qualified catalog.schema.table it computes over
    datasourceId?: string;
    expression: string;        // SQL aggregation expression, e.g. SUM(CASE WHEN status='denied' THEN 1 ELSE 0 END)/COUNT(*)
    dimensions?: string[];     // columns it is meaningfully grouped by
    createdAt?: string; updatedAt?: string;
  }
  ```
- CRUD controller `GET/POST /metrics`, `PUT /metrics/:id`, `DELETE /metrics/:id` (validate: name slug-like + unique, entity + expression non-empty; response `{ok, message, metric?/metrics?}`).
- **Prompt grounding**: in `ProjectsService.agentOptions`, load metrics whose `entity` is in the project's sandbox entities; when any exist, append a system block:
  `Governed metric definitions (curated — ALWAYS prefer these exact expressions when the question asks for the metric):` then per metric: `- <label> (<name>) on <entity>: <expression>; dimensions: <…>; <description>`. Cap ~4k chars.
- **Promotion path**: `POST /metrics/from-verified/:verifiedQueryId` — creates a prefilled draft `MetricDoc` from a verified query (entity from its entities[0], expression left for the user to edit; return the draft WITHOUT saving? No — save with label "(review)" suffix? Keep simple: endpoint takes a full MetricDoc body plus the verified id for provenance and saves it; the prefill happens client-side from the verified query data).
  Simplification allowed: skip `/from-verified` endpoint; frontend prefills the create form from a verified query where visible. Implementer's choice — note the decision.
- Tests: repository/service CRUD + validation, agentOptions injection (metrics scoped to sandbox entities only).

### Frontend
- Metrics management UI inside the `data-sandbox` feature (agent: locate the sandbox page/components, match idiom): a "Metrics" section/panel listing metrics for the selected entities, create/edit form (label, name, entity select from sandbox entities, expression textarea, dimensions multi-input, description), delete with confirm. New `metrics-api.service.ts` + models in that feature.
- Keep styling consistent (Tailwind v4, lucide, zinc/emerald idioms).

## Workstream D — Item 16: Multi-visual (composed) answers

QuickSight-pattern composed answer inside the existing single-bundle pipeline — no output-schema change.

- `chart-heuristic.ts`: new `recommendComposition(records)` — when data is rich enough (≥2 successful SQL records, or one record with ≥2 numeric columns and ≥6 rows), recommend a composed layout: KPI tile row (headline aggregates from the data), one main chart (existing form rule), and a collapsible detail table. Emit inside `<recommended-form>` as an additional paragraph; single-record thin data keeps today's single-form recommendation.
- `visualization.service.ts`: `visualizationData` currently feeds the designer capped rows — confirm it includes ALL successful records (not just the last); if it only includes one, extend to include up to 3 records (respecting existing char caps, per-record row cap divided accordingly). The `<data>` block already carries tool+SQL per record.
- SKILL.md: short section on composed answers: KPI tiles (large number + label + delta when derivable from the data), main chart, detail table with the underlying rows; all in one fragment; keep the 12k char budget; interactions still required; `data-qti-value` marks still required on chart marks and KPI tiles.
- Designer budget: bump `maxOutputTokens` to 9_000 and the prompt's stated bundle budget to 16,000 chars ONLY for composed recommendations (pass a flag from the heuristic through `runDesigner`); single-form visuals keep current limits.
- Tests: composition rule triggers/doesn't; multi-record data block; budget switch.

## Workstream B — Item 14: Careful mode (independent cross-check)

CHASE-SQL-style multi-candidate adapted to the agentic flow: opt-in per message; after the turn completes, an independent verifier re-derives the key SQL and compares results.

### Backend
- `POST /projects/:id/messages/stream` body gains `careful?: boolean`; threaded into `streamMessage`.
- After the answer persists (only when careful && at least one successful SQL ran): run verifier — new single-step Mastra agent `sql-verifier` (structured output `{sql}`) prompted with the question, the schema block (entities + columns + sample values), verified reference pairs, and NOT the original SQL (independence). Execute its SQL via the bridge (no repair loop needed — one shot). Compare result sets with the turn's primary result (reuse/extract the eval harness's normalize+multiset compare into a shared util — move it into `backend/src/modules/projects/result-compare.ts` and have `scripts/run-eval.ts` import it).
- Persist on the message: `crossCheck?: { status: 'agree' | 'disagree' | 'error'; note?: string }` (note: short human line, e.g. "independent re-derivation returned the same results" / "results differ — treat with care"). Emit an SSE event `cross-check` with the same payload so the UI updates live after `done`? Simpler: run BEFORE emitting `done` so the persisted project already carries it; acceptable added latency since careful mode is opt-in.
- Tests: agree/disagree/error paths (verifier mocked), only runs when flagged, compare util unit tests (reused from eval — keep eval's tests passing).

### Frontend
- Composer: "Careful" toggle chip (ShieldCheck icon) next to send; when on, stream request body includes `careful: true`; visual on-state like existing chips; persists per conversation session (signal, not stored).
- Message UI: `crossCheck` renders a small chip next to Verified: agree → emerald "Cross-checked ✓" (tooltip note), disagree → amber "Cross-check differs" (tooltip note), error → zinc muted "Cross-check failed".
- Contract: `ChatMessage.crossCheck` as above, mirrored in the model.

## Workstream C — Item 15: Deep Analysis mode

Dot/Hex pattern: deliberate slow path producing a report artifact. In-process async job (no queue infra).

### Backend
- New feature module `backend/src/modules/deep-analysis/`:
  - `POST /projects/:id/deep-analysis` `{question}` → `{ok, message, jobId}`; job runs async in-process.
  - `GET /projects/:id/deep-analysis/:jobId` → `{status: 'planning'|'investigating'|'writing'|'done'|'error', progress?: string, step?: number, steps?: number}` for polling.
  - Job pipeline (all through existing `assistant` agent generate calls with the project's requestContext/tools, NOT new tools): (1) plan — one structured call producing 3-5 investigation angles from the question + entity context; (2) investigate — for each angle sequentially, one `agent.generate` (maxSteps 15) instructed to answer that angle with SQL and return findings + the SQL used; abort-safe; (3) synthesize — one call combining findings into a markdown report: executive summary, per-angle findings with numbers, anomalies/drivers, recommendations, data appendix (SQL per angle).
  - Persist: report file `reports/<jobId>.md` in the project workspace; chat message appended on completion: `content` = executive summary (markdown), plus new `ChatMessage.report?: { jobId, title, path, angles: number }`; on error, a chat message stating the failure.
  - `GET /projects/:id/deep-analysis/:jobId/download` → the .md file.
  - Guard: one running job per project; reject a second with `ok:false`.
- Tests: plan/investigate/synthesize orchestration with mocked agent, single-job guard, report persisted, chat message appended.

### Frontend
- Composer: "Deep analysis" action (Telescope/FlaskConical icon) — sends the current draft as a deep-analysis job instead of a chat turn; chat shows a local pending card ("Deep analysis running — planning / investigating angle 2 of 4 …") driven by polling every ~3s; on done, refresh project (report message appears; card clears). Do not block normal chat while it runs.
- Report message rendering: title + executive summary via existing MarkdownPipe + a download button (report .md). `report` field mirrored in the model.

## Cross-wave contract additions to `ChatMessage`
```ts
crossCheck?: { status: 'agree' | 'disagree' | 'error'; note?: string };
report?: { jobId: string; title: string; path: string; angles: number };
```

## Verification (every wave)
Backend `npm run build` + `npm test` green; frontend build + `ng test` (keyboard-resize failure pre-existing). No commits by agents. No AI attribution. Never run bare `git stash`.
