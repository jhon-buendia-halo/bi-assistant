---
type: added
story: BA-2
epic: BA-2
roadmap: 1.2.1
title: Data model DSL, bootstrap and versions
evidence: evidence/1.2.1/
---
- Every dataset owns a storage-neutral data model: entities with typed attributes (roles, nested paths, sample values), relationships with explicit cardinality and provenance, metrics in a portable aggregation core with an `expressions.sql` escape hatch, and `bindings` per datasource kind (`sql`, `rest`; `mongo` and `file` accepted by the schema, no adapter). ADR-0013.
- New `backend/src/modules/data-models/`: a Zod schema with an exported JSON Schema (`GET /data-models/schema.json`), YAML parse and serialize with line-and-column errors, semantic validation (unique names, resolvable targets, binding columns that exist in the snapshot), and the `data_models` collection with immutable versions and a current pointer (`GET/PUT /datasets/:name/model`, versions, revert, bootstrap, drift, resolve).
- Version 1 is bootstrapped from the physical snapshot on dataset save and, at startup, for every dataset without a model (migration M14; per-dataset errors are logged and skipped). A re-save merges newly included tables into a new version and records a drift report; user edits are never overwritten.
- Logical references (`entity`, `entity.attribute`, `metric:name`, `rel:from->to`) resolved by `resolveRef`, for the Knowledge Store (1.3.2). Research and decision record: [docs/plans/ba-2-data-model-dsl-alternatives.md](docs/plans/ba-2-data-model-dsl-alternatives.md).
- Built on the old `ba-2-epic-kickoff` branch (2026-10-01) and shipped through the port in roadmap 1.2.4; the old stories BA-85, BA-86 and BA-87 were deleted and their work is described in the epic.
