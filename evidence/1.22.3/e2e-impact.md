# 1.22.3 — E2E impact (step 6)

Touched: the Databricks writer and its statement smoke check only (backend, pure). No UI change: the Generate button already exists, and no Databricks warehouse runs in E2E. Covered by unit specs; the synthetic-data spec is re-run to show nothing regressed.

| Spec | Decision | Scenarios |
|---|---|---|
| `frontend/e2e/synthetic-data.spec.ts` | re-run | every scenario |
