# Golden-set eval harness

Regression harness for answer reliability: it asks the assistant a fixed set of
questions and checks that the SQL it actually ran returns the same result set as
trusted reference SQL. It is the guard rail for the SQL pipeline — run it before
and after any change to the agent instructions, tools, schema context or the
SQL repair loop.

- Cases live in `golden-set.json`.
- The runner is `../scripts/run-eval.ts`, wired as `npm run eval` (ts-node in
  transpile-only mode, so a run starts fast). `backend/tsconfig.build.json`
  excludes `scripts/` — the runner must stay out of the `nest build` program or
  the emitted `dist/` layout shifts to `dist/src/main.js`. Type-check it with
  `npx tsc --noEmit -p tsconfig.json` (the root config does include it).

## What it does

1. Boots the backend as a Nest standalone application context
   (`NestFactory.createApplicationContext(AppModule)`) — no HTTP server.
2. Fails fast if no LLM is configured, or if a case's dataset / datasource is
   missing or unreachable (it runs `SELECT 1` as a smoke test).
3. For each case: creates a **throwaway session** bound to the case's dataset,
   sends the question through `SessionsService.streamMessage` with a no-op
   emitter, and reads the persisted assistant message — its final text plus the
   last successful `run_readonly_sql` record.
4. Runs the case's `expectedSql` through `DatasourcesService.runReadOnlySql` on
   the same datasource, replays the assistant's SQL under the same row limit,
   and compares the two result sets.
5. Deletes the throwaway session (unless `--keep-sessions`), prints a summary
   table, and exits `1` if anything failed or errored — so it can gate CI later.

### How result sets are compared

Unordered **multiset** comparison, so row order never matters:

- Numbers are rounded to 6 significant figures; numeric strings (Databricks
  returns some numerics as text) are treated as numbers.
- Strings are trimmed, internal whitespace collapsed, compared case-insensitively.
- `null`/`undefined` collapse to one token; `Date`s compare as ISO strings.
- Column **names and order are ignored**: each row is keyed by its sorted set of
  values. An answer that labels the column `total_paid` instead of `spend` still
  passes.
- Column **count is tolerated** here: the reference SQL projects exactly what the
  question asked, while the assistant also selects the figures its answer and
  visuals lean on. A run whose facts match but whose projection is wider passes
  as `PASS(extra-columns)`. A result whose figures actually differ is reported as
  a figure difference, never as a column-count complaint — that distinction is
  the whole point, since a real disagreement once hid behind a shape mismatch.

Practical consequence: write `expectedSql` so it returns exactly the facts the
question asks for — no extra bookkeeping columns, no `ORDER BY` dependence.

### Verdicts

| Verdict                 | Meaning                                                                  |
| ----------------------- | ------------------------------------------------------------------------ |
| `PASS`                  | Result sets match.                                                       |
| `PASS(extra-columns)`   | The facts match; the assistant projected more columns than the reference. |
| `FAIL(result-mismatch)` | The assistant ran SQL, but the rows differ from the reference.           |
| `FAIL(no-sql)`          | The answer ran no successful `run_readonly_sql` (often a clarification). |
| `ERROR(expected-sql)`   | The case's own `expectedSql` failed to run — fix the case.               |
| `ERROR(turn-failed)`    | The chat turn threw (provider error, tool crash, …).                     |
| `ERROR(timeout)`        | The turn exceeded `EVAL_TIMEOUT_MS`.                                     |
| `ERROR(replay-failed)`  | The assistant's SQL could not be re-run and no stored rows existed.      |
| `SKIP(placeholder)`     | Case still marked `"placeholder": true`.                                 |

## The World Cup set

The shipped cases run against the World Cup Postgres fixture in this repo, so
the whole set is reproducible without touching customer data.

```bash
docker compose up -d            # from the repo root; postgres on localhost:55432
```

Then, in the app: add a PostgreSQL datasource (host `localhost`, port `55432`,
database `world_cup`, user `world_cup`, password `world_cup_dev`), build a
dataset over the `world_cup` schema and save it as **`World Cup`** — the name
every case's `dataset` field expects.

Each case exists to catch a specific way an answer goes wrong:

| Case                        | Guards against                                                          |
| --------------------------- | ----------------------------------------------------------------------- |
| `pass-accuracy-by-team`     | A ratio built from one measure divided by itself — rates of 1 everywhere. |
| `shot-accuracy-by-team`     | The same fault on a different column pair, so a narrow fix still fails.  |
| `top-scoring-team`          | Ranking when the winner is unambiguous (France, 14).                    |
| `teams-tied-on-four-goals`  | Ties — Belgium and England both scored 4, four more teams tie on 2.     |
| `card-types-recorded`       | A metric that cannot vary: every card in the data is a yellow.          |
| `goals-with-recorded-assist`| A group key blank on 45 of 47 rows.                                     |
| `goals-by-type`             | Control: categorical breakdown, no ratio, no nulls.                     |
| `attendance-by-tournament`  | Control: plain aggregate over a join.                                   |
| `matches-by-stage`          | Ties at the bottom of a distribution.                                   |

The same pathologies are asserted without an LLM — and therefore without cost or
flakiness — in `backend/test/answer-guards.e2e-spec.ts` (`npm run test:e2e`).
Run those first: if the guards themselves regress, the golden set will only tell
you something is wrong, not what.

## Prerequisites

The harness reads the same SQLite datastore as the desktop app, so it needs a
datastore that already contains an LLM configuration, a datasource and the
dataset each case names.

- **Datastore location**: `APP_DATA_DIR` (defaults to `backend/data`). The
  Electron app stores everything under its `userData` folder, so to evaluate
  against what you configured in the app, point the run at it — on macOS that is
  `~/Library/Application Support/<app name>` (the packaged app uses the
  `productName` from `frontend/package.json`; check the folder that contains
  `app.sqlite`).
- **LLM**: settings saved in the app (Settings → LLM). Without saved settings the
  harness accepts an `OPENAI_API_KEY` env var and the `gpt-4o-mini` fallback;
  with neither, it stops with a clear message.
- **Datasource / dataset**: each case's `dataset` must exist in that datastore
  and resolve to a reachable datasource.

Every case spends real tokens and runs real warehouse queries — keep the set small.

## Running

```bash
cd backend
npm run eval                                   # whole golden set
APP_DATA_DIR="$HOME/Library/Application Support/Questions to Insights" npm run eval
npm run eval -- --only denial-rate             # one case (substring match)
npm run eval -- --file ../my-cases.json        # alternative case file
npm run eval -- --verbose                      # Nest logs + the SQL that ran
npm run eval -- --keep-sessions                # leave the throwaway sessions behind
npm run eval -- --include-placeholders         # run the shipped placeholders (they will fail)
npm run eval -- --help
```

Env: `EVAL_ROW_LIMIT` (default 500 — the connector cap), `EVAL_TIMEOUT_MS`
(default 300000, per case).

## Adding a case

`golden-set.json` is a flat array. One case:

```json
{
  "name": "denial-rate-by-plan",
  "dataset": "health-claims",
  "question": "What is the claim denial rate for each plan?",
  "expectedSql": "SELECT m.plan_name, COUNT_IF(c.claim_status = 'DENIED') / COUNT(*) AS denial_rate FROM main.health_claims.claims c JOIN main.health_claims.members m ON c.member_id = m.member_id GROUP BY m.plan_name"
}
```

| Field         | Notes                                                                                                                                  |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `name`        | Unique, hyphenated; shown in the summary and matched by `--only`.                                                                      |
| `dataset`     | Name of a saved dataset — the throwaway session is bound to it.                                                                        |
| `question`    | Exactly what a user would type. Keep it unambiguous, or the assistant will ask a clarifying question and the case fails with `no-sql`. |
| `expectedSql` | Read-only `SELECT`/`WITH`, single statement, hand-verified against the data.                                                           |
| `placeholder` | Optional. `true` → skipped by default (used by the shipped examples).                                                                  |
| `notes`       | Optional, free text for humans.                                                                                                        |

Guidelines:

- **Verify `expectedSql` by hand first.** The harness trusts it completely; a
  wrong reference query produces noisy false failures.
- Prefer small aggregate result sets (a handful of rows). Large scans are slow,
  expensive, and truncated at the 500-row cap on both sides.
- Cover the error classes that actually break NL2SQL: value matching (filters on
  status/category strings), joins, date ranges, and metric definitions.
- Avoid `CURRENT_DATE`-relative questions unless the reference SQL is relative in
  exactly the same way — otherwise the case rots.

The five entries shipped here are **placeholders** for the health-claims demo
dataset (`"placeholder": true`, `REPLACE_WITH_DATASET_NAME`). Replace the
dataset name and SQL with your dataset's, drop the `placeholder` flag, and the
case goes live.
