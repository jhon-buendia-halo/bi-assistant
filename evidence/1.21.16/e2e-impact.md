# E2E impact (step 6) — 1.21.16 Session execution flow on Monitoring

Read by `scripts/qa.mjs 1.21.16 --gate` ([delivery.md](../../specs/system/delivery.md) 13): first column the spec, second the decision.

| Spec | Decision | Scenarios |
|---|---|---|
| `frontend/e2e/monitoring.spec.ts` | add | `Feature: Session flow`: "The Sessions tab lists a session with its totals", "Opens a session and reads the trajectory", "Opens a turn's timeline and switches framework spans", "Open call from a step returns to the session" (the demo, `@demo` `@story-1.21.16`); "A new install has no sessions"; "Filters narrow the sessions…", "No session matches", "A long answer is clamped", the tool row's input and output, "Hide timeline" and "Back keeps the tab and the filters" ("Filters, a clamped answer, tool details and the back controls"); "A session that does not exist" (API-level, 404 "Session not found"); "A call opened from the table still goes back to the table" (the 1.21.15 demo's back control) |
| `frontend/e2e/navigation.spec.ts` | re-run | "Opens the Monitoring page from the rail": the page now has the LLM calls and Sessions tabs |

Scenarios that need data the E2E stub cannot produce are covered by component unit tests instead: two agents and two models ("Filters narrow the list…", `llm-calls-page.spec.ts` "filters, going back to page 1…"), a failed call ("Filter by status and by date range": the stub has no error reply; `llm-calls-page.spec.ts` "shows \"—\" for an unpriced call, a failed chip…" and "shows From and To only for a custom range"), more than 25 calls ("Paging and the page size", `llm-calls-page.spec.ts` "pages with a summary…", "disables Next on the last page") and sessions of two agents (`sessions-page.spec.ts` "offers the agents from the facets and filters by one"). The backend reader is pinned to the real `span_events` export (138 monitoring unit tests).
