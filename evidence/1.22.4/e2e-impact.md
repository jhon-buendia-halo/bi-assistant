# 1.22.4 — E2E impact (step 6)

Touched: the Data Readiness Agent's tools, prompt (D12, D14) and the tool-services bridge in `SessionsService`; a `file` panel item written by `generate_synthetic_data` through the existing `showPanelItem` path and its Download; the session workspace (`synthetic-data/*.sql`).

| Spec | Decision | Scenarios |
|---|---|---|
| `frontend/e2e/synthetic-data.spec.ts` | add | Chat › Generate a synthetic script from the Data Readiness Agent (`@demo @story-1.22.4`) |
| `frontend/e2e/data-readiness.spec.ts` | re-run | every scenario (the agent's prompt and tool list changed) |
| `frontend/e2e/agent-panel.spec.ts` | re-run | every scenario (file panel items and their download) |
