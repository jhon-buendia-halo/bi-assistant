# Evidence — 1.2.2 Logical query layer (BA-86)

No LLM key is available in this environment, so the real `model` vs `legacy`
eval comparison could not be run here. The plumbing that picks the path,
picks the agent, counts `outsideModel` answers and fills in the report
fields is unit-tested with a stubbed `runEvals` instead (see
`backend/src/mastra/evals/assistant-evals-path.spec.ts`, part of the
917/917 unit run below).

## Code review follow-up (same day)

A second-pass review of the implementation found 12 problems, one a BLOCKER:
`compile-sql.ts` quoted an entity's whole `database.schema.table` binding key
as one identifier for every dialect (`FROM "main.public.matches"`), which
Postgres/Databricks reject outright — a real call only ever "worked" because
`sql-fixer`'s repair loop silently rewrote it. Fixed (`quoteTableRef`):
postgres drops the leading database segment and quotes `"schema"."table"`;
databricks quotes all three segments (`` `catalog`.`schema`.`table` ``);
sqlite (the `rest` adapter's materialisation target) keeps the whole dotted
key as one identifier, unchanged. `live-query-sample.json` proves this against
a real Postgres instance — see below. The golden-SQL unit tests had encoded
the bug as the expected output (hand-copied from the implementation's own
first run, not independently derived), so they could not have caught it; a
live sample would have. The other 11 findings (bucket/fan-out/ratio
correctness, no physical name reaching the model, path-aware evals, and
assorted cleanups) are detailed in `retrospective.md`'s 2026-10-02 BA-86
entry.

## Run the real comparison once a key is configured

From `backend/`, against a saved dataset (e.g. the World Cup sample):

```bash
# Current path (ADR-0007): the logical-query-layer assistant.
EVAL_DATASETS="World Cup Core" npm run evals:assistant

# Legacy path: the pre-change, SQL-writing assistant, for comparison.
EVAL_DATASETS="World Cup Core" EVAL_PATH=legacy npm run evals:assistant
```

Each run prints a PASS/FAIL line per question, then:

```
<passed>/<total> questions passed
<outsideModel>/<total> answers outside the data model
```

`path` is an API/CLI-only knob — `POST /agents/assistant/evals/run` accepts
`{ "path": "legacy" }`, and `agents-api.service.ts`'s `startEvalRun` forwards
an optional `path` param, but the Evals tab's own "Run" button
(`agent-detail.ts`) never passes one, and its template has no model/legacy
selector. Every run started from the app itself is therefore always the
`model` path; reaching `legacy` means calling the API or
`npm run evals:assistant` directly, as above. Each run's markdown report (the
per-run "Download" button, or `EvalRunsService`/`eval-report.ts` directly)
still states its `Path` and `Outside the data model` count in the header,
which is how a `legacy` run started via the API shows up the same way a
`model` run does.

Expectation from the decision record (`docs/plans/ba-2-data-model-dsl-alternatives.md`
§4b): the `model` path should approach the 98–100% accuracy compiler-based
systems report on modelled questions, and the `outsideModel` count should be
low and should trend toward zero as the model is extended — that is the
number to watch run over run, not a one-time pass/fail.

## What is in this folder

- `e2e-results.txt` — `npm run test:e2e -- data-models` (backend,
  `test/data-models.e2e-spec.ts`), 13/13 green, re-run after the review
  fixes; plus a fresh `E2E_SKIP_DOCKER=1 npm run test:e2e` Playwright/Electron
  run (frontend), 20/20 green — Postgres was already up on port 55432 for
  this run, so the World Cup workflow spec ran for real. Covers both new
  backend scenarios from the brief ("Compiling a logical query returns
  dialect SQL without touching the database" and "A logical query naming an
  unknown attribute or an undeclared relationship is rejected before any
  database call"), the 10 scenarios from 1.2.1 (BA-85) unaffected by this
  change, and the full Playwright suite.
- `unit-results.txt` — `npm test` (backend), 917/917 green (up from 872 at
  the first pass — the review round added `query/sql-repair.spec.ts`,
  `mastra/tools/model.tools.spec.ts`, `data-models.controller.spec.ts`, and
  extra cases in `logical-query.spec.ts`/`compile-sql.spec.ts`/
  `session-model.spec.ts`/`data-model.schema.spec.ts`/
  `verified-queries.service.spec.ts`/`result-set-check.spec.ts`), including
  the original suites: `session-model.spec.ts`, `query/logical-query.spec.ts`,
  `query/compile-sql.spec.ts` (golden SQL per dialect), `assistant.agent.spec.ts`
  (the §5 vocabulary guard: neither the instructions nor the rendered World
  Cup model block ever contain a `catalog.schema.table` key or a dialect
  word), and `assistant-evals-path.spec.ts` (dual-path eval plumbing).
- `sample-model-block-and-golden-sql.txt` — the rendered model block
  `renderModelBlock` produces for the World Cup fixture (`dsl/__fixtures__/
  world-cup.fixture.ts`), and the golden SQL `compileLogicalQuery` emits for
  nine representative logical queries (plain select, a model metric, an
  ad-hoc aggregation with a `where`, an explicit join, an auto-path join, a
  year/quarter/week bucket, and a month bucket mixed with a metric to show
  `GROUP BY` reusing the bucket expression), compiled for all three dialects
  (postgres, databricks, sqlite). Generated by requiring the actual built
  `dist/` modules (`session-model.js`/`query/compile-sql.js`) from a throwaway
  `node -e` script — not hand-written, and not run from source so there is no
  chance of it drifting from what ships.
- `live-query-sample.json` — the BLOCKER's live proof: `POST
  /datasets/:name/model/query` against a real World Cup Postgres datasource,
  driven through `node dist/cli.js --port 3100 --data-dir <tmp> --no-open`. A
  metric (`avg_attendance`) + an explicit join (`matches.home_team_id->teams.id`)
  + a month bucket (`kicked_off_at`), with `group_by` auto-filled. The
  compiled SQL (`FROM "world_cup"."matches" AS "matches" JOIN
  "world_cup"."teams" AS "home_team" ...`) ran against the real database and
  returned real rows — proof the quoting fix is not just internally
  consistent but actually accepted by Postgres. The CLI process and its
  throwaway data dir were both torn down afterward; no state was left behind
  beyond the `world-cup-pg` datasource/`world-cup-ba86` dataset inside that
  now-deleted data dir.

`frontend/e2e/agents.spec.ts` and `gherkin.md` were updated by hand to match
the new tool/agent names (`query_entities` replaces `run_readonly_sql` in the
Tools tab; `query-verifier` replaces `sql-verifier` in the agent list) — see
`docs/plans/ba-86-logical-query-layer.md`'s "Workflow step 6" section for the
full impact list.
