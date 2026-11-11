# 1.22.1 — E2E impact (step 6)

Touched: the dataset editor tab strip (`catalog-browser`, a third tab and the arrow-key cycle), the new `synthetic-data` panel and backend module, and an additive `sampleTable` on the PostgreSQL and Databricks profilers (readiness statements unchanged).

| Spec | Decision | Scenarios |
|---|---|---|
| `frontend/e2e/synthetic-data.spec.ts` | add | Profile a sample of World Cup (`@demo @story-1.22.1`) |
| `frontend/e2e/dataset-ontology.spec.ts` | re-run | every scenario (uses the dataset tabs) |
| `frontend/e2e/dataset-schema-notes.spec.ts` | re-run | every scenario (dataset editor) |
| `frontend/e2e/layout-accessibility.spec.ts` | re-run | tab strip, heading order and screenshot baseline |
| `frontend/e2e/navigation.spec.ts` | re-run | rail and dataset navigation |
| `frontend/e2e/world-cup-workflow.spec.ts` | re-run | the World Cup flow through the dataset editor |
| `frontend/e2e/data-readiness.spec.ts` | re-run | readiness profiling stays exact (profilers gained `sampleTable`) |
