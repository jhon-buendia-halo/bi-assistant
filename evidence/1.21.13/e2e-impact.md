# E2E impact (step 6) — 1.21.13 Monitoring item on the navigation rail

Read by `scripts/qa.mjs 1.21.13 --gate` ([delivery.md](../../specs/system/delivery.md) 13): first column the spec, second the decision.

| Spec | Decision | Scenarios |
|---|---|---|
| `frontend/e2e/navigation.spec.ts` | update | "Opens the Monitoring page from the rail" (app-shell): Monitoring is the current rail item and shows its heading and the empty LLM calls page; Sessions makes it no longer current |
| `frontend/e2e/monitoring.spec.ts` | re-run | "A new install has no LLM calls and no sessions": the page the rail item opens |
