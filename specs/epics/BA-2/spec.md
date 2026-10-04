# BA-2 — Data Model DSL

- **Jira:** [BA-2](https://halo-powered.atlassian.net/browse/BA-2) · **Roadmap:** Milestone 1.2 · **Status:** Draft — confirmation waived by the user on 2026-10-04 (one-time exception); work on its stories may start

## Goal
Every dataset has one versioned, storage-neutral description of the data the assistant reasons over: entities, attributes, relationships and business metrics. It is the single source of truth that grounds SQL generation, so answers stop depending on what the model infers from raw schema alone.

## Scope
- A DSL (typed schema, YAML form with line/column errors, semantic validation) with per-datasource bindings (`sql`, `rest` in the beta).
- Automatic bootstrap of a model per dataset, versions, revert, drift reporting; user edits never overwritten.
- A logical query layer: the assistant queries abstract entities, compiled to Postgres, Databricks SQL or SQLite (REST); raw SQL stays as a flagged fallback.
- Editing UI: YAML editor, forms, version diff/revert, import/export; the metrics panel reads and writes the model.

## Out of scope
- Business meaning (synonyms, concepts): that belongs to the Knowledge Store ([BA-4](../BA-4/spec.md)).
- MongoDB, CSV and JSON adapters; Ossie / Databricks Metric Views import (Jira: backlog).

## Stories
Jira lists **no child issues**. The original stories BA-85, BA-86 and BA-87 were deleted on 2026-10-02 (one branch per epic); their work is described in the epic description.

| Story | Summary | Roadmap feature |
|---|---|---|
| — | Data model DSL: schema, bindings, bootstrap, metrics mirror | 1.2.1 (on `main`'s roadmap: a single *Data Model DSL* feature, Planned) |
| — | Logical query layer (ADR-0007) | 1.2.2 (branch roadmap only) |
| — | Model editing, versioning and export | 1.2.3 (branch roadmap only) |

## Specs touched
- System: [data-model](../../system/data-model.md) (data-models collection, versions, drift), [api](../../system/api.md) (`/datasets/:name/model*`, `/data-models/schema.json`), [agents](../../system/agents.md) (assistant tools `describe_entity` / `query_entities` / `sample_records`, `query-fixer`, `query-verifier`), [ui](../../system/ui.md) (data model view).
- Capabilities: [datasets](../../capabilities/datasets/spec.md) (model per dataset, bootstrap on save), [metrics](../../capabilities/metrics/spec.md) (model becomes the editor of record), [sessions-chat](../../capabilities/sessions-chat/spec.md) (logical querying, raw-SQL flag), [datasources](../../capabilities/datasources/spec.md) (bindings per kind).

## Acceptance
From the epic description (Jira has no separate acceptance list):
- Every existing dataset gets a model on upgrade with no user action; a new dataset gets one on save.
- An invalid edit is rejected with line/column and the current version untouched; revert changes what the assistant sees next turn.
- No table names or SQL dialects appear in the assistant prompt or tool calls; logical queries compile on all beta datasources.
- Exported models re-import identically. Final criteria: To be agreed.

## Dependencies, risks and open questions
- **Open:** the work is described as done on branch `ba-2-epic-kickoff` (not merged into `main` at the time of writing; `main` has no `data-models` module or `features/data-model`). Should this spec describe the shipped branch state once merged? Confirm merge order.
- The two real eval comparison runs (model vs legacy path) still need an LLM key (`evidence/1.2.2/README.md` on the branch); depends on [BA-9](../BA-9/spec.md).
- Overlaps the "semantic metrics layer" in [phase-4-strategic-bets](../../../docs/plans/phase-4-strategic-bets.md) and the alternatives record `docs/plans/ba-2-data-model-dsl-alternatives.md` (branch only).
- Feeds [BA-4](../BA-4/spec.md) via logical references and `resolveRef`. ADR-0006 and ADR-0007.
- Jira has no child stories, so traceability to the roadmap features is by convention only.
