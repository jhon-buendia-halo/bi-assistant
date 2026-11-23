# Monitoring: the Agent quality tab

Plan only (2026-11-22, Opus 5.5, high effort). Brand `halo`. Branch `feat/monitoring-agent-quality`. The operator approved Option A (wireframe `.context/wireframes/agent-quality/options.mjs`, `optionA`) and two decisions, not reopened here:

1. **Mark eval traffic**: every model call of an eval run (UI and CLI) carries a marker in its trace; Monitoring's live columns exclude marked calls; old unmarked calls count as live.
2. **Save UI and CLI runs with their set and model**: the CLI runner saves its runs to `eval_runs`; every new run records `setId`, `provider`, `model`; the table has a Model filter so pass^3 never mixes models.

## Facts this plan rests on

- **Mastra 1.66.0** (`backend/node_modules/@mastra/core`). `TracingOptions` has `metadata` and `tags`, but both go on the root span only. It also has `requestContextKeys`. `@mastra/observability` `startSpan` calls `extractMetadataFromRequestContext(requestContext, …, traceState)` for every span, root or child, and child spans inherit `traceState`. So a request-context key named in the config's `requestContextKeys` lands in the `metadata` of every span created with that request context. The agent's `model_generation` span is created with it (`agent-*.js` ~27945), and so are `agent_run`, `tool_call` and workflow spans; `model_step`, `model_inference` and `model_chunk` are not.
- `span_events.metadata` is already read on `model_generation` rows (`CALLS_CTE`, `$.threadId`).
- Every eval target forwards `options.requestContext` (the workflow targets, the isolated calls and readiness). The judge does not: `evalJudgeAgent.generate` at `assistant.evals.ts` ~1543 gets no request context.
- Case ids are unique across `EVAL_SETS` (`eval-sets.spec.ts`). The UI runs one set at a time; the CLI's `EVAL_SET` runs one set; its `EVAL_CASES` can span sets that share a fixture.
- Live calls carry the Mastra agent id, which differs from the registry key for `data-readiness` (id `data-readiness-agent`). `AgentSummary` has `key`, `id`, `name`, `role`.
- The CLI has no `datasourceId`, only dataset names. The `active` lock in `EvalRunsService` is per process.
- ADR-0038: the backend holds `observability.duckdb`, so only one process can use the trace store.
- Today eval calls show `session: null` in `GET /monitoring/llm-calls`, like previews; nothing else marks them.

## 1. Data contract (U0 copies this into `api.md`)

### #163 `GET /monitoring/agent-quality`

- Style B. Read-only. Reads `span_events` and `eval_runs` (ADR-0054).
- Query, all optional: `agent` (a registry key); `set` (a set id); `model` (an exact model string, or `Unknown` for runs that recorded none); `from`, `to` (ISO date-times, inclusive; `to` defaults to now; no `from` = all time).
- `400`, exact messages: `"From is not a valid date"`, `"To is not a valid date"`, `"From must not be after To"`.
- An unknown `agent`, `set` or `model` is not an error: it matches nothing. A data dir with no trace table gives live figures of 0 calls, not an error.

```ts
interface AgentQualityPage {
  from: string | null;            // ISO; null = all time
  to: string;                     // ISO
  rows: AgentQualityRow[];        // one per built-in agent with >= 1 eval set; narrowed by agent and by set (a set keeps its own agent only); sorted by persona name
  facets: {                       // never narrowed by the filters
    agents: { key: string; name: string }[];                // agents with sets, by name
    sets: { id: string; name: string; agentKey: string }[];  // every set, by agent name then set name
    models: string[];             // distinct run models of those agents ('Unknown' last) ∪ distinct live call models of their agent ids; sorted
  };
}
interface AgentQualityRow {
  agentKey: string;               // registry key (eval_runs.agentKey)
  agentId: string;                // Mastra agent id (span entityId)
  name: string;                   // persona name
  role: string;                   // persona title, '' when none
  eval: {
    state: 'none' | 'no-match' | 'ok';   // none: no completed run ever; no-match: runs exist, none in scope
    model: string | null;         // the model the eval figures are on (M below)
    provider: string | null;
    runs: number;                 // completed runs in scope on M
    lastRun: { jobId: string; at: string; passed: number; total: number } | null;
    pass3:
      | { state: 'ok'; value: number; cases: number; totalCases: number }
      | { state: 'needs-runs'; runs: 0 | 1 | 2 }
      | { state: 'unknown-model' }
      | null;                     // null unless eval.state === 'ok'
    questions: number;            // case results counted for the tool figures
    toolCalls: number;
    toolCallsPerQuestion: number | null;
    toolErrorRate: number | null; // 0..1
  };
  live: { calls: number; p95Ms: number | null; pricedCalls: number; costPerCallUsd: number | null };
}
```

### Formulas (monitoring R61–R65)

**Which runs count.**
- Start from the agent's runs with `status === 'completed'`.
- Normalise old runs: `setId` is the stored one; if none is stored, the single set of the agent whose cases hold every one of the run's `caseIds`, and `null` when no single set does. `model` is the stored one, else `'Unknown'`; `provider` the stored one, else `null`.
- In scope: with `set`, the run's `setId === set` (a run with no single set counts only under All sets); the run's `finishedAt` (fallback `startedAt`) inside [from, to]; with `model`, the run's `model === model`.
- **M** is the `model` filter if given, else the model of the newest run in scope. **R_M** is the runs in scope on M, newest first.
- `eval.state`: `none` when the agent has no completed run at all; `no-match` when R_M is empty; else `ok`.

**Eval pass rate (last run).** `lastRun` = R_M[0]; `passed` counts its results with `passed`; `total` = `results.length`; `at` = its `finishedAt`. UI chip `${passed}/${total} · ${Math.round(100 * passed / total)}%`. Tone: success when the rate is exactly 1, warning when ≥ 0.8, else danger.

**pass^3.**
- If M is `Unknown`: `{ state: 'unknown-model' }` (runs with no recorded model are never pooled).
- Otherwise: case universe = case ids in R_M's results that are in the agent's current sets (only that set's cases with `set`). Per case, its results from R_M newest first, first 3 kept. Eligible = cases with exactly 3. None eligible: `{ state: 'needs-runs', runs: max over the universe of min(count, 2) }`, shown `needs 3 runs (n of 3)`. Else `value` = share of eligible cases whose 3 results all passed; `cases` = eligible; `totalCases` = universe. Same tones as the pass rate.
- This is the strict "last 3 runs all passed", **not** the unbiased estimator in the wireframe's `data.mjs`.

**Tool calls per question and tool errors** (over every result in R_M): calls per question = Σ `toolCalls.length` / results, `null` with no results; error rate = calls with `error` / Σ calls, `null` with 0 calls.

**Live calls.** The `model_generation` calls (`CALLS_CTE`) whose `agentId` is the row's `agentId`; `startedAt` in [from, to]; `model === model` when filtered (so `Unknown` matches no live call); trace not marked: `traceId NOT IN (SELECT DISTINCT traceId FROM span_events WHERE json_extract_string(metadata, '$."eval-run-id"') IS NOT NULL)`. Old unmarked calls count as live.

**p95 (live).** Nearest-rank `percentile()` of `usage-summary.ts` at 0.95 over `endedAt − startedAt` of finished calls (succeeded or failed; running excluded); `null` when none.

**Cost per call (live).** Σ estimated cost of priced calls (as `usage-summary` prices them, `model-prices.ts`) / `pricedCalls`; `null` when none is priced.

### UI copy

- Tab **Agent quality**. Note: `How each agent persona scores on its evals and behaves in live calls.`
- Filters: **Agent persona** (`All agent personas`); **Eval set** (`All sets`; options narrow to the chosen agent's sets; choosing another agent clears the set); **Model** (`All models`); **Date** (Last 7 days, **Last 30 days** default, Last 90 days, All time; a period starts at local midnight of its first day and ends now, as Costs R48); **Clear filters** (resets defaults; disabled at defaults).
- Columns: **Agent persona** (name, role muted below); **Eval pass rate (last run)** (the chip); **pass^3** (chip, plus muted `(k of N)` when k < N); **Tool calls per question** (one decimal); **Tool errors** (`x %`); **p95 latency (live)** (`17.3 s`); **Cost per call (live)** (`$0.0213`); **Last eval** (`Nov 21`). Missing values `—`.
- No-run text in the pass-rate cell, other eval cells `—`: `No eval run yet` (`none`), `No eval run matches these filters` (`no-match`).
- pass^3 `unknown-model`: `—` with tooltip `Model not recorded for these runs`. Live with 0 calls: `—` with tooltip `No live calls in this period`.
- Loading `Loading agent quality…`; error: inline `role="alert"` with the backend message; empty `No agent persona matches these filters.`
- Legend: `pass^3: share of questions that passed in each of their last 3 runs on the same model. Eval figures come from the agent persona's eval runs; live figures from its LLM calls outside eval runs. Choose a row to open its eval executions.`

### Test ids

Tabs `monitoring-tab-quality`, panel `monitoring-panel-quality`; page `agent-quality-page`; filters `quality-filter-agent`, `quality-filter-set`, `quality-filter-model`, `quality-filter-range`, `quality-filters-clear`; states `monitoring-quality-loading`, `monitoring-quality-error`, `monitoring-quality-empty`; table `agent-quality-table`, rows `agent-quality-row-<key>`; cells `agent-quality-pass-<key>`, `agent-quality-pass3-<key>`, `agent-quality-tools-<key>`, `agent-quality-tool-errors-<key>`, `agent-quality-p95-<key>`, `agent-quality-cost-<key>`, `agent-quality-last-<key>`; legend `agent-quality-legend`.

### Run record (data-model 3.8, new optional fields)

`setId: string | null` (null when the cases span several sets); `provider: string`; `model: string`; `source: 'app' | 'cli'` (absent = `app`). UI runs take `LlmService.getView()` provider and model (no settings: `openai` / `gpt-4o-mini`, the env fallback of data-model 3.2). CLI runs with `EVAL_LLM_PROVIDER=custom` record `custom` / `EVAL_LLM_MODEL`.

### Navigation contract

`AgentsNavState.openAgentEvalRuns(key: string): void` sets `AgentPageState.requestedTab('evals')` and the new `AgentPageState.requestedEvalTab('runs')` (typed `'questions' | 'runs' | null`), then calls `openAgentByKey`, clearing both if the shell refused. `MonitoringTabs` gains `openAgentEvals = output<string>()` (the registry key).

## 2. ADR-0054 (text for `specs/system/architecture.md`)

#### ADR-0054: Eval traffic is marked in the trace, and Monitoring reads eval runs for Agent quality
- **Status:** Accepted. Amends ADR-0038.
- **Date:** 2026-11-22
- **Context:** The operator approved an Agent quality tab on Monitoring: one row per agent persona with its eval pass rate, pass^3 and tool figures from its eval runs, and its p95 latency and cost per call from live calls. Eval runs call the same agents as users do, and nothing tells their traces apart (no tag, metadata or resource id; they show `session: null`, as previews do). CLI eval runs (`run-assistant-evals.ts`) were never saved, and no run recorded its set or model, so pass^3 could mix models.
- **Decision:**
  - **Marker.** Every eval case sets `eval-run-id = <jobId>` in its request context (`EVAL_RUN_CONTEXT_KEY`, `mastra/evals/eval-trace-marker.ts`), and so does its judge. The Observability config lists that key in `requestContextKeys`, so Mastra copies it into the `metadata` of every span created with that request context: agent runs, model calls, tool calls and workflow spans.
  - **Classification.** A model call is an eval call when any span of its trace carries `metadata."eval-run-id"`. Every other call is live, including calls recorded before this change.
  - **Monitoring reads `eval_runs` read-only** through `EvalRunsRepository`. Endpoint #163 joins those runs (by agent registry key) with the trace store's live calls (by Mastra agent id).
  - **Every run records `setId`, `provider`, `model` and `source`.** The CLI saves its runs to `eval_runs` as the UI does; a record is inserted only once its first question has finished, so a preflight refusal leaves nothing. Old runs: the set is derived from `caseIds` when one set holds them all; the model is `Unknown`, and such runs are never pooled into pass^3.
- **Rejected:** `tracingOptions.tags`/`metadata` (root span only; every wrapper target, the judge and the synthesis would need them threaded by hand); matching the throwaway host id `run-eval-<uuid>` (best-effort, absent from calls made without a session); a new eval-calls collection (duplicates the trace store, ADR-0038).
- **Consequences:** every span of an eval trace carries one more metadata key, other traces are unchanged; a model call made in a new trace with a fresh request context would count as live, so any new eval target must forward the case's request context; live figures include old eval calls until they leave the period; the CLI writes to the data dir it boots on, and beside a running app it shares SQLite and Mastra's DuckDB lock, as it already did. **Stack-neutral:** a rebuild needs a per-request key copied onto every span of a trace, a run store with set and model, and a read path over both.

## 3. Spec changes (U0)

- **`specs/capabilities/monitoring/spec.md`**: amend R26 (three tabs LLM calls, Runs, Agent quality; ArrowRight/ArrowLeft move with wrap; Home/End; the third note). Add under "Agent quality": R58 rows and columns; R59 eval vs live calls (ADR-0054); R60 filters and facets; R61 which runs count; R62 pass rate and tones; R63 pass^3; R64 tool figures; R65 p95 and cost per call; R66 no-run, empty, loading, error copy and the legend; R67 a row (click or Enter) opens the agent's Evals tab on Executions, with Agent personas the current rail item; R68 400 messages, read-only (R24). Update Contracts (#163, `eval_runs`, ADR-0054) and UI (the tab line). Edge cases: an agent with sets but no run; old runs with model `Unknown`; a set filter; fewer than 3 runs; a model with no price. New `Feature: Agent quality` with `` E2E: `frontend/e2e/monitoring-agent-quality.spec.ts` ``; scenarios: the tab and note; an agent with no run shows "No eval run yet"; after one eval run the pass chip, `needs 3 runs (1 of 3)` and that agent's live columns `—`; a live run shows p95 for its agent; the Model filter offers the run's model; Clear filters; a row opens Executions; arrow keys cycle the three tabs.
- **`specs/capabilities/agents-evals/spec.md`**: R112 every run records its set (null across several sets), provider, model and source; R113 CLI runs are saved, listed in Executions and compared as UI runs, nothing saved when refused before the first question; R114 every model call of a run, judge and tool-only synthesis included, carries the eval marker (ADR-0054); amend R34 (Executions can be opened directly from Monitoring, monitoring R67); edge case: the CLI's `datasourceId` is the datasets' one shared datasource, else `""`.
- **`specs/system/api.md`**: 2.8c table row #163 ("seven routes; #163 also reads `eval_runs`"); #36 side effects (new fields); #37 `EvalRunView` gains the fields; 3.3 CLI runs persisted too; 6.2 an `EVAL_*` note that runs are saved.
- **`specs/system/data-model.md`**: 3.8 the four fields, fix "only `assistant` has evals", the old-run reading rule; 1.2 `span_events.metadata."eval-run-id"`.
- **`specs/system/agents.md`**: 8.3 the request context gains `eval-run-id`, the judge gets the case's request context; 8.4 the run shape; 8.5 the CLI saves its run and prints `Saved as eval run <jobId>`, a save failure prints `Could not save the run: <reason>` and does not change the exit code.
- **`specs/product/glossary.md`**: **eval call**, **live call**, **pass^3**.
- **`roadmap.md`**: the feature, citing `plan monitoring-agent-quality`.

## 4. Units of work

Order: U0, then {U1, U3, U4, U5} in parallel, then U2 (needs U1's parameter), then U6. Each unit owns only its files; U0's contract code is the only shared code and lands first.

### U0 — contract, specs, ADR (first)

Owns every spec file of §3, new `backend/src/mastra/evals/eval-trace-marker.ts` (framework-free: `EVAL_RUN_CONTEXT_KEY = 'eval-run-id'`, `EVAL_RUN_METADATA_PATH = '$."eval-run-id"'`), new `backend/src/modules/monitoring/entities/agent-quality.entity.ts` (the §1 types), and optional `setId`, `provider`, `model`, `source` on `EvalRunView` in `eval-runs.service.ts` (types only). Verify: `python3 scripts/check-specs.py`; type-check.

### U1 — mark eval traffic

Owns `backend/src/mastra/evals/assistant.evals.ts`, `assistant.evals.spec.ts`, `backend/src/mastra/index.ts`. `evalRequestContext` takes `evalRunId?` and sets the key; `runAssistantEvalCase` gets a sixth parameter `evalRunId?: string`, `runAssistantEvals` a seventh, passed through; the judge receives the case's request context and passes `requestContext` to `evalJudgeAgent.generate`; `configs.local.requestContextKeys: [EVAL_RUN_CONTEXT_KEY]`. Jest: the case's request context carries the id; no key without an id; the judge's `generate` receives the same request context. Wave check: on a fresh data-dir copy and the LLM stub, one case per target kind (assistant, `insights-analyst` workflow, `data-readiness` workflow, an isolated call such as `answer-writer`, `query-explainer`): every `model_generation` of those traces carries the key; save one real marked row's `metadata` under `evidence/` for U3's test.

### U3 — endpoint #163

Owns new `backend/src/modules/monitoring/agent-quality.ts` (pure: normalise runs, scope, pass rate, pass^3, tool figures, live p95 and cost) + spec; new `dto/agent-quality-query.ts` + spec; new `agent-quality.catalogue.ts` (token `AGENT_QUALITY_CATALOGUE`, a factory over `EVAL_SETS`, `builtinAgentPersona` and the Mastra agent ids, producing plain `{ key, agentId, name, role, sets: { id, name, caseIds }[] }[]`; the only Mastra import); new `agent-quality.service.ts` + spec; `monitoring.controller.ts` (`@Get('agent-quality')`); `monitoring.module.ts` (providers `EvalRunsRepository`, the catalogue, the service); `repositories/span-events.repository.ts` (`liveCallRows({ agentIds, model?, from?, to? })` with the not-marked clause, `liveModels(agentIds)`). Tests: formula tables (tone edges 1, 0.8, 0.79; pass^3 with 3, 2, 0 runs; a case dropped from the suite excluded; unknown model; set derivation for old runs; date and model scope; tool rate with 0 calls); service on the real-shape DuckDB fixture (`cloneTrace` gives a trace whose rows get `metadata."eval-run-id"`: excluded from live; an unmarked clone counted; do not edit `span-events.fixture.ts`); validation messages; no trace table gives 0 live calls.

### U4 — the tab UI

Owns new `frontend/src/app/features/monitoring/models/agent-quality.model.ts` (types, `toQualityQuery`, `qualityTone`, formatters, `QualityRange = 'week' | 'month' | 'quarter' | 'any'`) + spec; new `components/agent-quality-page/agent-quality-page.{ts,html,spec.ts}` (the `llm-calls-page` pattern: signals, `toObservable`, `switchMap`; chips `chip-success`, `chip-warning`, `chip-danger`; output `openAgent`); `services/monitoring-api.service.ts` (`getAgentQuality`); `services/monitoring-state.service.ts` + spec (`MonitoringTab` adds `'quality'`; `qualityFilters`, `setQualityFilter`, `clearQualityFilters`, `hasQualityFilters`); `components/monitoring-tabs/monitoring-tabs.{ts,html}` + new `monitoring-tabs.spec.ts` (three tabs; `step(tab, ±1)` with wrap, Home/End; note per tab; the quality panel; output `openAgentEvals`). Tests with `npx ng test --watch=false --browsers=ChromeHeadless`, `HttpTestingController` against the §1 shape: every cell state, the copy, set options narrowing, Clear filters, keyboard wrap, a row's click and Enter emitting the key; reset `localStorage` and focus in `beforeEach`.

### U5 — open Executions

Owns `frontend/src/app/features/agents/services/agent-page-state.service.ts` (`requestedEvalTab`), `agents-nav-state.ts` (`openAgentEvalRuns`), `components/agent-detail/agent-detail.ts` (in the `requestedTab` effect, after setting the tab, apply `requestedEvalTab` through `selectEvalTab`, which loads the runs, then clear it; this runs after the agent-change reset that sets `questions`), new `components/agent-detail/agent-detail-requested-subtab.spec.ts`. Tests: the Executions sub-tab opens and runs load; a refusal clears both requests; a plain open still lands on the default tab.

### U2 — run metadata and saving CLI runs (after U1)

Owns `backend/src/modules/agents/eval-runs.service.ts`, `eval-runs.service.spec.ts`, `backend/src/mastra/evals/run-assistant-evals.ts`. UI start: inject `LlmService`; `setId` from `selectEvalSets(caseIds, evalSetsFor(agentKey))` (exactly 1 set gives its id, else `null`); provider and model as in §1; `source: 'app'`; pass `view.jobId` as `evalRunId`. CLI recorder `cliRun({ agentKey, datasets, caseIds, provider?, model? })` returns `{ jobId, add(result), finish(error?) }`: inserted on the first `add` with the `startedAt` captured at creation; each `add` saves; `finish` sets completed or failed, `finishedAt` and the comparison; nothing stored with no result; `datasourceId` = the one distinct datasource of the datasets, else `""`. The CLI passes `jobId` to `runAssistantEvals` and prints `Saved as eval run <jobId>`. Tests: the start record's fields; `runAssistantEvalCase` called with the jobId; recorder lifecycle and the no-result case; datasource derivation; comparison. Wave check: run the CLI once on the stub and see the run in Executions.

### U6 — wiring and E2E (after U1–U5)

Owns `frontend/src/app/features/monitoring/components/monitoring-area/monitoring-area.{ts,html,spec.ts}`, new `frontend/e2e/monitoring-agent-quality.spec.ts`. Bind `(openAgentEvals)="agentsNav.openAgentEvalRuns($event)"`; unit test: a row leads to agent detail. E2E (web project, `BRAND=halo`): the LLM stub, `saveLenaiSettings`, a World Cup datasource and dataset with `WORLD_CUP_EVAL_TABLES`; start `POST /agents/assistant/evals/run` with `caseIds: ['champion-2022']` and poll to the end; `runQuestionOk` once for live Insights Analyst calls. Assert: arrow keys cycle the three tabs; the assistant's pass chip matches `/^\d\/1 · \d+%$/`; pass^3 `needs 3 runs (1 of 3)`; the assistant's p95 and cost `—` (the exclusion proof: the assistant has no live call); Insights Analyst's p95 matches `/\d+\.\d s/`; the Model filter offers `stub-deployment`; an agent with no run shows `No eval run yet`; Clear filters disabled at defaults; clicking the assistant row opens Agent personas, Evals tab, Executions showing the run; axe in both themes. Run the E2E before any backend build or unit tests.

## 5. Risks

1. **An unmarked eval call**: any path that starts a new trace with a fresh request context counts as live (e.g. a tool that calls another agent). Trace-level classification covers nested calls in the same trace; U1's per-target wave check and the E2E's `—` guard the rest.
2. **Model strings**: the settings' `model` may differ from the span's `attributes.model` (Copilot `auto`, LenAI deployments, `responseModel`), so the Model facet can show near-duplicates and live figures can drop out under a model filter. pass^3 pools on the model string only.
3. **CLI and app together**: the CLI writes the data dir it boots; beside a running app it shares SQLite and the DuckDB lock, with no cross-process one-run-per-agent lock. Evals run on a copy (lessons), so CLI runs show only in that copy.
4. **pass^3 definition**: strict "last 3 all passed", not the τ-bench estimator; partial coverage shows `(k of N)`.
5. **Old eval calls count as live** until they leave the period (30 days by default).
6. **Payload size**: every completed run, answers and tool I/O included, is read per request; fine locally, watch large histories.
7. **A Mastra upgrade** that changes `requestContextKeys` would silently stop the marking; the E2E pins it.
8. **Effect ordering in `agent-detail.ts`**: the reset effect must run before the requested sub-tab is applied.
