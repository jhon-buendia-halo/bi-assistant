---
type: added
story: BA-2
epic: BA-2
roadmap: 1.2.2
title: Logical query layer — the assistant reasons over abstract entities, never a physical table or dialect
evidence: evidence/1.2.2/
---
- `session-model.ts` composes a session's current dataset models and renders the one model block (entities, attributes, relationships, sample values, metric formulas) that replaces the orientation, join-hint and curated-metrics blocks. ADR-0014.
- `query/logical-query.ts` (the `LogicalQuery` schema and its resolution along declared relationships, rejecting an ambiguous or absent path) and `query/compile-sql.ts` (one compiler for Postgres, Databricks SQL and SQLite: quoting, metrics including `ratio`, date buckets, a fan-out guard).
- The assistant's tools are `list_entities`, `describe_entity`, `query_entities`, `sample_records` and the flagged fallback `run_raw_sql` (its answers are marked outside the model); its instructions name no catalog, schema, table or dialect. New agents `query-fixer` and `query-verifier` replace `sql-verifier` (removed); `sql-fixer` keeps repairing compiled SQL at runtime.
- `assistant-legacy` (hidden from the agent list) keeps the pre-change assistant for the eval `legacy` path; eval runs record their `path` and the outside-the-model count, and only runs of the same path are compared. `POST /datasets/:name/model/compile` and `…/query` compile and run a logical query.
- The two real `model` vs `legacy` eval comparison runs need an LLM key and are left for the team ([evidence/1.2.2/README.md](evidence/1.2.2/README.md)).
