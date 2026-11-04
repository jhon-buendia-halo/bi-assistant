# Real eval runs on the new build, 2026-10-13

The app built from the epic branch after Steps 1b, 1c, 1d, 2 and 3 (one `build:all`), run as the npm CLI on port 3141 with a scratch data directory, model `openai/gpt-4o-mini` (the app's default, nothing saved in Settings, `OPENAI_API_KEY` from the environment), **judge off** on every run. Two streams in parallel: Demo User ran the PostgreSQL sets, Mark Maker the REST sets. Data: World Cup in `world_cup_ba9_baseline`, finance in `ba9_finance`, marketing analytics in `ba9_marketing_analytics` on the shared PostgreSQL; the local REST API on 55081 (finance), 55082 (marketing analytics) and 55092 (World Cup, `connector` profile, cursor paging), registered with `setup-fixture-rest.ts`.

| File | Set | Source | Passed | D1 rows right | D3 SQL clean | G1 facts in answer |
|---|---|---|---|---|---|---|
| `world-cup-postgres.*` | World Cup | PostgreSQL | 0/10 | 8/11 | 5/18 | 17/18 |
| `world-cup-rest-connector-cursor.*` | World Cup (REST connector) | REST, cursor | 0/12 | 16/23 | 5/22 | 15/18 |
| `finance-postgres.*` | Finance | PostgreSQL | 6/68 | 58/117 | 31/65 | 12/43 |
| `finance-rest.*` | Finance (REST API) | REST | 2/68 | 55/117 | 0/65 | 13/43 |
| `marketing-analytics-postgres.*` | Marketing Analytics | PostgreSQL | 8/50 | 45/83 | 28/41 | 13/43 |
| `marketing-analytics-rest.*` | Marketing Analytics (REST API) | REST | 5/50 | 42/83 | 0/41 | 6/43 |

Criteria are checks passed over checks scored (agents-evals R104). No question was "not scored": every question carries deterministic checks since Step 1b.

What the runs show:
- Against the baseline on `main` (`../1.1.2/baseline/`), the World Cup row match went from 0/15 to 8/11 checks: the R31 fix for a result truncated at the model's own row limit.
- D3 is what fails most questions. The dominant tool error is `gpt-4o-mini` passing the datasource as `"<kind> <id>"` (155 calls in finance over REST, 158 in marketing analytics over REST, 136 in finance on PostgreSQL), plus SQL repaired by the fixer.
- Business-term questions fail as expected: the new domains have no knowledge seed yet.
- The governance question `rest-gov-unmask-competitor` passes: the assistant refused to unmask a competitor.

`run-starts.log` holds the start responses; each `.md` is the report downloaded from `GET /agents/assistant/evals/runs/:jobId/download` (with `Judge: off` and the by-category and by-criterion tables), each `.json` the run record.
