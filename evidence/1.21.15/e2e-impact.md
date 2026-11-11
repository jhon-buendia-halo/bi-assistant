# E2E impact (step 6) — 1.21.15 LLM call detail with its context window

Read by `scripts/qa.mjs 1.21.15 --gate` ([delivery.md](../../specs/system/delivery.md) 13): first column the spec, second the decision.

| Spec | Decision | Scenarios |
|---|---|---|
| `frontend/e2e/monitoring.spec.ts` | add | `Feature: LLM call detail`: "Opens a call and reads its context window" and "Back keeps the filters and the page" (the demo, `@demo` `@story-1.21.15`); "An empty box says so" and "The rail returns to the table" ("The call facts, an empty box, and the rail back to the table"); "A call that does not exist" (API-level, 404 "LLM call not found"; the page's message is covered by `llm-call-detail.spec.ts`) |
| `frontend/e2e/navigation.spec.ts` | re-run | "Opens the Monitoring page from the rail": the rail item that the call page keeps current |
