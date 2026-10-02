# Changelog

Running log of every meaningful change, newest first. See *Logging convention* and *Evidence convention* in [CLAUDE.md](CLAUDE.md). Release versions come from Conventional Commits (`version-on-merge.yml`); this file records what shipped and links to the evidence.

## 2026-10-01 (BA-85)

### Added
- **Data model DSL, bootstrap and versions** (roadmap 1.2.1 / [BA-85](https://halo-powered.atlassian.net/browse/BA-85), ADR-0006): every dataset now owns a storage-neutral data model — entities with typed attributes (roles, nested paths, sample values), relationships with explicit cardinality and provenance, metrics in a portable aggregation core with an `expressions.sql` escape hatch, and `bindings` per datasource kind (`sql`, `rest`; `mongo`/`file` accepted by the schema, no adapter yet). New `backend/src/modules/data-models/`: Zod schema with exported JSON Schema (`GET /data-models/schema.json`), YAML parse/serialize with line-and-column errors, semantic validation (unique names, resolvable targets, binding columns that exist in the snapshot), `data_models` collection with immutable versions and a current pointer (`GET/PUT /datasets/:name/model`, `…/versions/:v`, `…/revert`, `…/bootstrap`, `…/drift`, `…/resolve`), and logical references (`entity`, `entity.attribute`, `metric:name`, `rel:from->to`) resolved by `resolveRef` for the Knowledge Store (1.3.2).
- v1 is bootstrapped automatically from the physical snapshot on dataset save and, at startup, for every existing dataset without a model (per-dataset errors are logged and skipped). A re-save merges newly included tables into a new version and records a drift report for removed or changed attributes; user edits are never overwritten.
- Research and decision record for the whole epic in [docs/plans/ba-2-data-model-dsl-alternatives.md](docs/plans/ba-2-data-model-dsl-alternatives.md): three alternatives compared, the logical query layer (ADR-0007, story 1.2.2) and the Knowledge Store contract (1.3). Stories BA-85/86/87 created in Jira.

### Changed
- `MetricsService` mirrors every panel write into each current model that binds the metric's table (`syncMetric` / `removeMetric`); the shared `metrics` store stays the panel's editor of record until 1.2.3, so the panel behaves exactly as before. `DatasetsService.delete` cascades to the model.
- Backend e2e harness: `backend/test/data-models.e2e-spec.ts` boots a focused module set instead of `AppModule` (Mastra's ESM-only dependencies cannot load under Jest's CommonJS runtime) and uses `import request from 'supertest'`.

Evidence: [evidence/1.2.1/](evidence/1.2.1/) — backend e2e 10/10 + unit 835/835, Playwright Electron 20/20 (`frontend-e2e-results.txt`), frontend build, a live bootstrapped World Cup model (`world-cup-core-model-v1.yaml`), API responses for bootstrap / invalid PUT / valid PUT / resolve / drift (`api-responses.json`), and the published JSON Schema. Known pre-existing failure outside this change: frontend unit test *App › keyboard resizing from the separator* (frontend tree identical to main).

## 2026-10-01

### Added
- Adopted the eleven-step delivery workflow in [CLAUDE.md](CLAUDE.md) (retrospective-first, roadmap → ADR → Gherkin → E2E impact analysis → tests-first → implement → green → changelog + evidence → retrospective) and seeded [roadmap.md](roadmap.md), [architecture.md](architecture.md), [gherkin.md](gherkin.md), [retrospective.md](retrospective.md), [evidence/](evidence/).
- Filled in the harness resources that were still missing: C4 Mermaid diagrams for all four levels in [architecture.md](architecture.md) (system context, containers, backend + frontend components, visual tailoring loop); Given/When/Then steps for all 20 scenarios in [gherkin.md](gherkin.md).
- Corrected [CLAUDE.md](CLAUDE.md) where it had drifted from the code:
  - The frontend is not routed yet. Features have no `pages/`, routes or store, and some `core/` folders are empty placeholders.
  - Lists every registered Mastra agent, plus the DuckDB observability store and the `infrastructure/crypto` key encryption.
  - Visuals: spec-first designer with a freeform fallback, the full version-folder file list inside the session workspace, and the tailor/refresh/repair endpoints.
  - The chat stream is `POST …/messages/stream` read with `fetch`.
  - Flags the hardcoded renderer port as a known gap.
- Added the **Branching convention** to [CLAUDE.md](CLAUDE.md): every PR is built in its own `<type>/<US-ID>-<short-description>` feature branch and git worktree, tied to an existing Jira user story.
- Roadmap: imported the **1.0 Beta** plan from Jira BA (target 2026-10-31) as Release 1. There are 7 milestones (one per epic: Evals, Data Model DSL, Knowledge Store, Reliability Signals, Data Connectors, User Testing, Bug Fixes) and 13 features, linked to the BA issues. Agent Routines (BA-82) is in the Backlog.
- Roadmap: added Release 0 / Milestone 0.1 with 0.1.1, the renderer ignoring `BACKEND_PORT` (`📋 Planned`).
- Evidence: process/docs-only change, no code or UI change. Diagrams rendered cleanly with `@mermaid-js/mermaid-cli` v12.
