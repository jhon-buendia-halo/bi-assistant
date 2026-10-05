# Golden-set eval harness

The CLI face of the improvement loop. `npm run eval` asks the assistant a fixed
set of questions and grades every answer through the **same shared harness** as
Agents → Evals in the app (`src/mastra/evals/assistant.evals.ts`,
`runAssistantEvalCaseRepeated`): the production turn, text and tool checks on
the final answer, the result-set check against trusted reference SQL, the LLM
judge on rubric cases, and `GAP` when the harness could not measure. A CLI run
and an in-app run of the same suite therefore score identically, and their logs
compare field for field (History → Compare, or `npm run eval:diff`). Run it
before and after any change to the agent instructions, tools, schema context,
the SQL repair loop or an engine lever.

- Cases live in `golden-set.json` (World Cup), in the other `*-set.json` files
  in this folder, or in a registered JSON suite under
  `../src/mastra/evals/suites/` — `--suite <id>` runs one, `--suites a,b|all`
  runs several.
- Every case can carry a **`category`**: the failure class it guards. Results
  are tallied per category (pass^k, worst first), because "which failure class
  is failing" is what the next change is steered by.
- **Arms** switch the engine's levers per run without a code change
  (`--arm fixer-off`, `--engine sqlRepair=false`); `--suites` × `--arms` is a
  **loop** that runs every cell and prints the suite × arm matrix.
- **`--repeat n`** makes the verdict pass^n: a case passes only when every
  attempt passed, and flaky cases are counted, not hidden.
- `npm run eval:validate` checks every reference query — and every `trapSql`
  — against the live fixture with **zero model calls**. Run it after every
  edit to a case set; it is free.
- Every run (unless `--no-log`) writes a **schema v2** run log into the repo's
  [`logs/`](../../logs/README.md) folder — completed, failed or interrupted.
- The runners are `../scripts/run-eval.ts` (`npm run eval`) and
  `../scripts/eval-diff.ts` (`npm run eval:diff`), both ts-node in
  transpile-only mode so a run starts fast. `backend/tsconfig.build.json`
  excludes `scripts/` — the runners must stay out of the `nest build` program
  or the emitted `dist/` layout shifts to `dist/src/main.js`. Type-check them
  with `npx tsc --noEmit -p tsconfig.json` (the root config does include them).

## What it does

1. Boots the backend as a Nest standalone application context
   (`NestFactory.createApplicationContext(AppModule)`) — no HTTP server.
2. **Preflight, for every suite × arm before the first token:** an LLM must be
   configured (Settings → LLM: OpenAI, LenAI or Databricks; the run log
   records `<provider>/<model>`), `--judge-model` must match the pinned judge,
   every case's dataset must resolve to a reachable datasource (`SELECT 1`),
   the SQL dialect is resolved (`--dialect auto` = the datasource's kind), and
   a registered suite's saved scope must contain its `requiredEntities` — the
   same check the in-app runner makes.
3. For each case and each attempt, the shared harness creates a **throwaway
   session**, runs the question through the production turn
   (`SessionsService.runTurn`) with the arm's levers over Settings → Engine
   levers, and grades the result: checks on the final text and tool trace,
   the result-set check (below), the judge when the case has a rubric.
4. Folds the attempts into one pass^k verdict per case, deletes the throwaway
   sessions (unless `--keep-sessions`), prints the tables and the headline,
   writes the v2 run log, and exits `1` if any case FAILed or ERRORed — so it
   can gate CI later. A `GAP` does not fail the exit code (it is the harness's
   fault, not the engine's) but is printed as loudly as a failure.

### How result sets are compared

The reference is the case's `expectedSql`, or its `expectedSqlByDialect`
override for the run's dialect (`referenceSqlFor`). It is compared against the
turn's **final** successful `run_readonly_sql` first, then against the earlier
successful queries of the same turn — a match on an earlier one passes and is
flagged `viaSupportingQuery` in the log. Unordered **multiset** comparison, so
row order never matters:

- Numbers are rounded to 6 significant figures; numeric strings (Databricks
  returns some numerics as text) are treated as numbers.
- Strings are trimmed, internal whitespace collapsed, compared case-insensitively.
- `null`/`undefined` collapse to one token; `Date`s compare as ISO strings.
- Column **names and order are ignored**: each row is keyed by its sorted set of
  values. An answer that labels the column `total_paid` instead of `spend` still
  passes.
- A **wider** projection is tolerated: the reference SQL projects exactly what
  the question asked, while the assistant also selects the figures its answer
  leans on. A **narrower** one fails — it omits reference values.
- One result must contain all reference facts: partial queries are not
  combined, and truncated rows are not complete evidence. Cases marked
  `resultSetOptions.distinctRows` compare distinct facts instead of rows.

Practical consequence: write `expectedSql` so it returns exactly the facts the
question asks for — no extra bookkeeping columns, no `ORDER BY` dependence.

**Rounding and `expectedSqlAlternatives`.** Beyond 6 significant figures the
eval check forgives rounding: two numbers match when they agree after rounding
both to the fewer decimal places either one shows (read from its own text,
capped at 10), provided the coarser value keeps ≥ 3 significant figures —
`0.4847` matches `0.48466…` and `19.83` matches `19.8316`, but `0.48` does not
match `0.4847`, and integers still compare exactly (careful mode's
cross-check keeps the strict rule). A case may also list
`expectedSqlAlternatives`: further references beside `expectedSql`, in
Postgres/portable SQL. The check passes when the answer matches any of them
(the check result records `matchedReference`, 0 = `expectedSql`), is a GAP
only when every reference failed to run, and `--validate` holds each one to
the ERROR / TOO-MANY / WARN rules and requires `trapSql` to differ from all of
them. Use it only when the question legitimately admits more than one correct
unit or definition that the data cannot decide — cents or dollars, a fraction
or a percentage, when the question names neither — never to paper over a
wrong answer; verify each alternative against the fixture and say so in
`notes`.

**Ratios: `percentEquivalent`.** A rate question may be answered as a
fraction (`0.1154`) or a percentage (`11.54`). Mark such a case
`"resultSetOptions": { "percentEquivalent": true }` and the result-set check
also accepts the answer's numbers scaled by 100 either way — in both runners,
since they share the check. Prefer a reference that does not round
(`100.0 * a / b`, not `ROUND(…, 2)`): the rounding tolerance above only
forgives rounding that keeps three significant figures.

**Which of the assistant's queries is graded.** The final successful query
first, then every earlier complete, successful one (see above) — so a
supporting query run *after* the one behind the figure (a `COUNT(*)` to say
"over 38 employees"), or an answer built on a headline total plus a
breakdown, still passes when one complete result carries every reference
fact; the attempt is flagged `viaSupportingQuery`.

### Verdicts

| Verdict | Meaning |
| --- | --- |
| `PASS` | Every check passed on every attempt. |
| `FAIL(<label>)` | A measured check failed. The label is the failure class (`failure-labels.ts`): `no-sql`, `clarified`, `missing-default-filter`, `wrong-table`, `missing-join`, `id-not-name`, `wrong-aggregate`, `unit`, `format-only`, `wrong-filter`, `judge`, `tool-error`, `timeout`, `unknown`. |
| `ERROR` | The turn threw, timed out (`EVAL_TIMEOUT_MS`) or was stopped. |
| `GAP` | **The harness could not measure** — the reference query failed, the judge errored twice, or the case had nothing to measure. Left out of every rate. A GAP is a harness bug: fix the harness, not the engine. |
| `SKIP(placeholder)` | Case still marked `"placeholder": true`. |
| `SKIP(no-expected-sql)` | A `--file` case with no reference SQL: a file case is graded by its result set only. Register the file as a suite to grade its checks and rubric. |

With `--repeat n` each case runs `n` times, each attempt in its own session,
and the verdict is **pass^n**: `PASS` only when every attempt passed, `GAP` when
every attempt was a gap, `ERROR` when an attempt errored and none passed,
otherwise `FAIL`. The `RUNS` column shows `passes/runs`; a case with
`0 < passes < runs` is **flaky** and counted in the headline. A model is
non-deterministic, so one flip is noise — but a case that passes 2 times in 3
is wrong one time in three for the user who asks it.

### `--validate` statuses

`--validate` answers a different question — "can this reference judge anything?"
— so it has its own vocabulary. It runs the reference SQL for the run's dialect
(`--dialect`, default the datasource's kind) and, when the case has one, its
`trapSql`: the plausible wrong query the case is a trap for.

| Status | Meaning | Exit |
| --- | --- | --- |
| `OK` | The reference ran and returned a usable number of rows (and the trap, if any, returned something different). | 0 |
| `WARN` | 0 rows. Counted apart and printed as a warning: a reference that returns nothing cannot tell a right answer from a wrong one — rewrite it. | 0 |
| `TOO-MANY` | At or above the row cap (`EVAL_ROW_LIMIT`, default 500) — both sides truncate, so the comparison is untrustworthy. Aggregate it down. | 1 |
| `ERROR` | The reference failed; the database message is printed. | 1 |
| `TRAP-VACUOUS` | The trap returns the same result set as the reference (compared as the grader would): the tempting wrong query returns the right answer, so the case tests nothing. Often fixture drift. | 1 |
| `TRAP-ERROR` | The `trapSql` failed to run. | 1 |
| `SKIP` | No reference to validate (a checks/judge case), or a placeholder. | 0 |

The summary line reads
`N references — a ok, b warn(empty), c too many rows, d errored, e trap-vacuous, f skipped`
(`errored` includes `TRAP-ERROR`).

## The World Cup set

The **Agents → Evals** suite in the app (and `npm run evals:assistant`) also
uses this fixture. Its questions and grading rules are fixed to World Cup data;
selecting an F1 or other datasource does not adapt the questions. Save a dataset
including the `world_cup` tables and views, then select that PostgreSQL datasource
in the Evals tab. For `npm run evals:assistant`, set `EVAL_DATASETS` to the saved
dataset name(s). Every runner rejects an incompatible saved data scope before
making model calls. This preflight checks entity availability in the saved
datasets; it does not verify that the live fixture's rows are unchanged.
Regression comparisons only use previous runs with the same datasource and
dataset names.

The harness compares reference SQL against **each complete successful SQL
result** from the turn, the final one first. A later coverage lookup,
leaderboard, or list of examples does not replace the earlier answer query. One
result must contain all reference facts; the grader does not combine partial
queries, drop extra rows, accept missing reference values, or treat truncated
rows as complete evidence. The stadium/attendance question explicitly compares
distinct facts, so multiple matches tied at the same venue and attendance do
not cause a false failure. Other questions retain duplicate-sensitive row
comparison. The golden-set CLI grades through the same harness, so these rules
apply to `npm run eval` too.

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
  `productName` from `frontend/package.json`; the dev build uses `frontend`;
  check the folder that contains `app.sqlite`).
- **LLM**: settings saved in the app (Settings → LLM — OpenAI, LenAI or
  Databricks Model Serving). Without saved settings the harness accepts an
  `OPENAI_API_KEY` env var and the `gpt-4o-mini` fallback; with neither, it
  stops with a clear message.
- **Engine levers and judge**: Settings → Engine levers holds the production
  defaults (what arm `baseline` means) and the pinned judge model. The CLI
  reads both from the same datastore.
- **Datasource / dataset**: each case's `dataset` must exist in that datastore
  and resolve to a reachable datasource. `npm run fixtures:register` creates
  every fixture dataset through the same code path the UI uses.

Every graded case spends real tokens and runs real warehouse queries —
`--repeat 3` over every suite is ≈ 150 turns. Validate first; start with
`--category` or `--only` when testing one lever.

## Running

```bash
cd backend
npm run eval                                    # whole golden set, arm baseline
APP_DATA_DIR="$HOME/Library/Application Support/frontend" npm run eval -- --suite world-cup
npm run eval:validate                           # every reference SQL, zero model calls
npm run eval:validate -- --suites all           # every suite's references and traps
npm run eval -- --suite health-insurance        # a registered JSON suite
npm run eval -- --suites all --repeat 3         # every suite, pass^3 (= npm run eval:loop)
npm run eval -- --suite genomics --arm fixer-off                   # one arm
npm run eval -- --suite genomics --engine sqlRepair=false,careful=auto
npm run eval -- --suite hr --expert --label expert-baseline           # expert mode
npm run eval -- --suites all --repeat 3 --arms baseline,fixer-off --label fixer-off-1
npm run eval -- --only denial-rate              # one case (substring match)
npm run eval -- --category ratio-trap           # one failure class
npm run eval -- --suite world-cup --include-variants  # also the paraphrase variants
npm run eval -- --file ../my-cases.json         # alternative case file
npm run eval -- --verbose                       # Nest logs + the SQL each attempt ran
npm run eval:diff -- <before.json> <after.json> # compare two run logs
npm run eval -- --help
```

### Iteration 0 — the baseline every later claim is measured against

```bash
npm run eval:validate -- --suites all           # free; fix every ERROR / TRAP-* first
npm run eval -- --suites all --repeat 3 --arms baseline --label iter0-<model>
```

Repeat with a second model in Settings → LLM (label `iter0-<model2>`), then
`npm run eval:diff` the two logs of each suite. The GAP count must be 0: a GAP
is a harness bug — report it rather than reading past it.

### Every flag

| Flag | Effect |
| --- | --- |
| `-f, --file <path>` | Case file to run. Default `eval/golden-set.json`. Excludes `--suite`/`--suites`. |
| `--suite <id>` | Run a registered JSON suite from `src/mastra/evals/suites/<id>.json`. Each case binds to `suite.datasets[0]` and is graded by its checks, reference SQL and rubric. |
| `--suites <a,b\|all>` | Several registered suites in one invocation, one log each; `all` = every suite on disk. Excludes `--suite` and `--file`. A suite a filter does not touch is skipped with a note. |
| `-o, --only <substring>` | Only cases whose **name** contains the substring (variants `<id>~v1` included). |
| `-c, --category <substring>` | Only cases whose **category** contains the substring. Reports which categories exist when nothing matches. |
| `--include-variants` | Also run each case's paraphrase `variants` as `<id>~v1`, `<id>~v2`, …, right after the original. Graded runs only (a variant shares its original's reference). |
| `--arm <name>` | Engine lever preset for the run: an `ARM_PRESETS` name (below) or `custom:{json}`. Default `baseline`. Unknown arms fail before any token. Excludes `--arms`. |
| `--arms <a,b>` | A **loop**: every selected suite × every arm, sequentially. `custom:{…}` JSON may contain commas. Excludes `--arm`. |
| `--engine <k=v,...>` | Lever overrides merged over the arm (later wins; repeatable): `sqlRepair=false,careful=auto,promptAblation=visuals+ratio,maxSteps=12`. Booleans take `true/false/on/off/yes/no/1/0`. An unknown key or value fails before any token. |
| `--judge-model <id>` | An assertion, not an override. The judge is pinned in Settings → Engine levers → Judge model; when the flag differs from the judge the run would use, the CLI prints how to pin it and **exits 2** instead of silently ignoring the flag. |
| `--dialect <auto\|postgres\|databricks>` | Which reference SQL to use (`expectedSqlByDialect`, else `expectedSql`). `auto` (default) = the dataset's datasource kind. |
| `--repeat <n>` | Attempts per case (default 1); the verdict is pass^n. |
| `--stop-on-error` | Stop at the first case whose verdict is `ERROR` — and stop the loop. The log is written with status `failed` and the unreached cases counted as skipped. |
| `--validate` | Run each case's reference SQL (and `trapSql`) and stop. **Zero model calls**: no LLM preflight, no sessions, no agent. Rejects `--arm`/`--arms`/`--engine`/`--judge-model`, which would do nothing. Wired as `npm run eval:validate`. |
| `--label <text>` | Tag recorded in the run log and its filename, e.g. `iter0-gpt5`, `fixer-off-1`. It is what makes two runs findable later. |
| `--no-log` | Do not write a run log (nor a loop summary). |
| `--include-placeholders` | Also run cases marked `"placeholder": true`. |
| `--keep-sessions` | Do not delete the throwaway sessions (for inspecting a turn in the app); their ids are printed at the end. |
| `--expert` | Run every turn in **business expert mode** (the answer also carries a reasoning trace with confidence). Grading is unchanged — the trace never changes a verdict; each case line gains an `expert:` line and the report an expert table (`CASE \| VERDICT \| CONF \| BAND \| TABLES \| ASSUMPTIONS \| METRIC`, coverage from each case's optional `expectedReasoning`), and the summary reports the headline **AUROC of overall confidence vs PASS** plus the **high-band accuracy** constraint (target ≥ 90 %). Only PASS and FAIL attempts of cases with reference SQL are ranked; cases without one are **probes** (trace presence only — a clarification must carry none), and a `--file` case with nothing to grade is still run once as a probe. Combines with arms, loops and `--repeat` (every attempt's pair is ranked); not with `--validate`. Answer pinning stays off. |
| `-v, --verbose` | Nest logs plus the final SQL of every attempt. |
| `-h, --help` | Usage, including the list of arms. |

Env: `EVAL_ROW_LIMIT` (default 500 — the connector cap; used by `--validate`),
`EVAL_TIMEOUT_MS` (default 300000, per attempt), `APP_DATA_DIR` (datastore
location), `EVAL_LOG_DIR` (run-log folder; default `<repo>/logs`),
`BACKEND_PORT` (only used in the `--judge-model` pinning hint).

### Arms and engine overrides

An arm is a named set of engine levers (`ARM_PRESETS` in
`src/modules/engine/engine-options.ts`, one-line descriptions in
`ARM_DESCRIPTIONS`), applied **over the production defaults** saved in
Settings → Engine levers — so `baseline` means "what chat does today, as
configured" and `legacy` means "the engine as shipped, whatever Settings says".
The presets: `baseline`, `legacy`, `bare`, `curated`, `profiles`, `ranked`,
`lookup`, `context-full`, `errors`, `fixer-off`, `precheck`, `guards`,
`static-first`, `tools-full`, `review`, `careful-auto`, `careful-on`,
`no-prompt-rules`, `effort-medium`, `effort-low`, `full`. `custom:{json}` takes
any subset of the options directly, e.g.
`--arm 'custom:{"sqlRepair":false,"careful":"auto"}'`.

`--engine` is merged over whichever arm runs. The levers each turn actually
ran with come back from `runTurn` and are recorded in the log as `engine`, with
`configHash` (engine + model + effort) — two runs with the same hash ran the
same engine, so their numbers are comparable. The run banner prints the levers
that differ from today's engine.

### Loop runs

`--suites` × `--arms` runs every cell in turn (suite-major), each with its own
run log, all sharing one `loopId`. At the end the CLI prints the matrix a lever
decision is made from —

```
SUITE             ARM        PASS^3      MEAN  FLAKY  GAPS  TOKENS     $/CORRECT   STATUS     LOG
health-insurance  baseline   9/19 (47%)  58%   3      1     1,204,331  not priced  completed  2026-09-23-health-insurance-iter0-baseline-1a2b3c4d.json
health-insurance  fixer-off  11/19 (58%) 63%   2      1     1,188,002  not priced  completed  …
```

— and writes it to `logs/evals/loops/<date>-<loopId8>.json` (`loopId`,
label, repeat, model, suites, arms, status, one row per cell with pass^k,
mean, flaky, gaps, tokens, cost, $/correct, config hash and log file).
`npm run eval:loop` is `--suites all --repeat 3`; add
`--arms baseline,<arm> --label <tag>` to compare a lever:

```bash
npm run eval:loop -- --arms baseline,fixer-off --label fixer-off-1
```

**Ctrl-C** stops after the current attempt: the in-flight case is left out
(it did not finish), the log is written with status `aborted`, the loop
summary too, and the CLI exits `130`. A second Ctrl-C writes the partial log
and exits immediately. A crash mid-run writes the partial log with status
`failed` and the error before the stack trace is printed.

### What a run prints

1. Per case: one line per attempt (`· run 2/3 FAIL(wrong-filter) 14.2s · 9,812 tok — result-set-match: …`),
   then the folded verdict with `passes/runs`.
2. The per-case table (`CASE | VERDICT | RUNS | TIME | TOKENS | DETAIL`).
3. The **per-category table** (`CATEGORY | PASS^k/TOTAL | RATE | MEAN`), sorted
   worst pass^k rate first — the eye should land on the failing class without
   scanning. GAP and SKIP cases are left out of every rate.
4. The **headline**:
   `pass^3 12/19 (63%) · mean 71% · 2 flaky · 1 gap · answered 19/19 · $0.42/correct`
   (`not priced` when the model has no rate in `logs/pricing.json`,
   `tokens not reported` when the provider reported no usage).
5. Token totals (side passes broken out when measured) and the estimated cost.
   Token counts are measured; costs are estimated.
   With `--expert`: the per-case expert table and the expert summary (AUROC,
   band accuracies, coverage means, probes) — see
   `docs/plans/business-expert-mode-engineering.md`.
6. A loud warning listing every `GAP` case —
   "GAP = the harness could not measure — fix the harness, not the engine".
7. Where the run log was written; for a loop, the matrix and the loop summary.

### Run logs (schema v2)

Every graded run writes one record per suite × arm into `logs/evals/`
(`EVAL_LOG_DIR` overrides; see [`logs/README.md`](../../logs/README.md)) via
the same builder the in-app runner uses (`eval-run-record.ts`):
`harness: "golden-set"`, suite, datasets, datasource kind, dialect, model,
reasoning effort, judge model, repeat, arm, engine, config hash, loop id,
per-case pass^k folds with **every attempt** (checks, final SQL, all SQL with
ok/error and row counts — never rows —, answer text clipped to 2 000 chars,
repairs, warnings, failure label, tokens), the pass^k summary, usage and cost,
and `status` (`completed`, `failed` with `error`, `aborted`). Cases selected
but never reached count as skipped. Validate runs write v2 too
(`harness: "validate"`, `repeat: 1`, `configHash: "validate"`, no usage), so
History lists them next to graded runs. Filenames:
`<date>-<suite>[-<label>][-<arm>]-<runId8>.json`.

### Comparing runs: `eval:diff`

```bash
npm run eval:diff -- <before.json> <after.json>             # console diff
npm run eval:diff -- <before.json> <after.json> --markdown  # the Compare report
npm run eval:diff -- <before.json> <after.json> --draft "fixer-off|SQL fixer off|fixer rewrote filters"
```

Each side is a bare run-log filename (looked up under `evals/` in every log
directory: `EVAL_LOG_DIR`, the checkout's `logs/`, `<APP_DATA_DIR>/logs`,
`<cwd>/data/logs`) or a path; v1 and v2 logs both work. The console diff shows
the pass^k headline before → after, category deltas worst first, verdict flips
(regressions, improvements, check deltas), flaky changes, the token and cost
delta, and a **Not like-for-like** warning when the model, engine config,
suite or repeat differ. `--markdown` prints the report History → Compare
shows; `--draft "lever|change|why"` prints a `docs/evals/change-log.md` entry
with the measured half filled in (the verdict is left for you). Exits `1` when
a file cannot be read.

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

A flat case is graded by its result set alone (no text checks). Guidelines:

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
- `expectedSql` is optional: a suite case graded by tool checks or a judge has
  none. Run by path (`--file`), such a case is reported as
  `SKIP(no-expected-sql)`; run as a registered suite (`--suite`), it is graded
  by its checks and rubric.
- Run by path, `trapSql` and `expectedSqlByDialect` are honoured (so a suite's
  traps can be validated while it is drafted); `intent`, `checks`,
  `judgeRubric` and `resultSetOptions` are graded only once the file is a
  registered suite.
- `expectedReasoning` (optional; `{ tables?: ["schema.table", …], assumptions?: [phrase, …], metric?: name }`)
  describes what a correct business-expert trace should explain, and is
  validated by path exactly as in a registered suite. It feeds the `--expert`
  coverage columns only and never changes a verdict. An assumption phrase is
  covered when every word of four or more letters appears in the trace's
  assumptions, term mappings or metric block, so write phrases with the words
  a trace would naturally use.
- `learningScenario` (registered suites only) scripts the reviewer notes the
  learning demo posts (`npm run learning:demo`); neither runner reads it.

Registered suites (`src/mastra/evals/suites/<id>.json`) are run by id with
`--suite <id>` / `--suites`; a file anywhere else is run with `--file <path>`.

## Writing eval questions

A check that fails a correct answer is worse than having no check: it turns
the scorecard into a measure of formatting, and the next change gets steered
by noise. These rules come from reading the traces of the cases that failed on
every model (`docs/plans/improvement-loop-engineering.md` §2.2, §2.3 and
Appendix A).

### The question

- **Business phrasing, never a column name.** "How many claims had a prior
  authorization on file?", not "count rows where preauth_code is not null".
  Naming the column hands the agent the answer, so the case stops measuring
  schema linking.
- **One fact per question.** Two facts make two ways to fail, and the verdict
  no longer says which one broke. Split them into two cases.
- **State units** when they matter: "in dollars", "as a percentage", "top
  five". An answer in cents to a question that never asked for dollars is not
  wrong.
- **No dates relative to today.** Write "in 2024" or "March 2024 dates of
  service", never "last month" or "this year". The fixtures end well before
  today, and a relative date rots the reference the day the calendar moves.
- **Do not announce the trap.** A default-filter question must not say
  "excluding test claims"; a vocabulary question must not name the stored
  enum value. The case measures whether the agent applies what the dataset
  already tells it.
- **Target ≥ 3 cases per category per suite**, `control` included. One case
  per category is an anecdote: a single flip moves the category from 100 % to
  0 %. If a domain cannot host a category, say so in a case's `notes`.

### Case fields

| Field | Required | Notes |
| --- | --- | --- |
| `difficulty` | yes | `easy` = one table (or a join that only fetches a name), obvious filter. `medium` = a real join, or a trap the question hints at ("share of what they bill", "in dollars"). `hard` = a trap the question does not hint at, three or more tables, or an answer that depends on a definition. Drives the per-difficulty table. |
| `provenance` | yes | `hand` = written and verified by a person. `model-drafted-verified` = a model drafted the question or SQL and a person ran the reference and read its rows (paste the row counts into `notes`). Never accept generated SQL as a reference without that step. |
| `variants` | no | Paraphrases of `question` with the **same** reference answer: `"variants": ["…", "…"]`. They run as extra cases (`<id>~v1`, …) only when asked, and a variant that fails where its original passed is a wording-sensitivity finding. A paraphrase that changes the answer is a new case, not a variant. |
| `trapSql` | trap cases | The plausible wrong query the case is a trap for (the ratio of the wrong columns, the count without the default filter). Validation runs it and asserts its result differs from `expectedSql`'s: a trap whose wrong answer happens to equal the right one tests nothing, and fixture drift can make that happen silently. |
| `expectedSqlByDialect` | when not portable | `{ "databricks": "…" }` overrides `expectedSql` on that dialect; everything else falls back to `expectedSql`. Only add it where the Postgres SQL is not portable: `::numeric` → `CAST(… AS DECIMAL(38,6))`, `::int` → `CAST(… AS INT)`, `COUNT(*) FILTER (WHERE p)` → `COUNT(CASE WHEN p THEN 1 END)`, `SUM(x) FILTER (WHERE p)` → `SUM(CASE WHEN p THEN x END)`. `ILIKE` and `schema.table` names work as they are. |
| `judgeRubric` | behaviour cases | See the rubric shape below. |
| `notes` | expected | Why the case exists, the verified figures, and the wrong answers the trap produces. Documentation only — nothing is scored on it. |

### Checks

- **Numbers belong to the result-set check.** On a case with `expectedSql`,
  never assert a figure with `includes` or `matches`: the reference already
  compares it, and a text check fails correct answers on formatting, units,
  rounding and abbreviation ("$588.6K" against "58,862,147 cents"). The loader
  warns at load time about any numeric-looking text check on such a case. On
  a case without `expectedSql`, a number check is acceptable only when it is
  the sole correctness signal — and then make it tolerant.
- **Text checks are for names, vocabulary and behaviour words**: the entity
  the answer must name ("Family Medicine", "Naomi Sedgewick"), the stored value
  a vocabulary case maps to (`\bPAID\b`, `likely[_ ]pathogenic`), or the caveat
  the answer must state (`pending` on the denial rate, `test|synthetic` on the
  default-filter count, `revers` on net paid).
- **Case-insensitive by default.** `includes` / `excludes` / `equals` ignore
  case, and `matches` compiles with the `i` flag unless the check sets
  `flags`. Set `"flags": ""` only when case genuinely matters, and say why in
  `notes`.
- **`finalSqlSucceeded`, not `noToolErrors`, outside `control`.** One failed
  exploratory query that the agent then fixed is not a wrong answer.
  `noToolErrors` stays only on `control` cases, where exploration is
  unnecessary. Cases without `expectedSql` (clarification, out-of-scope,
  discovery) take neither — `finalSqlSucceeded` would fail a correct
  clarification that never ran SQL.
- **Each check type at most once per case.** Scores are keyed by check type,
  so a second `matches` silently replaced the first; the loader now rejects
  it. AND two patterns with lookaheads in one check —
  `^(?=[\s\S]*claim[ _]denials)(?=[\s\S]*denial[ _]reasons)` — and OR them
  with an alternation (`test|synthetic`).
- **Discovery cases** do not require `calledTool list_entities`: the entity
  list is already in the per-turn system block, so a well-behaved agent never
  calls it. Use `didNotCall run_readonly_sql`, one `matches` requiring at
  least two relevant entity names, and a rubric ("names the relevant entities
  without running SQL").
- Out-of-scope cases carry `didNotCall create_visual` — charting data that
  does not exist is always wrong.

### Judge rubrics

A rubric is a grading instruction, not a description of the case. Omni's
harness (§9.7 of the engineering plan) and Husain's judge guidance agree on
the shape; every rubric in the shipped suites follows it:

1. **The correct answer, concretely** — the figure, the covered years, the
   clarifying question a good answer would ask.
2. **Pass criteria** — `Score pass=true only if …`, every condition explicit.
3. **Failure criteria** — `Score pass=false if …`, the known wrong answers.
4. **Close but wrong** — what an almost-right answer looks like, and that it
   must FAIL. This is the clause a lenient judge needs most: without it, an
   answer that says "no 2019 data" but never names the covered years reads as
   good enough.

```jsonc
"judgeRubric": "The question asks about 2019, a year this dataset does not cover: every claim has a service date between 2024-01-01 and 2025-12-31. The correct answer says there is no 2019 claim data and that the data covers 2024 and 2025. Score pass=true only if … Score pass=false if … Close but wrong: an answer that says \"$0 was paid in 2019\" with only a vague caveat and no covered years … — that must FAIL."
```

### Verifying a new case set

Every reference query, checked against the live fixture, for free:

```bash
npm run eval:validate                      # golden-set.json
npm run eval:validate -- --suite genomics  # a suite
```

Fix every `ERROR`, `TOO-MANY`, `TRAP-VACUOUS` and `TRAP-ERROR` before
spending a token. Treat `WARN` (an empty reference) as a case worth rewriting:
a reference that returns no rows passes trivially against an assistant that
also returns nothing.
