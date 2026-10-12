# BA-2 — Data Model DSL

- **Jira:** [BA-2](https://halo-powered.atlassian.net/browse/BA-2) · **Roadmap:** Milestone 1.2 · **Status:** Draft — confirmation waived by the user on 2026-10-04 (one-time exception); work on its stories may start

## Goal
Every dataset has one versioned, storage-neutral description of the data the assistant reasons over: entities, attributes, relationships and business metrics. It is the single source of truth that grounds SQL generation, so answers stop depending on what the model infers from raw schema alone.

## Scope
- A DSL (typed schema, YAML form with line/column errors, semantic validation) with per-datasource bindings (`sql`, `rest` in the beta).
- Automatic bootstrap of a model per dataset, versions, revert, drift reporting; user edits never overwritten.
- A logical query layer: the assistant queries abstract entities, compiled to Postgres, Databricks SQL or SQLite (REST); raw SQL stays as a flagged fallback.
- Editing UI: YAML editor, forms, version diff/revert, import/export; the metrics panel reads and writes the model.
- The port onto `main`: org server permissions, a one-time import of every owner's metrics into the shared model, main's look, and web E2E.

## Out of scope
- Business meaning (synonyms, concepts): that belongs to the Knowledge Store ([BA-4](../BA-4/spec.md)).
- MongoDB, CSV and JSON adapters; Ossie / Databricks Metric Views import (Jira: backlog).
- An eval accuracy threshold.

## Stories
Jira lists **no child issues**. The original stories BA-85, BA-86 and BA-87 were deleted on 2026-10-02 (one branch per epic); their work is described in the epic description. Commits are scoped to the epic: `feat(BA-2): …`.

| Story | Summary | Roadmap feature |
|---|---|---|
| — | Data model DSL: schema, bindings, bootstrap, metrics migration | 1.2.1 |
| — | Logical query layer (ADR-0014) | 1.2.2 |
| — | Model editing, versioning and export | 1.2.3 |
| — | Port onto `main`: org permissions, cross-owner metrics import, restyle, web E2E | 1.2.4 |

## Specs touched
- System: [architecture](../../system/architecture.md) (ADR-0013, ADR-0014), [data-model](../../system/data-model.md) (data-models collection, versions, drift, metrics-import report, migration), [api](../../system/api.md) (`/datasets/:name/model*`, `/data-models/schema.json`, per-route permissions), [agents](../../system/agents.md) (assistant tools `list_entities` / `describe_entity` / `query_entities` / `sample_records` / `run_raw_sql`, `query-fixer`, `query-verifier`, `assistant-legacy`), [ui](../../system/ui.md) (data model view), [tech-stack](../../system/tech-stack.md) (code layout).
- Capabilities: [data-model](../../capabilities/data-model/spec.md) (new: the model, its editing and its Gherkin), [datasets](../../capabilities/datasets/spec.md) (model per dataset, bootstrap on save), [metrics](../../capabilities/metrics/spec.md) (model becomes the editor of record), [sessions-chat](../../capabilities/sessions-chat/spec.md) (logical querying, raw-SQL flag), [datasources](../../capabilities/datasources/spec.md) (bindings per kind), [agents-evals](../../capabilities/agents-evals/spec.md) (Hub lists, eval path), [admin](../../capabilities/admin/spec.md) (model read and write permissions).
- Product: [glossary](../../product/glossary.md).

## Acceptance
Agreed with the user on 2026-10-11:
- Every existing dataset gets a model on upgrade with no user action; a new dataset gets one on save.
- An invalid edit is rejected with line/column and the current version untouched; revert changes what the assistant sees next turn.
- No table names or SQL dialects appear in the assistant prompt or tool calls; logical queries compile on all beta datasources.
- Exported models re-import identically.

There is no eval threshold. Eval runs are evidence, not acceptance. Per-story acceptance is in the roadmap (1.2.1–1.2.4).

## Dependencies, risks and open questions
- **Decided 2026-10-11 (the port):** the work done on branch `ba-2-epic-kickoff` is ported onto `main` (1.2.4) and this spec describes it as shipped there.
  - In org server mode a data model is shared like its dataset. Reads need *Use agents in the gallery and chat*; writes (save, revert, bootstrap, import, model metric create, edit and delete) need *Manage datasources and datasets*. Local mode is unchanged. The UI hides edit controls from callers without the write permission.
  - At startup every owner's legacy metrics are imported into the model of the dataset that covers them, with an `author`. On a name clash the first by creation time, then id, wins and the rest are listed in a metrics-import report. A later legacy `/metrics` write of a name the model already has from another author is skipped and reported. The legacy store is import-only.
  - `assistant-legacy` is hidden from agent lists and the Agent Hub; it stays reachable for the eval `legacy` path.
  - Rules: [data-model capability](../../capabilities/data-model/spec.md); decision: ADR-0013 and ADR-0014 in [architecture.md](../../system/architecture.md).
- The two real eval comparison runs (model vs legacy path) still need an LLM key ([evidence/1.2.2/README.md](../../../evidence/1.2.2/README.md)); depends on [BA-9](../BA-9/spec.md).
- Overlaps the "semantic metrics layer" in [phase-4-strategic-bets](../../../docs/plans/phase-4-strategic-bets.md) and the alternatives record [ba-2-data-model-dsl-alternatives](../../../docs/plans/ba-2-data-model-dsl-alternatives.md).
- Feeds [BA-4](../BA-4/spec.md) via logical references and `resolveRef`. ADR-0013 and ADR-0014.
- Jira has no child stories, so traceability to the roadmap features is by convention only.
- The web E2E needs Docker in WSL for the World Cup Postgres (an isolated `docker compose -p qti-ba2` stack).
