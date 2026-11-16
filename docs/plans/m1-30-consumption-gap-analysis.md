# M1-30 — Consumption Gap Analysis

Roadmap: Milestone 1.30. Approach C of the design session of 2026-11-16 (deterministic inferred lineage, bounded probes, a confirmation step). Prototype the user approved: `.context/prototype/gap-analysis.html` of the lead's workspace (summary, requirement matrix, lineage graph that traces a requirement, dashboards with badges, fixes by layer).

## The contract (already on the epic branch)

| File | Holds | Owner |
|---|---|---|
| `backend/src/mastra/workflows/consumption-gap-analysis.schemas.ts` | Zod schema of every step's input and output; the types | lead (frozen: ask before changing) |
| `backend/src/mastra/workflows/consumption-gap-analysis.steps.ts` | ids, names, step catalogue, edges, `ConsumptionGapRuntime`, `GapQuery`, `GapQueryResult` | lead (frozen) |
| `backend/src/mastra/workflows/consumption-gap.lineage.ts` | lineage inference (stub signatures) | 1.30.2 |
| `backend/src/mastra/workflows/consumption-gap.gaps.ts` | questions, layers, dashboard requirements, confirmation, checks of model replies, tracing, probes (stub signatures) | 1.30.2 |
| `backend/src/mastra/workflows/consumption-gap-analysis.agents.ts` | the four model calls (stub signatures) | 1.30.3 |
| `backend/src/mastra/workflows/consumption-gap.report.ts` | `GapReport`, the drawn report, the answer (stub signatures) | 1.30.4 |
| `backend/src/mastra/workflows/consumption-gap-analysis.workflow.ts` | the Mastra steps | 1.30.5 |
| `backend/src/mastra/agent-constants.ts` | `REQUIREMENTS_ANALYST_AGENT_KEY`, `LAYER_MAPPER_AGENT_KEY`, `GAP_ADVISOR_AGENT_KEY` (+ `_NAME`) | lead (done) |
| `backend/src/mastra/mastra.service.ts` | `deriveRequirements`, `reviseRequirements`, `mapRequirements`, `recommendFixes` pass-throughs | lead (done) |

Keep every exported signature of a stub as it is (other units compile against it). You may add exports.

## Flow

```
start → read-dashboards → resolve-layers → load-layer-catalogs → infer-lineage
      → derive-requirements → confirm-requirements (suspend) → map-requirements
      → trace-gaps → probe-evidence → recommend-fixes → render-report → end
```

- **Layers** come from the datasets' schema notes (`DatasetSnapshot.schemas`, `{ key: 'catalog.schema', layer }`, datasets R40-R47). An entity `c.s.t` belongs to the note `c.s`. Untagged schemas are ignored. No Consumption schema = the run fails at Resolve layers.
- **Requirements**: questions → `Q1`… (model); dashboard widgets → `W1`…, filters → `F1`… (code, from the blueprint). A widget of kind `text` with no measure and no dimension is not a requirement.
- **Statuses**, best first: `supported` (every field is a Consumption column), `derivable` (computable from Consumption columns: a source with an `expression`), `grain` (in Consumption but the sources sit in entities that share no column, or a probe found the data does not answer: no rows, a column under half filled, a named period with no rows), `normalized-only`, `landing-only`, `missing`. A requirement takes its worst field's status; `grain` is checked only when every field is in Consumption.
- **Lineage** upgrades a field: when the mapper names only a Normalized/Landing source but an edge path leads from it to a Consumption column, that Consumption column is the field's source.
- **Probes** and **lineage checks** are read-only statements recorded as `run_readonly_sql` sources of the answer (query inspector, agent-answers R67-R78), through `ConsumptionGapRuntime.runQueries`. A failed query is a result with `error`, never a failed run.
- **Confirm requirements** suspends with `{ question, options: [CONFIRM_REQUIREMENTS_OPTION] }`; the existing run-panel clarification UI answers it (free text or the option). An answer that is not a confirmation is feedback: the Requirements Analyst revises the list once, and the run goes on (no second wait).
- **Fixes** start in the lowest layer that has the data (`consumption` when the data is in Consumption or Normalized and only Consumption changes… see `startsIn`): `consumption` (change only Consumption, data is in Normalized or a Consumption filter/backfill), `normalized` (data only in Landing), `source` (no layer has it). The proposed change is text/SQL, never run.

## The World Cup Medallion sample (1.30.1) — every unit's test shapes use it

Three schemas on the World Cup Postgres (database `world_cup`), catalog segment = the database name, so entities read `world_cup.wc_consumption.fct_match_results`.

`wc_landing` (Landing; raw text as delivered):
- `raw_matches(match_id text, tournament text, home_team_name text, away_team_name text, score_str text '2-1', match_date_str text 'YYYY-MM-DD', stage_txt text, stadium text, attendance_str text '78,011' or 'N/D')`
- `raw_goals(match_id text, player_name text, team text, minute_str text, penalty_flag text 'Y'/'N')`
- `raw_match_stats(match_id text, team text, possession_pct_str text '56%', shots integer, xg text — NULL for 2018)`
- `raw_teams(team text, confed text)`

`wc_normalized` (Normalized; typed and keyed):
- `matches(match_id int, tournament_year int, stage text, home_team_id int, away_team_id int, home_score int, away_score int, match_date date)` — no attendance, no venue
- `teams(team_id int, team_name text, confederation text)`
- `goals(goal_id int, match_id int, player_name text, team_id int, minute int, is_penalty boolean)`
- `match_team_statistics(match_id int, team_id int, possession numeric, shots int)` — no xg

`wc_consumption` (Consumption; reporting):
- `fct_match_results(match_id int, tournament_year int, stage text, home_team text, away_team text, home_score int, away_score int, total_goals int, winner text)`
- `agg_team_tournament(tournament_year int, team text, matches_played int, wins int, draws int, losses int, goals_for int, goals_against int)` — **2022 rows only** (the coverage gap)
- `agg_player_goals(tournament_year int, player text, team text, goals int)` — no stage

Example questions (also the eval/demo input):
1. ¿Qué equipo ganó más partidos en cada Mundial (2018 y 2022)? → `grain` (2018 missing in Consumption)
2. ¿Cuál es la diferencia de gol de cada equipo por Mundial? → `derivable`
3. ¿Qué porcentaje de los goles fueron de penal? → `normalized-only`
4. ¿Los equipos con más posesión ganan más partidos? → `normalized-only`
5. ¿Cuál es la asistencia promedio por estadio? → `landing-only`
6. ¿Qué jugadores recibieron más tarjetas amarillas? → `missing`

## Units and owners

1.30.1 fixture · 1.30.2 lineage and gaps · 1.30.3 agents · 1.30.4 report · 1.30.5 workflow and wiring. Specs: 1.30.1 the testing-data spec; 1.30.3 agents.md 1.1 and 2.18-2.20; 1.30.5 agents.md 5.12 and 5.20, workflows spec (R1/R21/R31 lists, new R37), architecture ADR-0051. 1.30.2 and 1.30.4 send their rules to 5.20 through their report (the lead merges the text).

Out of scope for M1-30: a `gap-analysis` artifact kind, several saved dashboards in one run, declared lineage hints, eval sets for the three new agents (follow-up).
