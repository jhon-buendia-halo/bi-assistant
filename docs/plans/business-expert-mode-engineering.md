# Business expert mode — engineering plan

Date: 2026-09-29.

## Goal

Add a per-turn "Business expert mode" (`expert: true`) in which an answer is
accompanied by a **reasoning trace**: five fixed blocks — interpretation, data
selection, assumptions, metric definition, annotated SQL — each carrying a
`Confidence` built from named, measured signals, and each independently
ratable (thumbs up / down + comment). The trace is not free text: the model
authors prose and structure, the service computes every confidence score
deterministically, and everything shown as SQL or tables is what actually ran
— never re-typed by the model.

Headline metric: **AUROC of overall confidence vs. answer correctness** on the
HR eval suite. Constraint: **accuracy inside the high confidence band ≥ 90%**.

## The contract

Source of truth:
`backend/src/modules/expert-mode/entities/reasoning-trace.entity.ts`, mirrored
in `frontend/src/app/features/sessions/models/expert-trace.model.ts` (add
`'failed'` to `ExpertStatus` there). Change both together.

```ts
export type EvidenceBasis =
  | 'knowledge' | 'metric' | 'verified_query'
  | 'schema' | 'data_sample' | 'convention' | 'assumption';

export type ReasoningBlockKind =
  'interpretation' | 'data-selection' | 'assumptions' | 'metric' | 'sql';

export interface ConfidenceSignal {
  id: ConfidenceSignalId; label: string; value: number; weight: number; note: string;
}

export interface Confidence {
  score: number;           // weighted mean of signals, 0..1, 2 decimals
  band: 'high' | 'medium' | 'low';
  signals: ConfidenceSignal[];
}

export const CONFIDENCE_BANDS = { high: 0.8, medium: 0.55 } as const;
```

Principle that governs every unit below: **the model writes prose and
structure; the service measures confidence.** The model emits one
`selfConfidence` (0..1) per block; it never emits a `Confidence`. The
`self_report` signal is that value, weighted low (0.10) everywhere, because
verbalized LLM confidence is known to cluster 80-100% regardless of actual
difficulty (see "What the evidence says" in the companion doc).

## Workstreams

### 1. Backend module (`expert-mode`)

- `backend/src/modules/sessions/sessions.service.ts` — `streamMessage(id,
  content, emit, abortSignal?, activeVisualId?, careful=false, expert=false)`;
  cross-check runs when `careful || expert`; builds `TraceInput` after
  cross-check, before the message save; emits `expert-status: 'explaining'`
  before the expert pass (`'cross-check'` before the cross-check); new
  `recordBlockFeedback`.
- `backend/src/modules/sessions/sessions.controller.ts` — `POST
  /sessions/:id/messages/stream` accepts `expert?: boolean`; new `POST
  /sessions/:id/expert/feedback`.
- `backend/src/modules/sessions/entities/session.entity.ts` —
  `ChatMessage.expertTrace?: ReasoningTrace`; clarification turns get no trace.
- `backend/src/modules/expert-mode/` (new module, registered in
  `app.module.ts`, imported by `SessionsModule`):
  - `expert-mode.module.ts`
  - `expert-mode.service.ts` — `buildTrace(input): Promise<ReasoningTrace |
    undefined>`, `saveFeedback`
  - `confidence.ts` — pure scoring (signals → block score → overall)
  - `sql-grounding.ts` — pure SQL identifier / join extraction, best effort,
    never throws
  - `expert-mode.controller.ts` — `GET /expert/feedback?sessionId=`
  - `repositories/reasoning-feedback.repository.ts` — upsert by `(sessionId,
    messageAt, block)`
  - `dto/block-feedback.dto.ts`
  - `entities/reasoning-trace.entity.ts` (exists)
  - `expert-metrics.ts` and `expert-metrics.spec.ts` belong to workstream 4,
    not this one.
- `backend/src/mastra/agents/business-expert.agent.ts` — new agent, id
  `business-expert`, `model: async () => resolveAgentModel()`, zod output
  schema exported from the file; registered in `backend/src/mastra/index.ts`.
- `backend/src/infrastructure/database/doc-store.ts` —
  `REASONING_FEEDBACK_STORE = 'DOC_STORE_reasoning_feedback'`.
- `backend/src/infrastructure/database/database.module.ts` — `COLLECTIONS`
  entry `{ token: REASONING_FEEDBACK_STORE, table: 'reasoning_feedback' }`.
- Tests: `confidence.spec.ts` (formula, bands, overall rules),
  `sql-grounding.spec.ts` (entity/alias/column/join extraction on 3-4
  realistic statements including CTEs and subqueries), `expert-mode.service
  .spec.ts` (post-processing a-c with a stubbed agent),
  `reasoning-feedback.repository.spec.ts`, `sessions.service.spec.ts`
  additions for flag threading. `npm run build` and `npm test` green.
  **Existing behaviour without the flag must be byte-identical.**

### 2. HR fixture + suite

New synthetic domain matching the product owner's own example question. See
"HR fixture" below for the schema and traps.

- `docker/postgres/generate/hr.ts` — generator, fixed `SEED`, all randomness
  through `Rng` (`lib/rng.ts`), invariant `assert`s that throw when a planted
  trap drifts.
- `docker/postgres/init/004_hr.sql` — `CREATE SCHEMA hr`, tables, CHECK
  constraints, PK/FK, indexes, `v_*` views, `COMMENT`s.
- `backend/package.json` — `fixtures:hr` script (only this workstream edits
  `package.json`).
- `backend/scripts/bootstrap-fixtures.ts` — `{ name: 'HR', schema: 'hr' }`,
  `datasetReady.hr`, curated knowledge entries.
- `backend/src/mastra/evals/suites/hr.json` — 10 cases.
- `docs/evals/synthetic-domains.md` — new HR section.
- `docker/postgres/README.md` — schema row.

### 3. Frontend

- `frontend/src/app/features/sessions/models/expert-trace.model.ts` — mirror
  of the backend contract; `ExpertStatus` gains `'failed'`.
- `frontend/src/app/features/sessions/models/session.model.ts` —
  `ChatMessage.expertTrace?: ReasoningTrace`.
- `frontend/src/app/features/sessions/services/sessions-api.service.ts` —
  send `expert: true`; handle SSE `expert-status` → `onExpertStatus?(status)`;
  new `sendBlockFeedback(sessionId, input): Observable<SessionActionResult>`.
- `frontend/src/app/features/sessions/components/session-chat/` — **Expert**
  chip next to **Careful** in the composer, `localStorage['qti.expertMode']`,
  not reset on session switch; status line in the thinking block for
  `expert-status`; renders `app-expert-trace` in the default assistant branch
  right after the markdown content when `message.expertTrace` exists.
- `frontend/src/app/features/sessions/components/expert-trace/` (new,
  `app-expert-trace`) — overall confidence strip, then the five blocks in
  contract order with header (icon, title, confidence badge that toggles a
  signals panel), per-block content, and a feedback row (thumbs, "Add note").
- `frontend/src/app/features/sessions/components/table-join-diagram/` (new,
  `app-table-join-diagram`) — inline SVG table/join diagram, no charting
  library; inputs `tables`, `joins`, `rejected`.
- Tests: `expert-trace.spec.ts`, `table-join-diagram.spec.ts`,
  `sessions-api.service.spec.ts` and `session-chat.spec.ts` updates. `npm run
  build` (or `npx ng build`) and `npx ng test --watch=false` green (or, with
  no browser available, `tsc --noEmit` on both `tsconfig.app.json` and
  `tsconfig.spec.json`).

### 4. Eval harness

- `backend/src/mastra/evals/suite-loader.ts` — optional `expectedReasoning?: {
  tables?: string[]; assumptions?: string[]; metric?: string }` on
  `EvalSuiteCase`, validated; unit test in `suite-loader.spec.ts`.
- `backend/src/modules/expert-mode/expert-metrics.ts` (+ `.spec.ts`) — pure
  functions: `auroc` (Mann-Whitney with tie handling, `undefined` when a class
  is empty), `selectiveAccuracy(rows, band)`, `tablesCoverage`,
  `assumptionsCoverage`, `metricMatched`.
- `backend/scripts/run-eval.ts` — `--expert` flag threads through to
  `streamMessage`; records `{ confidence, band, tablesCoverage,
  assumptionsCoverage, metricMatched, blocks }` per case; prints a summary row
  plus the AUROC headline and high-band selective accuracy; writes an optional
  `expert` field into the run log. Also documented in `--help`.
- `backend/src/modules/agents/eval-telemetry.ts` — optional `expert` field on
  `EvalRunLogRecord`/`EvalRunLogCase`, `schemaVersion` stays `1`.
- `npm run build` + `npm test` green. Dry `--validate` run against the test
  store to prove nothing else broke: `APP_DATA_DIR=<store> npm run
  eval:validate -- --suite world-cup`.

### 5. Docs (this unit)

- `docs/plans/business-expert-mode-engineering.md` (this file)
- `docs/plans/business-expert-mode-explained.md`

## Request / stream / HTTP contract

- `POST /sessions/:id/messages/stream` — body gains `expert?: boolean`.
- `StreamEvent.type` gains `'expert-status'`, content `'cross-check' |
  'explaining' | 'failed'`. Cross-check runs whenever `careful || expert`.
- `ChatMessage.expertTrace?: ReasoningTrace`, present on the assistant message
  once the pass succeeds; absent on clarification turns and on pass failure.
- `POST /sessions/:id/expert/feedback` — body `{ messageAt, block, vote?,
  comment? }`. PATCH semantics: only fields present are changed; `vote: null`
  clears the vote. Upserts a `ReasoningFeedbackDoc` keyed on `(sessionId,
  messageAt, block)`, mirrors `{ vote, comment, at }` onto
  `message.expertTrace.feedback[block]`, returns `{ ok, message, session }`.
- `GET /expert/feedback?sessionId=` — lists feedback docs newest first.

## Confidence signals

Each signal contributes `value` (0..1) with a fixed `weight`; a signal that
cannot be measured is **omitted**, never reported as 0 — missing evidence is
not negative evidence.

| Signal | What it measures | Value rule | Weight per block |
| --- | --- | --- | --- |
| `execution` | The final SQL ran cleanly | 1 clean (no error, no repair, rows > 0, no warnings, not truncated); 0.75 repaired or truncated; 0.5 zero rows or warnings; 0 error/no SQL | sql .25, data-selection .15, metric .10 |
| `schema_grounding` | Referenced tables/columns exist in the bound datasets | (existing table refs + existing column refs) / all refs | data-selection .35, sql .25 |
| `join_grounding` | SQL joins match a declared or inferred relationship | mean over `JOIN … ON a.x = b.y` pairs of [edge exists, either direction]; no joins → 1, note "no joins" | data-selection .25 |
| `knowledge_coverage` | Fraction of items backed by a grounded basis | fraction whose (verified) basis ∈ `GROUNDED_BASES` | interpretation .40 (terms), assumptions .35 (items), metric .40 (0 or 1) |
| `assumption_load` | How many pure guesses the block leans on | `max(0, 1 − guesses/3)`, guesses = items with basis `assumption` | assumptions .25, interpretation .20 |
| `cross_check` | Independent re-derivation agreed | agree 1, disagree 0, error/not run → omitted | sql .30, data-selection .15, metric .20 |
| `verified_match` | SQL matches a user-approved verified query | verified → 1, else omitted | sql .20, metric .20 |
| `self_report` | The model's own verbalized confidence | model's `selfConfidence` for the block | .10 on every block |

**Block score** = Σ(v·w) / Σ(w) over present signals, rounded to 2 decimals;
band from `CONFIDENCE_BANDS` (`score ≥ 0.8` high, `≥ 0.55` medium, else low).

**Overall** = weighted mean of block scores (sql .30, data-selection .25,
assumptions .20, interpretation .15, metric .10; renormalised over the blocks
actually present), then two overrides: cross-check `disagree` →
`min(overall, 0.5)`; `verified` → `max(overall, 0.85)`.
`overall.signals` lists the block-independent contributors: `execution`,
`cross_check`, `verified_match`, `schema_grounding`, and the
`knowledge_coverage` measured on the assumptions block.

## Expert-pass prompt and post-processing

**Which query is "the final SQL".** Not simply the last successful
`run_readonly_sql`: the assistant often runs a supporting query *after* the
one that produced the figure (a `COUNT(*)` to say "over 38 employees", a
sanity check), and explaining or cross-checking that one misdescribes the
answer. `pickAnswerRecord` (`expert-mode/answer-record.ts`) scores every
successful query by how many of its result values the answer text quotes
(decimals, large numbers and strings weigh more than small integers; rounded
and percentage renderings count) and takes the best-supported one, latest on
a tie. An answer that quotes nothing falls back to the last successful query.
The same picker feeds the cross-check, so both describe the same statement.

**What the cross-check verifier sees.** On `main` the `sql-verifier` agent
re-derived the SQL from the question, the schema snapshot and the verified
queries only, without the curated knowledge or the metric definitions. On any
question whose correct answer depends on that knowledge (employees only,
salary as of 31 December, convert to USD) the verifier disagreed with a
correct answer, which turned the `cross_check` signal into an inverted
measure of whether the knowledge was followed. `verifierContext` now hands
the verifier the same knowledge and metrics blocks the assistant received and
its instructions say to apply them; it still never sees the answer's SQL.
This also changes careful mode, which shares the verifier.

**Grading changes made for the same reason** (`scripts/run-eval.ts`): the
graded query is chosen by `pickAnswerRecord` (headline figure first, then the
most-quoted query), a case whose reference matches one of the answer's *other*
complete queries passes as `PASS(alternate-query)` (the in-app suite's "one
complete successful result" rule), and `resultSetOptions.percentEquivalent`
accepts a ratio as fraction or percentage (the `attrition-rate-2025` reference
was changed to an unrounded `100.0 * a / b` for that). These apply to every
suite, not only `--expert` runs, so standard and expert runs stay comparable.

Prompt to the `business-expert` agent (built by `ExpertModeService`, system
instructions live in the agent file) contains: the question; the answer text;
the final SQL with row count, columns and first 5 rows; earlier SQL records as
"exploration steps" (statement, rationale, row count/error); the schema of
every entity the final SQL references (columns as `name type`, `references`
edges) and, for the other bound entities, only key + column names (total
schema budget ~6,000 chars); the knowledge used (kind, title, body); the
metrics block text; the verified queries block text.

Requested output: the LLM-authored parts of each block — `TermMapping`,
`TableChoice`, `JoinEdge`, `RejectedEntity`, `Assumption`, `MetricBlock`
fields, `SqlAnnotation` — plus one `selfConfidence` per block. `dataSelection`,
`metric` and `sql` sections are optional in the schema and must be omitted
when no SQL ran. `basis` must be honest: `knowledge`/`metric`/`verified_query`
only when a `sourceRef` names a snippet/metric/verified query title that
appears in the provided context; `schema` for things read off columns or join
hints; `data_sample` for values seen in rows; `convention` for common business
practice; `assumption` for a guess. Annotation `clause` must be a verbatim
substring of the final SQL. Assumption ids `a1`, `a2`, ….

Call options: `maxSteps: 1`, `toolChoice: 'none'`, `providerOptions: {
openai: { reasoningEffort: 'medium' } }`, `structuredOutput: { schema,
jsonPromptInjection: 'inline' }`, `abortSignal`. One retry on parse failure
with the zod error appended. On a second failure: log and return `undefined`;
`SessionsService` emits `expert-status: 'failed'` and saves the message
without a trace — the answer is never blocked by the explanation.

Deterministic post-processing (in `ExpertModeService`, after the agent call):

a. `sql.sql` := the final statement; `sql.rowCount` := the record's row
   count. Drop any annotation whose `clause` is not a substring of the SQL
   after whitespace normalisation (case-insensitive).
b. Referenced entities := `sql-grounding.ts` extraction from the final SQL
   (FROM/JOIN targets, resolving `schema.table` and `catalog.schema.table`
   against bound entity keys by suffix match; alias map for `alias.column`).
   Table choices not referenced by the SQL are removed; referenced entities
   the model omitted are added with role `lookup`, reason "Referenced by the
   query". Joins keep only pairs whose both sides are referenced entities.
c. Basis verification: a `knowledge`/`metric`/`verified_query` basis whose
   `sourceRef` does not match (case-insensitive substring either way) a
   knowledge title, metric label/name, or a verified query question in the
   input is downgraded to `assumption` — the original `sourceRef` is kept,
   with " (unverified)" appended.

Trace metadata: `id` uuid, `version: 1`, `generatedAt`, `model:
lastAgentModelId()` (`backend/src/mastra/model-resolver.ts`).

## HR fixture

Purpose: a synthetic HR database whose answers are known a priori, matching
the product owner's own example question ("What is the average salary of tech
employees in 2025?"). Follows `docker/postgres/generate/health-insurance.ts`
in style: fixed `SEED`, all randomness through `Rng`, invariant `assert`s that
throw when a planted trap drifts.

Schema `hr` inside the shared `world_cup` Postgres database (dataset name
**HR**; entity keys `world_cup.hr.<table>`): `departments`, `locations`,
`job_titles`, `employees`, `salary_history`, `bonus_payments`,
`performance_reviews`, `time_off_requests`, `exchange_rates`, plus views
`v_current_employees` and `v_salary_by_year`.

Planted traps (asserted in the generator):

1. "Tech employees" = Technology **division**, not job family (≥ 3
   Data-family people sit outside Technology).
2. Salary for a year = the row effective on 31 December; ≥ 20 employees have
   more than one 2025 salary row, so "any row"/"latest row" gives a different
   average than "effective on 2025-12-31".
3. Contractors and interns have salary rows; including them shifts every
   average by a visible amount.
4. The Technology division spans ≥ 2 currencies, so an unconverted average is
   wrong.
5. Exact headcount tie between two departments at end of 2025, active
   employees only — no tie once contractors are included.
6. Terminated employees must be excluded from headcount; ≥ 8 terminations in
   2025.
7. Bonus ≠ salary; total compensation = base + bonus, same year.
8. Promotions in 2025 with a prior row (raise % computable via `LAG` or a
   self-join); ≥ 10 promotions in 2025.
9. Manager hierarchy ≥ 3 levels deep under one named senior manager, so
   "reports to X" is ambiguous between direct and total reports.
10. "Top performer" = rating ≥ 4; ≥ 6 Engineering employees clear it in 2025.

Curated knowledge (seeded via `bootstrap-fixtures.ts`, facts about the data
only, never hints that answer a specific eval question): default filters
"Employees only" and "Active as of a date"; terms "Tech employees", "Salary",
"Local currency", "Top performer", "Total compensation"; metrics
`avg_base_salary_usd`, `attrition_rate`, `total_compensation_usd`.

### The 10 HR eval cases (`backend/src/mastra/evals/suites/hr.json`, id `hr`)

| id | Question | Category |
| --- | --- | --- |
| `avg-salary-tech-2025` | What is the average salary of tech employees in 2025? | domain-semantics |
| `active-headcount-end-2025` | How many active employees did we have at the end of 2025? | control |
| `dept-most-headcount-2025` | Which department had the most active employees at the end of 2025? | ties |
| `total-bonus-2024-usd` | How much did we pay out in bonuses for fiscal year 2024, in USD? | unit-confusion |
| `avg-total-comp-sales-2024` | What was the average total compensation for Sales employees in 2024? | metric-definition |
| `attrition-rate-2025` | What was our attrition rate in 2025? | metric-definition |
| `top-performers-engineering-2025` | Who were the top performers in Engineering in 2025? | domain-semantics |
| `reports-to-manager` | How many people report to <senior manager name>? | clarification (direct vs. total; no `expectedSql`) |
| `highest-avg-salary-location-2025` | Which location had the highest average salary in 2025? | unit-confusion |
| `avg-promotion-raise-2025` | What was the average raise from promotions in 2025? | multi-step-join |

Each case carries `notes` with the exact expected numbers and the numbers the
traps produce, hand-verified `expectedSql`, and the optional
`expectedReasoning: { tables?, assumptions?, metric? }` field used by
`expert-metrics.ts`.

## How to run

```bash
cd backend
npm run fixtures:hr

# load the schema into the RUNNING container (init scripts only run on first start)
docker exec -i questions-to-insights-world-cup-postgres-1 \
  psql -U world_cup -d world_cup -v ON_ERROR_STOP=1 -c 'DROP SCHEMA IF EXISTS hr CASCADE'
docker exec -i questions-to-insights-world-cup-postgres-1 \
  psql -U world_cup -d world_cup -v ON_ERROR_STOP=1 < docker/postgres/init/004_hr.sql

APP_DATA_DIR=<store> npm run fixtures:register
APP_DATA_DIR=<store> npm run eval:validate -- --suite hr    # zero model calls
npm run eval -- --suite hr --expert
```

## Measurement

- **Headline**: AUROC of overall confidence vs. answer correctness (PASS/FAIL)
  over the HR suite. Threshold-independent, works at the suite's small N.
- **Constraint**: selective accuracy inside the high confidence band ≥ 90%.
- Secondary, printed alongside: mean `tablesCoverage`, `assumptionsCoverage`,
  `metricMatched` against each case's `expectedReasoning`.

## Verification

- Backend: `npm run build` + `npm test` green; existing behaviour without
  `expert`/`careful` set is byte-identical.
- Frontend: `npm run build` (or `npx ng build`) and `npx ng test --watch=false`
  green (or `tsc --noEmit` on both configs if no browser is available).
- `APP_DATA_DIR=<store> npm run eval:validate -- --suite hr` — every case OK,
  zero model calls.
- `APP_DATA_DIR=<store> npm run eval:validate -- --suite world-cup` — proves
  the `--expert` plumbing in `run-eval.ts` did not disturb the existing suite.
- No git commits, no changes to the Electron app, no changes outside the
  files listed above.

## Honest limits

- The trace is one extra model call per answer (cost and latency); with
  `careful || expert` it is two, since the cross-check also runs.
- Verbalized confidence (`self_report`) is weak evidence and is weighted
  accordingly (0.10, never load-bearing on its own) — see the research cited
  in the companion explained doc.
- The in-app Evals tab does not run through `SessionsService`, so expert mode
  is measured from the CLI (`npm run eval -- --expert`) only, not from the UI.
- Feedback (thumbs / comments) is persisted in `reasoning_feedback` and
  mirrored onto the message, but nothing yet reads it back into knowledge,
  metrics or prompts automatically — that is future work, not part of this
  plan.
