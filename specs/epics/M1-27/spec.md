# M1-27 — Explore a query's full result: page, filter, sort

- **Roadmap:** Milestone 1.27 · **Status:** Confirmed (2026-11-15, the user, Free style: approach B "Capa compartida + agente result-explorer", scope "Solo resultados de consultas de agentes", the plan's recommendations "Sí, todas", "Las tres olas seguidas".)

## Goal

A dataset query can return thousands of rows, but an answer kept at most 200 and the query inspector showed only those; the rest was a CSV download. After this epic:

- The query inspector's Result tab pages through a query's full result (up to 50,000 rows), sorts it by any column and filters it, on every host (Run panel, run detail, chat, Try it).
- The user can filter in words ("only Brazil, newest first"); an auxiliary agent, `result-explorer`, turns them into a structured view over the result's known columns. It never writes SQL.
- A chat agent pages or filters an earlier query with the `explore_result` tool, and its answer links to the inspector like any other query.
- In Answer a Business Question, a follow-up that asks for another page, a filter or an order over the earlier answer's result answers with that page instead of planning a new analysis.

## Scope

- The paged SQL builder and the connectors' paged read (1.27.1); the page engine and routes (1.27.2); the inspector's pager, sort and column filters (1.27.3).
- `result-explorer` and the interpret-filter routes (1.27.4); filter in words and explore records in the inspector (1.27.5); its eval set (1.27.6).
- The `explore_result` tool (1.27.7); the follow-up branch of Answer a Business Question (1.27.8).

## Out of scope

- Browsing a dataset's raw tables (datasets R22 stays).
- A CSV of a filtered view (the CSV stays the source query's rows).
- Changing `analysis-planner`.

## Stories

| Story | What | Status |
|---|---|---|
| 1.27.1 | Paged SQL builder and the connectors' paged read | In progress |
| 1.27.2 | Page engine and the page routes (api.md 151, 153) | In progress |
| 1.27.3 | Query inspector: pager, sort and column filters | In progress |
| 1.27.4 | The result-explorer agent and the interpret-filter routes (api.md 152, 154) | In progress |
| 1.27.5 | Query inspector: filter in words and explore records | In progress |
| 1.27.6 | result-explorer evals | In progress |
| 1.27.7 | The explore_result tool for chat agents | In progress |
| 1.27.8 | A follow-up over an earlier result pages it in Answer a Business Question | In progress |
| 1.27.9 | Sources a reader can understand: numbered, described, one per table (added 2026-11-16 at the user's request) | In progress |

## Specs touched

- [datasources](../../capabilities/datasources/spec.md) R37, R52; [agent-answers](../../capabilities/agent-answers/spec.md) R76, R79–R84; [workflows](../../capabilities/workflows/spec.md) R1, R2, R27, R35.
- [api.md](../../system/api.md) 151–154; [data-model.md](../../system/data-model.md) 3.4.2a; [non-functional.md](../../product/non-functional.md) §5; [agents.md](../../system/agents.md) 1.1, 2.1, 2.11, 2.15, 3.15, 4.2, 5.11, 5.12, 8.1; [ui.md](../../system/ui.md) 4.12.2.
- [architecture.md](../../system/architecture.md) ADR-0049.

## Acceptance

- In the inspector of a query with more than 200 rows, Next shows rows 51–100 of the full count, a column sort and a filter chip change the rows from the server, and "Filter in words" shows what it understood.
- A follow-up "next page" of an Answer a Business Question run answers with rows 51–100 of the earlier result, and its query opens in the inspector on that page.
- A first run of Answer a Business Question makes no extra model call.
- Unit tests per story; the impacted Playwright specs stay green; the assistant and insights-analyst evals show no regression against base; the result-explorer set has a recorded baseline.

## Dependencies, risks and open questions

- Plan and contract: [docs/plans/m1-27-result-explorer.md](../../../docs/plans/m1-27-result-explorer.md).
- Every page re-runs the query (REST re-fetches its endpoints); measured on a small and a large table before the wave check.
- A follow-up routed to the wrong path; covered by negative eval cases.
