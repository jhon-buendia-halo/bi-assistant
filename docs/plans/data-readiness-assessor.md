# Plan — Dana, the Data Readiness Assessor

Source specification (the user's, in Spanish): [data-readiness-assessor-source.md](data-readiness-assessor-source.md). Decisions taken with the user on 2026-11-26: Free style, brand `halo`, a **built-in agent**, tools scoped to **what the app already has** (anything else is `N/E`), approach **C — hybrid** (a conversation, with the measurement, levels, gates and verdict computed in code), persona **Dana**.

## 1. Shape

```
Ask Dana (agent page) → conversation run `agent:data-readiness-assessor`
  → engine `data-readiness-assessor-conversation` (a second conversationTurnWorkflow instance, one `answer` step)
    → Dana (person + data): scoping with the requester (ask_clarification suspends/resumes)
      → assess_readiness(scope)  ── code: inventory → D1..D6 measurements → gates → levels → verdict → baseline saved
      → drill-down with the data kit (run_readonly_sql…) when asked
      → the report, in the order of the output contract, in the chat
```

Dana never computes or rounds the verdict: `assess_readiness` returns it, and the report quotes it. The previous agent (Sarah, `data-readiness`) was removed on 2026-11-26; nothing of hers is revived: new key, new table, new panel kind and field names (the start-up drops `readiness_reports`, the `readiness` panel kind and `readinessReport`).

## 2. Names (the contract — copy exactly)

| Thing | Value |
|---|---|
| Agent key | `data-readiness-assessor` |
| Technical name | `Data Readiness Assessor` |
| Persona | name `Dana`, role `Data Readiness Assessor`, domain `data-foundations`, intro `Tell me what you want to use your data for. I measure whether it is ready for that use, show the evidence behind every score and tell you what to fix first.` |
| Classes | `person`, `data` |
| Official | yes (`OFFICIAL_AGENT_KEYS`) |
| Model policy | `step-model` with no Opus routing (like Michael's step model); no memory (like Elena) |
| Conversation workflow id | `agent:data-readiness-assessor` |
| Engine id | `data-readiness-assessor-conversation`, one step `answer` |
| Binding | `kind: 'solo'`, `agentKey` = `hostAgentKey` = the key, author `{ name: 'Dana', role: 'Data Readiness Assessor' }` |
| Tools | `list_entities`, `describe_entity`, `run_readonly_sql`, `sample_rows`, `explore_result`, `ask_clarification`, `assess_readiness` |
| Max steps | 20 |
| Collection | `readiness_assessments` (token `READINESS_ASSESSMENTS_STORE`) |
| Module | `backend/src/modules/readiness-assessor/` (`ReadinessAssessorModule`, exports `ReadinessAssessmentsRepository`) |
| Engine entry point | `assessReadiness(scope: ReadinessScope, port: ReadinessPort, options: AssessReadinessOptions): Promise<ReadinessAssessment>` in `modules/readiness-assessor/assess-readiness.ts` |
| Types | `modules/readiness-assessor/readiness.types.ts` (written; change only through the lead) |
| Tool file | `backend/src/mastra/tools/readiness.tools.ts` (`assessReadinessTool`) |
| Bridge | `backend/src/mastra/readiness-tool-services.ts`: `setReadinessToolServices({ previous, save })` / `getReadinessToolServices()`, installed in `SessionsService.onModuleInit` |
| Skills (folders under `backend/src/mastra/skills/`) | `readiness-scoping`, `readiness-source-inventory`, `readiness-quality-profiling`, `readiness-freshness-reliability`, `readiness-semantics-documentation`, `readiness-governance-privacy`, `readiness-ai-fitness`, `readiness-scoring` (with `reference/rubric.md`), `readiness-gap-remediation`, `readiness-reporting` (with `reference/report-template.md`) |
| Eval set | `data-readiness-assessor` |

## 3. What the engine measures with what the app has

The port is built from the dataset tool services (`getDatasets`, `runReadOnlySql`, `sampleRows`); every SQL statement is a portable aggregate (`COUNT(*)`, `COUNT(col)`, `COUNT(DISTINCT …)`, `MAX(date)`) that runs on Postgres, Databricks and DuckDB. Format, sentinel and PII checks run **in code over a sample** (`sampleRows`, size by risk: low 200, medium 1,000, high 5,000, capped by the connector), so no dialect-specific regex is needed and no personal value leaves the engine.

| Dimension | Measured from | Not evaluated (always declared) |
|---|---|---|
| D1 Availability | the dataset resolves, each critical entity answers `COUNT(*)`, row count and date range; owner from `scope.owners` | owner metadata, support channel |
| D2 Quality | null/empty rate of critical fields (SQL), duplicate grain keys (SQL), invalid formats and sentinel values (sample), orphan references (SQL, from `references`) | accuracy against a source of truth, existing DQ tests |
| D3 Freshness | age of the newest value of the entity's date columns (SQL `MAX`) against `requiredFreshnessHours`; daily volume gaps over the last 30 days when a date column exists | pipeline runs, SLA history, schema history |
| D4 Semantics | share of columns and critical fields with a useful description, schema notes and layers, declared references, cryptic names | governed metric definitions, lineage |
| D5 Governance | PII scan over the sample (email, phone, card number, national id patterns and column-name hints; types and rates only), `personalDataNeeded`, `legalBasis` | classification labels, access policies, retention, audit |
| D6 AI fitness | `rag-agent` over structured data: machine-readable descriptions (from D4), coded values without a dictionary, raw (`landing`) layer exposure, PII exposure | ML labels/balance/leakage, document stores |

Gates, levels, weights and the verdict follow the rubric exactly (source sections 3.3–3.6). Where evidence sits between two levels the engine takes the lower one; a criterion the app cannot measure caps the level at what was measured and is listed in `notEvaluated` (level 4 is reachable only when its automatic-control criterion has evidence, which the app has none of today). Critical dimension = weight >= 20% for the use type. `ready-with-conditions` needs every level-2 dimension to carry at least one verifiable condition, which the engine writes from its findings.

## 4. Units

- **U1 — engine and storage** (`modules/readiness-assessor/`, `database.module.ts`, `doc-store.ts`): rubric data, measurements, levels, gates, verdict, weighted score, baseline delta, `ReadinessAssessmentsRepository` (save, latest by `useCaseKey`). Pure functions tested without a database; the repository with the in-memory store.
- **U2 — Dana** (`mastra/`, `modules/sessions/`, `modules/agents/`, frontend binding): agent, prompt, 10 skills, `assess_readiness`, the bridge, the conversation engine and binding, the turn options branch, the query inspector records for the tool's SQL evidence.
- **U3 — specs**: agents.md, api.md, data-model.md, the data-readiness capability spec (rewritten from tombstone to the live rules), agents-evals, an ADR.
- **U4 — evals** (after U1 + U2): the `data-readiness-assessor` eval set over the Testing Data fixtures with seeded defects (source section 9).
