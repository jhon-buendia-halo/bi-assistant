# 1.21.5 — Data Readiness Agent drills into findings with read-only SQL

Ships ADR-0035 (amends ADR-0031): the Data Readiness Agent gains the shared `describe_entity` and `run_readonly_sql` (same guards, session scoping, fixer and result checks as the assistant's) and a second on-demand built-in skill `readiness-drilldown` with one SQL recipe per dimension for PostgreSQL and Databricks. Its prompt allows SQL only to show the records behind findings; general analysis is declined with a pointer to Questions to Insights, and scores stay engine-only. Live runs showed the agent fanning a query across every datasource of a multi-dataset session, so Block D1 now carries each dataset's `datasourceId` and an example entity key, and the skill requires passing that id.

## Gherkin scenarios and the specs that cover them

Specs: [agents.md](../../specs/system/agents.md) 2.10, 3.13, 7.4, D12, Appendix D; [data-readiness](../../specs/capabilities/data-readiness/spec.md) R3, R4 and the drill-down scenario.

| Scenario | Playwright spec |
|---|---|
| The agent shows the records behind a finding | `frontend/e2e/data-readiness.spec.ts` (passed, [final gate run](../1.21.7/e2e-results.txt)) |
| Hub lists the agent's tools and two skills | `frontend/e2e/agent-hub.spec.ts` (passed, [final gate run](../1.21.7/e2e-results.txt)) |

Data Readiness evals (`dr-no-sql` rewritten, a drill-down case): base (main `be7c455`) 7/8, failing only on an eval bug that is fixed on the branch; branch 9/9 in each of 3 full runs, with `dr-drilldown-nulls` passing 9/9 after the prompt rule, model `custom/claude-sonnet-5-5`. See [evals/README.md](evals/README.md).

## Artifacts

- [drilldown-live-run.md](drilldown-live-run.md): live run on Formula 1, "what are the records with second_nationality_country_id null values". Tool calls (`skill`, two `run_readonly_sql`, `describe_entity`) and the answer: 910 of 917 `driver` rows, with a table of the first 20.
- [general-question-declined-live-run.md](general-question-declined-live-run.md): live run of "how many races were there in 2010?" on the same dataset: no tool calls, declined with a pointer to Questions to Insights.

Desktop: not run (web target only).
