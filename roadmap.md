# Roadmap

Pre-implementation plan for all work. Hierarchy: **Release → Milestone → Feature** (`R`, `R.M`, `R.M.F`). See *Planning convention* in [CLAUDE.md](CLAUDE.md).

Status legend: `📋 Planned` · `🚧 In progress` · `✅ Done` · `🚫 Cut`

Feature template:

```
#### R.M.F — <Feature name>  `📋 Planned`
- **Intent:** why this exists / the user-observable outcome.
- **Scope:** what is in.
- **Out of scope:** what is explicitly not.
- **Acceptance:** verifiable criteria (map to gherkin.md scenarios).
- **Notes:** links (docs/plans, ADRs, evidence), dependencies.
```

---

<!-- Releases go here. Promote Backlog items into a milestone before starting work. -->

## Release 0 — Maintenance

Correctness fixes to the shipped app that don't belong to a product phase.

### Milestone 0.1 — Desktop runtime correctness

Electron shell, backend spawning, and renderer↔backend wiring: the app must behave the same however it is launched or configured.

#### 0.1.1 — Renderer honours a non-default `BACKEND_PORT`  `📋 Planned`
- **Intent:** setting `BACKEND_PORT` must move the whole desktop app to that port, not just the backend. Today the main process spawns the backend and runs its readiness probe on `BACKEND_PORT` (`frontend/electron/main.cjs`), but under `file://` the renderer hardcodes `http://localhost:3000` (`frontend/src/app/core/config/api.config.ts`), and the preload bridge doesn't expose the port. With `BACKEND_PORT=3123` the window opens and every API call fails, or it quietly reaches whatever else is listening on 3000.
- **Scope:** pass the resolved port from the main process to the renderer before Angular boots: through `preload.cjs` (`contextBridge`, e.g. `window.qti.backendPort`) or a query parameter on the `loadFile` / dev URL. Make `API_BASE_URL` read it and fall back to 3000. Cover `npm run electron`, `electron:dev` and packaged builds.
- **Out of scope:** automatic free-port fallback in Electron (the CLI already has one); the web / `npx` mode, which is same-origin and unaffected.
- **Acceptance:**
  - With `BACKEND_PORT=3123`, the packaged and `npm run electron` apps load sessions, datasources and chat against port 3123, and nothing requests `:3000`.
  - With no `BACKEND_PORT`, behaviour is unchanged.
  - A Playwright scenario in `frontend/e2e/` launches Electron with a non-default `BACKEND_PORT` and asserts the shell loads data (new Gherkin scenario under *Layout and accessibility* or a new *Desktop runtime* feature).
  - The `API_BASE_URL` sentence in CLAUDE.md ("Known gap") is updated.
- **Notes:** found while drawing the C4 container diagram ([architecture.md](architecture.md), Level 2). Related to ADR-0001.

### Milestone 0.2 — Delivery process

How work is planned, built, verified and traced. It covers the repo's process documents and conventions, not product behaviour.

#### 0.2.1 — Adopt the delivery workflow, beta roadmap and branching convention ([BA-84](https://halo-powered.atlassian.net/browse/BA-84))  `🚧 In progress`
- **Intent:** every change follows the same plan → spec → test → implement → evidence → retrospective loop and traces back to a Jira issue.
- **Scope:**
  - The eleven-step workflow and its conventions in CLAUDE.md, including the branching convention.
  - Seeded process documents at the repo root: roadmap, architecture (C4 diagrams and ADRs), gherkin, changelog, retrospective and evidence.
  - The 1.0 Beta plan imported from Jira.
  - CLAUDE.md corrected where it had drifted from the code.
- **Out of scope:** product code changes. The port bug is tracked separately as 0.1.1.
- **Acceptance:**
  - CLAUDE.md describes the workflow and conventions.
  - Every process file it references exists.
  - The roadmap mirrors the BA 1.0 Beta epics and stories.
  - The work is merged through a PR from `docs/BA-84-claude-harness`.

## Release 1 — 1.0 Beta  (target 2026-10-31)

Source of truth for scope and dates: Jira project **BA**, version *1.0 Beta* ([timeline](https://halo-powered.atlassian.net/jira/software/projects/BA/boards/2688/timeline)). Each milestone mirrors one Jira epic and each feature mirrors one story, so IDs map 1:1. Imported 2026-10-01. Status changes are made in both places.

Timeline (from the Jira timeline):

| Milestone | Epic | Window |
|---|---|---|
| 1.1 Golden Dataset and Evals | [BA-9](https://halo-powered.atlassian.net/browse/BA-9) | Oct 1 – Oct 31 (runs throughout) |
| 1.2 Data Model DSL | [BA-2](https://halo-powered.atlassian.net/browse/BA-2) | Sep 30 – Oct 16 |
| 1.3 Knowledge Store | [BA-4](https://halo-powered.atlassian.net/browse/BA-4) | Sep 30 – Oct 16 |
| 1.4 Response Reliability Signals | [BA-12](https://halo-powered.atlassian.net/browse/BA-12) | Sep 30 – Oct 16 |
| 1.5 Data Connectors | [BA-5](https://halo-powered.atlassian.net/browse/BA-5) | Sep 30 – Oct 23 |
| 1.6 User Testing | [BA-10](https://halo-powered.atlassian.net/browse/BA-10) | Oct 19 – Oct 23 |
| 1.7 Bug Fixes | [BA-11](https://halo-powered.atlassian.net/browse/BA-11) | Oct 26 – Oct 30 |

Evals come first in the order even though they run in parallel: every other milestone is measured against them.

### Milestone 1.1 — Golden Dataset and Evals ([BA-9](https://halo-powered.atlassian.net/browse/BA-9))

The measurement baseline. Every change to the DSL, knowledge store or connectors is measured against it before the beta ships.

#### 1.1.1 — Golden dataset and eval suite  `📋 Planned`
- **Intent:** know, with numbers, whether a change made answers better or worse.
- **Scope:** a golden dataset of representative questions with known-correct answers on the sample fixtures. An eval suite (LLM judge plus SQL and result checks) that runs against it, building on the existing `assistant-eval-judge` agent and `mastra/evals/` and the Agents → Evals tab.
- **Out of scope:** evals on customer data.
- **Acceptance:** the suite runs on demand against the golden dataset and reports per-question and per-category results. Results can be compared run to run, and a knowledge on/off comparison is possible (needed by 1.3.3).
- **Notes:** Jira has no stories under this epic yet, so this feature mirrors the epic. Split it into stories in Jira first, then mirror them here.

### Milestone 1.2 — Data Model DSL ([BA-2](https://halo-powered.atlassian.net/browse/BA-2))

The structure the assistant reasons over, as a single, versionable source of truth. Decision record and alternatives: [docs/plans/ba-2-data-model-dsl-alternatives.md](docs/plans/ba-2-data-model-dsl-alternatives.md) (decided 2026-10-01: a storage-neutral DSL with per-datasource bindings, a logical query layer so the assistant reasons over abstract entities, and the Knowledge Store mapping question vocabulary onto DSL references). Beta datasources: Postgres, Databricks, REST API. ADR-0006 and ADR-0007 in [architecture.md](architecture.md). Assignee: Jhon Buendia.

#### 1.2.1 — Data model DSL: schema, bindings, bootstrap and metrics migration ([BA-85](https://halo-powered.atlassian.net/browse/BA-85))  `✅ Done`
- **Intent:** every dataset has one versioned, validated data model (entities, attributes, relationships, metrics, bindings) that exists without user work and that the assistant and the Knowledge Store can address.
- **Scope:**
  - `DataModel` types and Zod schema (JSON Schema exported); portable attribute types, roles, relationship cardinality, metrics in the portable aggregation core with a dialect-tagged `expressions.sql` escape hatch; bindings per datasource kind (`sql`, `rest` executable in the beta; `mongo`, `file` accepted by the schema, no adapter).
  - YAML parse / serialize with line-and-column errors; semantic validation (unique names, resolvable relationship and metric targets, binding columns that exist).
  - `data_models` collection, one document per dataset with immutable versions and a current pointer; revert.
  - Automatic bootstrap of v1 from the physical snapshot on dataset save and, on startup, for every existing dataset without a model. A re-save merges newly included tables into a new version (additive only) and records a drift report for removed or changed attributes; user edits are never overwritten.
  - Metrics: the shared `metrics` store was the metrics panel's editor of record until 1.2.3, which moved the panel onto the model directly (`/datasets/:name/model/metrics*`); every legacy-store write still mirrors into each model that binds the table (`syncMetric`/`removeMetric`), except for a metric name a model now manages itself — the model wins for names it has, the legacy store is only mirrored in for names it is missing.
  - Logical reference format (`entity`, `entity.attribute`, `metric:name`, `rel:from->to`) and a `resolveRef` API for the Knowledge Store (1.3.2).
  - API: `GET/PUT /datasets/:name/model`, versions, revert, drift, resolve, JSON Schema.
- **Out of scope:** the logical query layer and prompt rendering (1.2.2); editing UI (1.2.3); Mongo, CSV and JSON adapters (Backlog).
- **Acceptance:**
  - Every existing dataset has a model v1 after upgrade with no user action, and a newly saved dataset gets one immediately.
  - A model whose attribute references a binding column that does not exist fails validation with a line and column.
  - Metrics created before the change appear in the model and still ground answers; the metrics panel works unchanged.
  - `resolveRef` resolves and rejects references against a given model version.
  - A changed snapshot yields a drift report without altering the current model version.
- **Notes:** backend-only; API-level flows live in `backend/test/data-models.e2e-spec.ts` (see [gherkin.md](gherkin.md) *Feature: Data model*). Must ship before 1.3.2 migrates knowledge snippets.

#### 1.2.2 — Logical query layer: the assistant reasons over abstract entities, measured by evals ([BA-86](https://halo-powered.atlassian.net/browse/BA-86))  `✅ Done`
- **Intent:** answers are built from one definition of each entity, relationship and metric, regardless of where the data lives; the assistant never sees table names or SQL dialects.
- **Scope:** logical query spec (from, select, portable filters, group_by, order_by, limit, traverse along declared relationships) constrained by JSON Schema; one SQL compiler for Postgres, Databricks SQL and SQLite with dialect differences in one place; REST entities through the existing materialise-to-SQLite path; `describe_entity`, `query_entities`, `sample_records` tools replace the table-level tools; one rendered model block replaces the orientation, join-hint and metrics blocks; raw SQL demoted to an internal fallback that flags the answer as outside the model; `sql-fixer` stays for runtime repair of compiled SQL, `query-fixer` / `query-verifier` replace `sql-verifier` at the logical level; eval run on both paths.
- **Out of scope:** non-SQL adapters; editing UI.
- **Acceptance:** no `catalog.schema.table` or dialect names in the prompt or tool calls; logical queries compile to valid SQL on Postgres, Databricks and the REST materialisation; unknown attributes or undeclared relationships are rejected before any database call; metrics are computed by the compiler; the eval report shows per-question results for both paths and the raw-SQL fallback count.
- **Notes:** depends on 1.2.1 and, for the golden set, 1.1.1 (World Cup / F1 eval sets as stopgap). ADR-0007 (now Accepted). No LLM key is available in this environment — the dual-path eval plumbing (path selection, agent selection, counters, report fields) is unit-tested with a stubbed agent; the two real comparison runs are documented in [evidence/1.2.2/README.md](evidence/1.2.2/README.md) for the team to run once a key is configured.

#### 1.2.3 — Data model editing, versioning and export ([BA-87](https://halo-powered.atlassian.net/browse/BA-87))  `✅ Done`
- **Intent:** analysts curate the model, see its history and move it as a file.
- **Scope:** Gherkin + E2E first; raw YAML editor with line/column errors; version list, diff and revert; export / import `.yaml`; structured forms for entities, attributes, relationships and metrics; the metrics panel reads and writes the model.
- **Out of scope:** Ossie / Databricks Metric Views import (Backlog).
- **Acceptance:** fixing a relationship's cardinality in the editor and saving changes the next answer; an invalid edit is rejected with the offending line highlighted and the current version untouched; reverting changes what the assistant sees on the next turn; an exported file re-imports identically apart from the version header (`model`/`version` are doc-level truth `appendVersion` always rewrites; every entity, relationship and metric matches byte-for-byte).
- **Notes:** depends on 1.2.1. Design brief: [docs/plans/ba-87-model-editing.md](docs/plans/ba-87-model-editing.md). Backend: export/import/serialize + model-scoped metrics CRUD on `DataModelsController`, a new `GET /datasets/:name/model/versions` list endpoint, and the `syncMetric`/`removeMetric` merge-rule flip (`localMetricNames` — the model wins for names it manages itself; `deletedMetricNames` tombstones an explicit delete against `rebootstrap`/`mergeSnapshot`/`syncMetric`). Frontend: new `features/data-model/` (api service, models, `data-model-view` + `model-yaml-editor` + `model-versions` + `entity-editor` + `model-metrics-panel`), `shared/utils/line-diff.ts`; the legacy `features/datasets/components/metrics-panel` and its service/model are deleted. The `model-metrics-panel`'s `where` builder supports one `{attr, op, value}` condition, not the DSL's full boolean tree — documented as a scope reduction; a metric shape the form cannot represent opens read-only instead. `MetricsService.definitionBlock` (the governed-metrics prompt block) reads the current data model for any table it binds, falling back to the legacy store only for tables no model binds — a panel edit/delete now actually reaches answers. Verified Done only after `frontend/e2e/data-model-editing.spec.ts` ran green (7/7) against the real Electron app, following a code-review round that fixed two real Playwright failures (`<select>` option binding, Electron download handling) plus 10 further findings. Evidence: [evidence/1.2.3/](evidence/1.2.3/).

### Milestone 1.3 — Knowledge Store ([BA-4](https://halo-powered.atlassian.net/browse/BA-4))

Curated knowledge the assistant treats as authoritative: glossary terms, standing instructions and default filters, scoped to a datasource or dataset. Covers authoring, mining suggestions from past sessions, and injecting the relevant snippets into each turn. Assignee: Sergio Berrospi.

#### 1.3.1 — Research and ontology design ([BA-78](https://halo-powered.atlassian.net/browse/BA-78))  `📋 Planned`
- **Intent:** an evidence-based design for how the knowledge store models business meaning, so query generation follows each data store's ontology.
- **Scope:**
  - Compare Databricks Genie, Snowflake Cortex Analyst semantic models, the dbt Semantic Layer, Cube and knowledge-graph text-to-SQL research.
  - Define the concept and relation model: concepts, synonyms, mappings to tables, columns and SQL expressions, and relations (is-a, has-many, measured-by).
  - Set the boundary with 1.2: the DSL holds structure, the knowledge store holds meaning.
  - Plan the snippet migration: terms become concepts, default filters become concept constraints, instructions are kept.
- **Out of scope:** implementation.
- **Acceptance:** the decision record is merged in `docs/` (as an ADR in [architecture.md](architecture.md)) and the model is agreed.

#### 1.3.2 — Ontology model, knowledge graph and bootstrap ([BA-79](https://halo-powered.atlassian.net/browse/BA-79))  `📋 Planned`
- **Intent:** business concepts and their relations live in one graph and are drafted automatically, so setup takes minutes.
- **Scope:**
  - The concept and relation schema and its storage.
  - Migrate existing snippets without losing data, using the `LEGACY_*` pattern in `database.module.ts`.
  - Link metrics, verified queries and dataset relationships to concepts, queryable by dataset and datasource.
  - Extend the `knowledge-bootstrap` agent to propose concepts and relations from schema, sample values, relationships and past thumbs-up answers. Drafts arrive disabled for review.
- **Out of scope:** the curation UI (1.3.4).
- **Acceptance:** a dataset can be bootstrapped into a reviewed ontology, and the graph returns a concept with its metric, mappings and example queries.
- **Notes:** depends on 1.3.1.

#### 1.3.3 — Ontology-grounded retrieval and SQL generation, measured by evals ([BA-80](https://halo-powered.atlassian.net/browse/BA-80))  `📋 Planned`
- **Intent:** each answer is built from the knowledge relevant to the question and checked against it, so terms like "revenue" always mean the same thing.
- **Scope:**
  - Match questions to concepts (synonyms, embeddings, entity overlap), expand one hop to related concepts, and rank within the context budget. This replaces today's newest-first selection.
  - The prompt carries the concept mappings: columns, joins and default filters.
  - `sql-verifier` flags queries that contradict a concept, and the `sql-fixer` loop repairs them.
  - Retrieval is logged per turn.
- **Out of scope:** UI for provenance (1.3.4).
- **Acceptance:** a golden-dataset eval (1.1.1) runs with knowledge on and off, with per-concept attribution, and shows the accuracy difference with no category getting worse.
- **Notes:** depends on 1.3.2 and 1.1.1.

#### 1.3.4 — Curation UI, feedback learning and provenance ([BA-81](https://halo-powered.atlassian.net/browse/BA-81))  `📋 Planned`
- **Intent:** analysts curate the ontology, corrections feed back into it, and users see what shaped each answer.
- **Scope:**
  - Browse, approve and edit concepts and relations, and enable or disable them per dataset.
  - Conflict detection: the same synonym on two concepts, or contradictory filters.
  - A thumbs-down with a correction suggests a concept edit, and approved answers link back to the concepts they used.
  - The answer panel shows which concepts and definitions were used.
- **Out of scope:** —
- **Acceptance:** an analyst can fix a wrong answer by editing a concept, and the next answer cites it.
- **Notes:** a new UI surface, so it needs Gherkin scenarios and E2E specs first. The provenance display ties into 1.4.1.

### Milestone 1.4 — Response Reliability Signals ([BA-12](https://halo-powered.atlassian.net/browse/BA-12))

Show users how much to trust each answer. Assignee: Sergio Berrospi.

#### 1.4.1 — Answer trust signals  `📋 Planned`
- **Intent:** beta users can tell a solid answer from one that needs checking.
- **Scope:** per-answer signals:
  - whether the SQL was verified or auto-corrected
  - a match with a verified query
  - empty or suspicious results
  - the knowledge and data the answer relied on

  This builds on the existing SQL self-correction, verified queries and answer feedback.
- **Out of scope:** —
- **Acceptance:** *to be defined.* The Jira epic has only a description.
- **Notes:** see [docs/plans/phase-1-answer-reliability.md](docs/plans/phase-1-answer-reliability.md) and [docs/plans/phase-2-trust-ux.md](docs/plans/phase-2-trust-ux.md); confirm what has already shipped. The epic has no `1.0 Beta` fix version in Jira although it sits in the beta window.

### Milestone 1.5 — Data Connectors ([BA-5](https://halo-powered.atlassian.net/browse/BA-5))

Connect to the sources beta users actually have. Each connector needs reliable connection setup, schema discovery and read-only querying. All three kinds already exist in code (`DatasourceKind = 'databricks' | 'postgres' | 'rest'`), so this milestone is about hardening them to beta quality.

#### 1.5.1 — Databricks ([BA-6](https://halo-powered.atlassian.net/browse/BA-6))  `📋 Planned`
- **Intent:** beta users can query a Databricks SQL warehouse.
- **Scope:** connect with host, HTTP path and token; discover catalogs, schemas and tables through Unity Catalog; run read-only SQL.
- **Out of scope:** write access.
- **Acceptance:** *drafted from the epic; the Jira story has no description, so confirm there.* Connection setup validates and reports failures clearly, Unity Catalog discovery lists catalogs, schemas, tables and columns, and only read-only statements run.

#### 1.5.2 — Postgres ([BA-7](https://halo-powered.atlassian.net/browse/BA-7))  `📋 Planned`
- **Intent:** beta users can query PostgreSQL.
- **Scope:** connect with host, port, database and credentials (with SSL); discover schemas, tables and columns; run read-only SQL.
- **Out of scope:** write access.
- **Acceptance:** *drafted from the epic; confirm in Jira.* SSL connections work, discovery is complete, and only read-only statements run. The existing *Datasources, datasets, and sessions (World Cup database)* scenarios in [gherkin.md](gherkin.md) stay green.

#### 1.5.3 — REST API ([BA-8](https://halo-powered.atlassian.net/browse/BA-8))  `📋 Planned`
- **Intent:** beta users can query HTTP APIs as datasets.
- **Scope:** connect with each API's auth, discover endpoints from OpenAPI specs, and map JSON responses into tabular datasets.
- **Out of scope:** —
- **Acceptance:** *drafted from the epic; confirm in Jira.* An OpenAPI spec yields selectable endpoints, and a JSON response maps to rows the assistant can query.

### Milestone 1.6 — User Testing ([BA-10](https://halo-powered.atlassian.net/browse/BA-10))

Hands-on testing of the beta build with real users and their data. No fix version in Jira yet.

#### 1.6.1 — Beta user testing round  `📋 Planned`
- **Intent:** find what breaks or confuses real users before release.
- **Scope:** real users install the app, connect a source, ask questions and build visuals; issues, confusing flows and wrong answers are captured as Jira bugs or feedback under [BA-11](https://halo-powered.atlassian.net/browse/BA-11).
- **Out of scope:** fixing (1.7).
- **Acceptance:** every finding is filed in Jira and triaged into 1.7 or the backlog.
- **Notes:** needs an installer build (**Actions → Build desktop installers**) of the release-candidate tag.

### Milestone 1.7 — Bug Fixes ([BA-11](https://halo-powered.atlassian.net/browse/BA-11))

Fix the bugs and blockers from user testing and the golden-dataset evals, and stabilize the build for the Oct 31 release. No fix version in Jira yet. New bugs filed under BA-11 get a feature here.

#### 1.7.1 — Session thread is empty after navigating away and back ([BA-83](https://halo-powered.atlassian.net/browse/BA-83))  `📋 Planned`
- **Intent:** returning to a session always shows its history.
- **Scope:** `SessionChat` only resets its messages when the session id changes (`frontend/src/app/features/sessions/components/session-chat/session-chat.ts`, the effect around line 255). Check whether the session is re-fetched on return, and that leaving mid-stream resets `sending()`.
- **Out of scope:** —
- **Acceptance:**
  - Returning to a session always shows its messages without a refresh, including after leaving mid-stream.
  - Same-id refreshes still do not abort an in-flight stream (the existing `SessionChat` rule in CLAUDE.md).
  - An E2E test covers leaving and returning.

#### 1.7.2 — Release stabilization  `📋 Planned`
- **Intent:** a shippable 1.0 Beta on 2026-10-31.
- **Scope:** blockers from 1.6 and 1.1; full E2E suite green; installers built for all platforms and published to the release.
- **Acceptance:** release tagged and installers attached; no open blocker bugs in BA.

## Backlog

Not yet sequenced into a release. The detailed phase plans below predate this roadmap; when work on one resumes, split it into features under a milestone here and link back to the plan.

- Answer reliability — [docs/plans/phase-1-answer-reliability.md](docs/plans/phase-1-answer-reliability.md)
- Trust UX — [docs/plans/phase-2-trust-ux.md](docs/plans/phase-2-trust-ux.md)
- Visual quality + interactivity — [docs/plans/phase-3-visual-quality-interactivity.md](docs/plans/phase-3-visual-quality-interactivity.md)
- Strategic bets — [docs/plans/phase-4-strategic-bets.md](docs/plans/phase-4-strategic-bets.md)
- Data model: non-SQL adapters (MongoDB aggregation, CSV / JSON files via SQLite materialisation) and Ossie / Databricks Metric Views import — [docs/plans/ba-2-data-model-dsl-alternatives.md](docs/plans/ba-2-data-model-dsl-alternatives.md) section 5, story 4. Needs connector stories under BA-5 first.
- Agent Routines ([BA-82](https://halo-powered.atlassian.net/browse/BA-82)): an epic in Jira with no description, dates or fix version. Promote it into a release once it's defined.
