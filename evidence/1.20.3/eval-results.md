# Evals for epic BA-318 (2026-11-09)

Model: `claude-opus-5-5` through the user's Anthropic-compatible relay (custom endpoint, 127.0.0.1:8317), same model and seeded data (World Cup sample, loaded through Testing Data into a fresh copy of the data dir per run) on `main` and on the branch. Bar: every case 3 consecutive passing runs.

| Set | `main` (base) | Branch |
|---|---|---|
| `schema-notes` (new, 1 case: `schema-notes-consumption`) | — (not on main) | 3/3 |
| `data-readiness` (8 cases) | 8/8 ×3 | 8/8 ×3 |
| `world-cup` (12 cases) | 11/12, 12/12, 12/12 | round 1: 12/12, 11/12 (stopped); round 2: 12/12, 12/12, 11/12; then `final-score-2018` alone ×3: 1/1, 1/1, 1/1 |

Failures, diagnosed from the tool calls (none caused by the epic; the world-cup datasets carry no schema notes, so their prompt is byte-identical to main):
- `final-score-2018` (base run 1 and branch round 2 run 3): the model sent a multi-statement SQL, got "Only a single statement may be executed", retried and answered 4–2 correctly; the strict `noToolErrors` check fails such a run. Re-run ×3 on the branch: 3/3.
- `no-clarification-best-team` (branch round 1 run 2): the LLM judge rejected a correct answer (France lost the 2022 final); 6 further runs passed.

`schema-notes-consumption`: "How many goals were scored in the 2022 World Cup?" over a snapshot exposing every World Cup table twice — `world_cup.world_cup_raw` (Landing, "Raw ingest copy, not cleaned"; a schema that does not exist) and `world_cup.world_cup` (Consumption, "Curated tournament facts for analysis"). Passes only if the SQL runs, no statement mentions `world_cup_raw`, and the result matches `SUM(home_goals + away_goals)` over the 2022 matches (24 in the sample). Checks unit-tested in `schema-notes-eval-checks.spec.ts`.
