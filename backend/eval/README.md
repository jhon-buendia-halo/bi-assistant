# Golden-set eval harness

Regression harness for answer reliability: it asks the assistant a fixed set of
questions and checks that the SQL it actually ran returns the same result set as
trusted reference SQL. It is the guard rail for the SQL pipeline — run it before
and after any change to the agent instructions, tools, schema context or the
SQL repair loop.

- Cases live in `golden-set.json` (World Cup), in the other `*-set.json` files
  in this folder, or in a registered JSON suite under
  `../src/mastra/evals/suites/` — `--suite <id>` runs one of those.
- Every case can carry a **`category`**: the failure class it guards. Verdicts
  are tallied per category, because "which failure class is failing" is what the
  next change is steered by.
- `npm run eval:validate` checks every reference query against the live fixture
  with **zero model calls**. Run it after every edit to a case set; it is free.
- Every run (unless `--no-log`) appends a token/cost record to the repo's
  [`logs/`](../../logs/README.md) folder.
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

**Which of the assistant's queries is graded.** Not simply the last successful
`run_readonly_sql`: the assistant often runs a supporting query *after* the
one that produced the figure (a `COUNT(*)` to say "over 38 employees"), and
grading that one marks a correct answer as a mismatch. The harness first grades
the query whose result values the answer text quotes (`pickAnswerRecord` in
`src/modules/expert-mode/answer-record.ts` — the query behind the answer's
first figure wins, then the most-quoted one), and when that does not match it
tries the answer's other complete, successful queries and reports
`PASS(alternate-query)` if one of them does. The in-app suite applies the same
rule ("one complete successful result must contain all reference facts").

**Ratios.** A rate question may be answered as a fraction (`0.1154`) or a
percentage (`11.54`). Mark such a case `"resultSetOptions": { "percentEquivalent": true }`
and the harness also accepts the assistant's numbers scaled by 100 either way.
The reference must then **not** round (`100.0 * a / b`, not `ROUND(…, 2)`):
rounding to two decimals breaks the 6-significant-figure match against an
unrounded fraction.

### Verdicts

| Verdict                 | Meaning                                                                  |
| ----------------------- | ------------------------------------------------------------------------ |
| `PASS`                  | Result sets match.                                                       |
| `PASS(extra-columns)`   | The facts match; the assistant projected more columns than the reference. |
| `PASS(alternate-query)` | The facts match one of the answer's other complete queries, not the one its text quotes most (a headline total plus a breakdown, a rate plus its parts). |
| `FAIL(result-mismatch)` | The assistant ran SQL, but the rows differ from the reference.           |
| `FAIL(no-sql)`          | The answer ran no successful `run_readonly_sql` (often a clarification). |
| `ERROR(expected-sql)`   | The case's own `expectedSql` failed to run — fix the case.               |
| `ERROR(turn-failed)`    | The chat turn threw (provider error, tool crash, …).                     |
| `ERROR(timeout)`        | The turn exceeded `EVAL_TIMEOUT_MS`.                                     |
| `ERROR(replay-failed)`  | The assistant's SQL could not be re-run and no stored rows existed.      |
| `SKIP(placeholder)`     | Case still marked `"placeholder": true`.                                 |
| `SKIP(no-expected-sql)` | A suite case graded in-app by checks or a judge — this harness compares result sets, so it does not guess a reference. |

With `--repeat n` a case's verdict is `PASS` only when **every** repetition
passed, and the table gains a `RUNS` column showing `k/n`. A model is
non-deterministic, so one flip is noise — but a case that passes 4 times in 5 is
not a case that passes, and `k/n` makes a flake read as a flake.

### `--validate` statuses

`--validate` answers a different question — "can this reference judge anything?"
— so it has its own vocabulary:

| Status     | Meaning                                                                                   | Exit |
| ---------- | ----------------------------------------------------------------------------------------- | ---- |
| `OK`       | The reference ran and returned a usable number of rows.                                    | 0    |
| `EMPTY`    | 0 rows. A warning: a reference that returns nothing cannot tell a right answer from wrong. | 0    |
| `TOO-MANY` | At or above the row cap (`EVAL_ROW_LIMIT`, default 500) — both sides truncate, so the comparison is untrustworthy. Aggregate it down. | 1 |
| `ERROR`    | The query failed; the Postgres message is printed.                                          | 1    |

## The World Cup set

The separate **Agents → Evals** suite (`npm run evals:assistant`) also uses
this fixture. Its ten questions and grading rules are fixed to World Cup data;
selecting an F1 or other datasource does not adapt the questions. Save a dataset
including the `world_cup` tables and views, then select that PostgreSQL datasource
in the Evals tab. For the CLI, set `EVAL_DATASETS` to the saved dataset name(s).
Both runners reject an incompatible saved data scope before making model calls.
This preflight checks entity availability in the saved datasets; it does not
verify that the live fixture's rows are unchanged. Regression comparisons only
use previous runs with the same datasource and dataset names.

The Agents suite compares reference SQL against **each complete successful SQL
result** from the turn. A later coverage lookup, leaderboard, or list of examples
does not replace the earlier answer query. One result must contain all reference
facts; the grader does not combine partial queries, drop extra rows, accept
missing reference values, or treat truncated rows as complete evidence. The
stadium/attendance question explicitly compares distinct facts, so multiple
matches tied at the same venue and attendance do not cause a false failure.
Other questions retain duplicate-sensitive row comparison. These rules apply to
the Agents suite; the separate golden-set CLI described below is unchanged.

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
npm run eval                                    # whole golden set
APP_DATA_DIR="$HOME/Library/Application Support/Questions to Insights" npm run eval
npm run eval:validate                           # every reference SQL, zero model calls
npm run eval -- --suite health-insurance        # a registered JSON suite
npm run eval -- --only denial-rate              # one case (substring match)
npm run eval -- --category ratio-trap           # one failure class
npm run eval -- --repeat 5 --label baseline     # 5 runs per case, tagged in the log
npm run eval -- --file ../my-cases.json         # alternative case file
npm run eval -- --verbose                       # Nest logs + the SQL that ran
npm run eval -- --keep-sessions                 # leave the throwaway sessions behind
npm run eval -- --include-placeholders          # run cases marked "placeholder": true
npm run eval -- --no-log                        # do not write a run log
npm run eval -- --help
```

### Every flag

| Flag | Effect |
| --- | --- |
| `-f, --file <path>` | Case file to run. Default `eval/golden-set.json`. Mutually exclusive with `--suite`. |
| `--suite <id>` | Run a registered JSON suite from `src/mastra/evals/suites/<id>.json`. Cases come from `suite.cases`; each one binds to `suite.datasets[0]`. Mutually exclusive with `--file`. |
| `-o, --only <substring>` | Only cases whose **name** contains the substring. |
| `-c, --category <substring>` | Only cases whose **category** contains the substring. Reports which categories exist when nothing matches. |
| `--validate` | Run each case's `expectedSql` and stop. **Zero model calls**: no LLM preflight, no sessions, no agent. Exits non-zero on `ERROR` or `TOO-MANY`. Wired as `npm run eval:validate`. |
| `--repeat <n>` | Run each case `n` times (default 1). The case passes only if every run passes; the table and the log carry `k/n`. |
| `--label <text>` | Tag recorded in the run log, e.g. `baseline`, `iter-2-prompt-ratio`. It is what makes two runs comparable later. |
| `--no-log` | Do not write a record into `logs/evals/`. |
| `--include-placeholders` | Also run cases marked `"placeholder": true`. |
| `--keep-sessions` | Do not delete the throwaway sessions (for inspecting a turn in the app). |
| `--expert` | Run every turn in **business expert mode** (the answer also carries a reasoning trace with confidence). Grading is unchanged; the table gains `CONF`, `BAND`, `TABLES`, `ASSUMPTIONS`, `METRIC` columns from each case's optional `expectedReasoning`, and the summary reports the headline **AUROC of overall confidence vs PASS** plus the **high-band accuracy** constraint (target ≥ 90 %). Cases without `expectedSql` are still run once as probes (trace presence only). Not combinable with `--validate`. |
| `-v, --verbose` | Nest logs plus the SQL each case actually ran. |
| `-h, --help` | Usage. |

Env: `EVAL_ROW_LIMIT` (default 500 — the connector cap), `EVAL_TIMEOUT_MS`
(default 300000, per case), `APP_DATA_DIR` (datastore location), `EVAL_LOG_DIR`
(run-log folder; default `<repo>/logs`).

### What a run prints

1. One line per case as it finishes.
2. The per-case table (`CASE | VERDICT | [RUNS] | ROWS exp/act | TIME | DETAIL`).
3. The **per-category table** (`CATEGORY | PASSED/TOTAL | RATE`), sorted worst
   rate first — the eye should land on the failing class without scanning.
4. Token totals for the run, and the estimated cost when the model has a rate in
   `logs/pricing.json`. Token counts are measured; costs are estimated. A model
   with no configured rate prints `not priced` rather than a made-up number.
5. Where the run log was written.
6. With `--expert`: the per-case expert table and the expert summary (AUROC,
   band accuracies, coverage means, probes). See `docs/plans/business-expert-mode-engineering.md`.

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
| `category`    | Optional but expected on new sets: the failure class this case guards (vocabulary below). Drives the per-category table and `--category`. |
| `placeholder` | Optional. `true` → skipped unless `--include-placeholders`.                                                                             |
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

### The category vocabulary

One of the failure classes the eval note is organised around. `control` is the
healthy baseline: cases that must keep passing and on which the answer guards
must stay silent.

`ratio-trap`, `constant-column`, `empty-column`, `ties`, `value-vocabulary`,
`out-of-scope`, `clarification`, `id-vs-name`, `metric-definition`,
`default-filter`, `multi-step-join`, `discovery`, `unit-confusion`,
`domain-semantics`, `quality-filter`, `control`.

Use exactly these strings — the per-category table groups on them literally, and
a typo silently creates a category of one. Cases with no `category` (the
original World Cup set) are tallied as `uncategorised`.

See `docs/evals/synthetic-domains.md` for what each class means and which
planted trap exposes it.

### The suite shape

A case file may also be an object instead of a flat array — the same shape the
in-app suites use, so one file can drive both runners:

```jsonc
{
  "id": "health-insurance",
  "name": "Health insurance",
  "datasets": ["Health Insurance"],
  "requiredEntities": ["health_insurance.claims", "health_insurance.members"],
  "cases": [
    {
      "id": "denied-claims-2024",          // `id` here, `name` in a flat file
      "category": "value-vocabulary",
      "question": "How many claims were approved in 2024?",
      "intent": "counts PAID only, not PENDING or REVERSED",
      "expectedSql": "SELECT ..."
    }
  ]
}
```

Differences from the flat array:

- A case with no `dataset` of its own **inherits `datasets[0]`**.
- `expectedSql` is optional: a case graded in-app by tool checks or a judge has
  none, and this harness reports it as `SKIP(no-expected-sql)` rather than
  guessing a reference. In a flat file a missing `expectedSql` is an error —
  there it is almost always a typo.
- Extra fields (`intent`, `checks`, `judgeRubric`) are the in-app runner's;
  this harness ignores them. `resultSetOptions.distinctRows` is in-app only;
  `resultSetOptions.percentEquivalent` is honoured here (see "Ratios" above).
- `expectedReasoning` (optional; `{ tables?: ["schema.table", …], assumptions?: [phrase, …], metric?: name }`)
  describes what a correct business-expert trace should explain. It feeds the
  `--expert` coverage columns only and never changes a verdict. An assumption
  phrase is covered when every word of four or more letters appears in the
  trace's assumptions, term mappings or metric block, so write phrases with
  the words a trace would naturally use.

Registered suites (`src/mastra/evals/suites/<id>.json`) are run by id with
`--suite <id>`; a file anywhere else is run with `--file <path>`.

### Verifying a new case set

Every reference query, checked against the live fixture, for free:

```bash
npm run eval:validate                      # golden-set.json
npm run eval:validate -- --suite genomics  # a suite
```

Fix every `ERROR` and `TOO-MANY` before spending a token. Treat `EMPTY` as a
case worth rewriting: a reference that returns no rows passes trivially against
an assistant that also returns nothing.
