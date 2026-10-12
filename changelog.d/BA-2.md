---
type: added
story: BA-2
epic: BA-2
roadmap: 1.2.4
title: Data model on main — shared like its dataset, permissions in both modes, cross-owner metrics import, main's look
evidence: evidence/1.2.4/
---
- A data model is shared like its dataset. Reads (schema, model, versions, drift, export, metrics, candidates; resolve, compile, query, serialize) need *Use agents*; writes (save, revert, bootstrap, import, metric changes) need *Manage datasources and datasets*, and the view hides its edit controls without it. With local-mode sign-in (2.1.7, ADR-0012) this holds in both modes, for the signed-in persona.
- At startup the legacy metrics of every owner are imported into the model that covers them (M14, after M13), each with its `author` and `authorName`; on a name clash the earliest wins and the rest are listed in the model's metrics-import report (`metricsImport` on drift, a header chip). The legacy `/metrics` store is import-only. A metric created in the Metrics tab records its creator, kept on edit; a metric removed through the YAML, the entity form or an import is tombstoned.
- Fixes on the model path: result guards on `query_entities`, `sample_records` and `run_raw_sql`; "Data entities" chips from the logical query; no compiled SQL reaches the model; `run_raw_sql` resolves the `default` datasource; an **Outside the data model** chip on answers that used `run_raw_sql`; eval baselines compare runs of the same path only. `assistant-legacy` is hidden from the Agent Hub.
- `features/data-model/` uses main's semantic tokens and component classes; `data-model-editing.spec.ts` runs on the web app, with org-permission scenarios and `backend/test/data-models-org.e2e-spec.ts`.
- Numbers follow what 2.1.7 took first: ADR-0013 (data model DSL) and ADR-0014 (logical query layer), migration M14, endpoints 94-112. New capability spec [specs/capabilities/data-model/spec.md](specs/capabilities/data-model/spec.md); epic spec [specs/epics/BA-2/spec.md](specs/epics/BA-2/spec.md).
- Not run: the desktop E2E (not requested) and the two real eval comparison runs (they need an LLM key).
