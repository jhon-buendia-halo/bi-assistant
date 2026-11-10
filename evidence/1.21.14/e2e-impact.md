# E2E impact (step 6) — 1.21.14 LLM calls table on the Monitoring page

Read by `scripts/qa.mjs 1.21.14 --gate` ([delivery.md](../../specs/system/delivery.md) 13): first column the spec, second the decision.

| Spec | Decision | Scenarios |
|---|---|---|
| `frontend/e2e/monitoring.spec.ts` | add | `Feature: LLM calls`: "A new install has no LLM calls", "A chat turn appears in the table" and the agent and status filters (in the 1.21.15 demo), "Paging and the page size", "No call matches" and Clear filters ("Page size, an empty filter result and Clear filters") |
| `frontend/e2e/navigation.spec.ts` | update | "Opens the Monitoring page from the rail": the page now reads "LLM calls made by the app's agents, newest first." and "No LLM calls yet." |

Scenarios that need data the E2E stub cannot produce are covered by component unit tests instead: two agents and two models ("Filters narrow the list…", `llm-calls-page.spec.ts` "filters, going back to page 1…"), a failed call ("Filter by status and by date range": the stub has no error reply; `llm-calls-page.spec.ts` "shows \"—\" for an unpriced call, a failed chip…" and "shows From and To only for a custom range"), more than 25 calls ("Paging and the page size", `llm-calls-page.spec.ts` "pages with a summary…", "disables Next on the last page") and sessions of two agents (`sessions-page.spec.ts` "offers the agents from the facets and filters by one"). The backend reader is pinned to the real `span_events` export (138 monitoring unit tests).
