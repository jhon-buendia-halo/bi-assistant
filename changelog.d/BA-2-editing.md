---
type: added
story: BA-2
epic: BA-2
roadmap: 1.2.3
title: Data model editing, versioning and export
evidence: evidence/1.2.3/
---
- The **Data model** view (`features/data-model/`, reached from a dataset row): Overview, YAML (line-numbered editor with a clickable line-and-column error list), Versions (list, two-version diff, revert) and Metrics tabs, an entity editor for entities, attributes and relationships, and Export, Import and Bootstrap from snapshot.
- Backend: `GET …/model/export` (versioned YAML download), `POST …/model/import`, `POST …/model/serialize` (the one YAML writer), `GET …/model/versions`, and model-scoped metrics (`GET/POST/PUT/DELETE …/model/metrics[/:name]`, `GET …/model/metrics/candidates`), all validated like a YAML save.
- Metrics live in the model: the Metrics tab replaces the catalog browser's metrics panel (removed with its service and model), the model wins for names it manages itself (`localMetricNames`), and an explicit delete is tombstoned (`deletedMetricNames`) against bootstrap, merges and the legacy mirror. A metric the form can't represent opens read-only.
- The governed-metrics block for the eval `legacy` path reads the current model for tables a model binds, the legacy store only for the others.
