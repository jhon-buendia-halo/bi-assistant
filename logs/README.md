# `logs/` — eval run history

Every eval run that spends tokens writes a record here. This is the project's
spending and quality history in one place: what ran, against which fixture, on
which commit and model, how many cases passed **per failure category**, how many
tokens it burned and what that is estimated to have cost.

It is committed on purpose. A run log is an engineering record, not user data —
the point is to diff last week's baseline against today's prompt change.

```
logs/
├── README.md          this file
├── pricing.json       your rates (edit it — it ships empty)
└── evals/
    ├── index.ndjson   one line per run, append-only
    ├── loops/         one summary per Loop run (suite × arm matrix)
    └── 2026-09-22-health-insurance-baseline-1a2b3c4d.json
```

Nothing here contains rows from a warehouse. Records carry case ids, verdicts,
durations, SQL **text** and row **counts** — never query results.

## Who writes it

| Writer | Harness value | Command |
| --- | --- | --- |
| Golden-set / suite CLI | `golden-set` | `npm run eval` (from `backend/`) |
| Reference-SQL check | `validate` | `npm run eval:validate` — zero model calls, so no usage |
| In-app runner | `in-app` | Agents → Evals in the desktop app |

`--no-log` skips the write. `EVAL_LOG_DIR` points the writers somewhere else
(useful from a packaged app or CI, where no checkout exists) — see "Log
directory precedence" below for the full fallback chain. A run is written on
**every** terminal state, not only success: completed, failed, and aborted
(Ctrl-C / Stop) runs are all logged, because a run that failed midway still
spent tokens.

## Token counts are measured; costs are estimated

Two different kinds of number, never mixed:

- **Tokens are measured.** They come off the provider's own `usage` object for
  the turn. Nothing in this repo estimates a token count from string lengths.
  A missing `usage` field means *the provider reported nothing* — it does not
  mean the case was free. `usage.calls` is how many model results were summed:
  `0` is "not observed".
- **Costs are estimated.** `estimatedCostUsd` is tokens × the rate in
  [`pricing.json`](./pricing.json), which you maintain. That file ships with an
  empty `models` object because the correct rate depends on your contract, and a
  guessed rate would be logged as fact. Until a model has an entry, runs print
  `not priced` and the cost fields are absent.
- `costIncomplete: true` marks a run where usage was observed but no rate was
  configured, so any cost figure you derive from it is a floor, not a total.

What the counts cover: the assistant turn itself, every step of it (the tool
loop included). They do **not** include every side pass a turn can make — the
grounding guard, the tool-only synthesis, careful mode's cross-check, the
answer-review pass, or the visual designer's sub-calls. Those are separate
agent calls; `sidePassUsage` breaks out the ones the harness measured, and a
run's `usage` total should be read as a close floor, not an invoice.

## Schema v2

Every run now writes `schemaVersion: 2`
(`backend/src/modules/agents/eval-telemetry.ts`). It captures per-attempt
SQL, answer text and every check verdict, so a case's pass^k fold can be
traced back to *which* attempt failed and why — not just that the case,
overall, did not pass. Files written by the old harness (`schemaVersion: 1`,
every run up to 2026-09-22) are still readable: every reader in this repo
(History, Trend, Compare, `eval:diff`, `readRunLog`) normalises a v1 file
into a v2 *view* on load, so callers handle one shape regardless of which
version is on disk. See "Reading a v1 file", below, for exactly how that
view is built.

### Verdict vocabulary and the fold rule

| Verdict | Meaning |
| --- | --- |
| `PASS` | Every check passed. |
| `FAIL` | A measured check failed — real evidence the engine got it wrong. |
| `ERROR` | The turn threw, timed out, or was stopped mid-attempt. |
| `GAP` | **The harness could not measure this** — a broken reference query, a judge that errored twice, or nothing to grade. Not a pass, not a fail: excluded from every rate. A GAP is a harness bug, never an engine finding. |
| `SKIP` | The attempt never ran (a case cut short by an abort, a placeholder case). |

**Folding attempts into a case verdict** (`foldAttempts`, pass^k — a case
passes only when *every* attempt passed, not merely most):

- SKIP attempts are dropped first — they contribute nothing either way.
- If every remaining attempt is `GAP`, the case is `GAP` (nothing was
  established).
- A `GAP` next to real attempts still counts as "not established" for that
  attempt: `[PASS, GAP, PASS]` is a case-level `GAP`, not a flaky `FAIL` —
  the run could not confirm that one draw, so it cannot claim the case
  either way.
- Any `ERROR` with zero `PASS`es among the measured attempts → case `ERROR`.
- All measured attempts `PASS` → case `PASS`.
- Otherwise → `FAIL`. A case is **flaky** when `0 < passes < runs` — it
  passed sometimes and failed sometimes, and that is reported as its own
  finding, not smoothed into a single verdict.

### Field table — v2 record

Top level (`EvalRunLogRecordV2`):

| Field | Type | Meaning |
| --- | --- | --- |
| `schemaVersion` | `2` | |
| `runId` | uuid | Unique per run; its first 8 characters appear in the filename. |
| `label` | string? | Your tag — `iter0-gpt5`, `fixer-off-1`. The one field that makes a run findable later. |
| `harness` | `in-app` \| `golden-set` \| `validate` | Which runner wrote it. |
| `suite` | string | Suite id, or the case file's basename for a `--file` run. |
| `agentKey` | string? | In-app runs only. |
| `datasets` | string[] | Saved dataset names the cases ran against. |
| `datasourceKind` | `postgres` \| `databricks`? | The datasource's kind. |
| `dialect` | string? | SQL dialect the reference queries were chosen for (`referenceSqlFor`). |
| `model` | string? | The model that actually answered, resolved at run time (`openai/gpt-5`, `databricks/databricks-claude-sonnet-4-5`, …). Absent on `validate` runs — they call no model. |
| `reasoningEffort` | string? | Effort the run used, if the provider takes one. |
| `judgeModel` | string? | The judge's router id, when pinned (Settings → Engine levers). Absent = the assistant's own model judged. |
| `repeat` | number | Attempts per case this run made. |
| `arm` | string? | The arm preset name (`ARM_PRESETS`) or `custom:{…}` the run used. |
| `engine` | `EngineOptions` | The levers the run actually resolved to and used — every field, not just the ones that differ from default. |
| `configHash` | string | `engineConfigHash(engine, {model, reasoningEffort, …})`, or `"legacy"` on a normalised v1 view. Two runs with the same hash ran the identical engine — their numbers are directly comparable. |
| `loopId` | string? | Set when this run was one cell of a Loop run. |
| `startedAt` / `finishedAt` | ISO 8601 | Wall-clock bounds. |
| `durationMs` | number | Includes boot and preflight. |
| `appVersion` | string? | `frontend/package.json` version. |
| `gitCommit` | string? | Short SHA of the tree that ran; absent outside a checkout. |
| `totals` | object | `{ cases, passed, failed, errored, gaps, skipped }` — case-level counts. |
| `summary` | `EvalRunSummary` | The pass^k headline — see below. |
| `categories` | object | `{ "<category>": { total, passed } }`, GAP and SKIP cases excluded (`tallyCategories`). Cases with no category land under `uncategorised`. |
| `usage` | `TokenUsage` | Run total: `{ inputTokens, outputTokens, totalTokens, reasoningTokens, cachedInputTokens, calls }`. `calls: 0` means "not observed", never "free". |
| `sidePassUsage` | object? | The side passes' share of `usage`, when measured — keyed by `grounding` \| `synthesis` \| `crossCheck` \| `review` \| `fixer`. |
| `estimatedCostUsd` | number? | Absent when the model has no rate in `pricing.json`. |
| `costIncomplete` | boolean? | Usage was observed but no rate configured — any cost figure derived from it is a floor. |
| `cases` | `EvalRunLogCaseV2[]` | See below. |
| `comparedToRunId` / `regressions` / `improvements` / `flakyChanges` | | Set when the run was diffed against an earlier one. |
| `status` | `completed` \| `failed` \| `aborted` | A failed or aborted run is still written — it still spent money. |
| `error` | string? | Why the run failed or was aborted. |
| `expert` | object? | CLI `--expert` runs only (business expert mode): `{ graded, traced, tracedPassed, tracedFailed, auroc?, bands: { high \| medium \| low: { n, correct, accuracy?, coverage? } }, highBandTarget, meetsHighBandTarget?, coverage: { tables?, assumptions?, metric? }, probes? }`. `auroc` is the headline (overall confidence vs PASS, Mann–Whitney with ties), computed over PASS and FAIL attempts only — an ERROR or a GAP says nothing about the answer; absent when a class is empty. Cases without reference SQL are `probes` (trace presence only), never ranked. The index line gains `expertAuroc` and `expertHighBandAccuracy`. |

`summary` (`EvalRunSummary` — the pass^k headline, computed over *scored*
cases: all cases minus `GAP` minus `SKIP`):

| Field | Meaning |
| --- | --- |
| `passK` / `passKRate` | Cases that passed every attempt, and that count ÷ scored cases. |
| `scored` | The denominator every rate above is over. |
| `meanPassRate` | Σ passes ÷ Σ runs over scored cases — the forgiving, per-draw rate (as opposed to pass^k's all-or-nothing one). |
| `flaky` | Cases with `0 < passes < runs`. |
| `gaps` | Cases the harness could not measure. |
| `answeredEveryTime` / `answeredObserved` | Cases where every attempt produced *something* for the user (answer text or a clarifying question), over cases that have attempts to judge. |
| `behaviourPassK` / `behaviourTotal` | pass^k restricted to the behaviour categories (`clarification`, `out-of-scope`, `discovery`) — absent when the run scored none of them. |
| `byCategory` / `byDifficulty` | Per-category and per-difficulty breakdowns, same pass^k/mean shape. |
| `costPerCorrectUsd` | `estimatedCostUsd ÷ passK`, only when both are known and non-zero — never a confident "$0.00" from an unpriced model. |
| `tokensPerCase` | Mean total tokens over cases with observed usage. |

`cases[]` (`EvalRunLogCaseV2` — one entry per case, the pass^k fold plus
every attempt behind it):

| Field | Meaning |
| --- | --- |
| `id` / `category` / `question` | The case as it was asked — suites change over time; the log stays legible without cross-referencing an old suite file. |
| `difficulty` | `easy` \| `medium` \| `hard`, when the case has one. |
| `variantOf` | Set on a paraphrase variant (`<id>~v1`) — the case id it rephrases. |
| `verdict` | The pass^k fold — see "Verdict vocabulary and the fold rule", above. |
| `runs` / `passes` / `flaky` | How many attempts were measured, how many passed, and whether `0 < passes < runs`. |
| `failureLabel` | From the first non-pass attempt that has one (`failure-labels.ts`): `no-sql`, `clarified`, `missing-default-filter`, `wrong-table`, `missing-join`, `id-not-name`, `wrong-aggregate`, `unit`, `format-only`, `wrong-filter`, `judge`, `tool-error`, `timeout`, `unknown`. |
| `usage` / `estimatedCostUsd` | Case totals. |
| `attempts` | `EvalRunLogAttempt[]`, below. |
| `expert` | `--expert` runs only: `{ traced, confidence?, band?, tablesCoverage?, assumptionsCoverage?, metricMatched?, blocks }` for the attempt the verdict reports; `clarified` on a probe; and, with `--repeat`, `attempts: { verdict, traced, confidence?, band? }[]` — every pair the run's AUROC ranks, so it can be recomputed from the log alone. A `SKIP` probe's `usage` is the probe turn's spend. |

`attempts[]` (`EvalRunLogAttempt` — one row per repeat, 1-based `attempt`):

| Field | Meaning |
| --- | --- |
| `verdict` | This single attempt's verdict (not folded). |
| `checks` | `{ id, passed, reason?, gap? }[]` — one entry per check the case declares. |
| `finalSql` | The last successful `run_readonly_sql` — the SQL the answer actually used. |
| `sql` | `{ sql, ok, error?, rowCount?, repaired? }[]` — **every** statement the turn ran, in order, rows never included. |
| `answer` | Final answer text, clipped to 2 000 characters (`clipLogText`). |
| `steps` / `calledTools` | Tool-call count and the tools called, in order. |
| `repairs` | SQL-fixer repairs (`{ original, repaired, error, kind, warning? }`) the repair-intent guard classified. |
| `warnings` | Guard + precheck warnings, deduplicated. |
| `clarification` | The clarifying question, when the turn asked one instead of answering. |
| `crossCheck` / `review` | Careful-mode and answer-review status for this attempt, when either ran. |
| `viaSupportingQuery` | The result matched an *earlier* successful query in the turn, not the final one. |
| `error` | Set on `ERROR` — what threw, or `"stopped"` when an operator hit Stop mid-attempt (`STOPPED_ATTEMPT_ERROR`). |
| `durationMs` / `usage` | Per-attempt timing and token usage. |

### Reading a v1 file

`readRunLog` / `readRunLogByFile` always return a v2 shape. For a file
actually written as v1: each case becomes one attempt (or `runs`/`passes`
attempts if the CLI's old `--repeat` recorded them), `repeat` is the largest
`runs` value seen, `engine` defaults to `ENGINE_DEFAULTS` (every v1 run
predates the levers), `configHash` is the literal string `"legacy"`, and
`status` is always `"completed"` (v1 had no way to record an aborted or
failed run — every v1 file that exists finished). A handful of v1 `reason`
strings map onto a `failureLabel` (`timeout`, `no-sql`, `llm-judge` →
`judge`, `sql-error` → `tool-error`, `check-no-tool-errors` →
`tool-error`, `clarified`); anything else keeps its `reason` with no guessed
label — a guessed one would read as a diagnosis nobody made.

`validate` runs (v1 or v2) reuse the same case shape: every reference query
is a "case", `PASS` means the query returned usable rows (`WARN`/`reason:
"empty"` when it returned none), a too-many-rows case fails, and
`usage.calls` is always `0` because nothing was spent.

## Log directory precedence

`resolveLogDir()` — where a run **writes** — tries, in order:

1. `EVAL_LOG_DIR` env var, if set.
2. The checkout's own `logs/` (found by walking up from wherever the process
   runs for the markers `backend/package.json` + `docker-compose.yml` —
   works under `ts-node`, after a `nest build`, and is `undefined` from a
   packaged app's resources, which has no checkout).
3. `<APP_DATA_DIR>/logs` (the packaged app — it used to log nothing at all
   because it has no checkout for (2) to find).
4. `<cwd>/data/logs` (a standalone backend with neither of the above).

It never returns nothing — even the packaged app logs its runs — though the
write is still best-effort: a full disk or a read-only folder must not fail
a run that has already spent tokens; the run still prints its results, just
without a saved file.

**Reading** merges every directory in that list that actually exists
(`candidateLogDirs`), each once (a symlinked or `/private/tmp`-vs-`/tmp`
duplicate collapses to one entry) — so an app started from this checkout
lists the CLI's runs alongside its own, and History, Trend, Compare and
`eval:diff`'s bare-filename lookup all search the same merged set. When a run
id appears in more than one directory, the entry whose file still exists on
disk wins.

## `loops/` summaries

A Loop run (`--suites` × `--arms` on the CLI, or the Evals tab's **Loop run**
panel) writes one record per cell under `evals/` as usual, plus one summary
under `evals/loops/<date>-<loopId8>.json`: `loopId`, label, repeat, model,
the suites and arms run, `status`, and one row per cell —
`{ suite, arm, passK, passKRate, meanPassRate, flaky, gaps, tokens,
estimatedCostUsd, costPerCorrectUsd, configHash, file }`. This is the matrix
the CLI prints at the end of a loop and the Evals tab renders from
`GET /agents/:key/evals/loops/:loopId`.

## Reading the index

`evals/index.ndjson` is one JSON object per line, append-only, holding just
enough for a listing or a trend line without opening every run's file:
`runId`, `startedAt`, `suite`, `label`, `harness`, `model`, `gitCommit`,
`cases`, `passed`, `inputTokens`/`outputTokens`/`totalTokens`,
`estimatedCostUsd`, `file` — plus, on a v2 line, `schemaVersion: 2`,
`repeat`, `arm`, `configHash`, `loopId`, `passK`, `passKRate`,
`meanPassRate`, `gaps`, `flaky`, `costPerCorrectUsd`, `status` — and, on an
`--expert` run (v1 or v2), `expertAuroc` and `expertHighBandAccuracy`. A run written
twice (a partial write on abort or crash, then the final one on completion)
appends a second index line for the same `runId`; every reader keeps the
last line per run id.

```bash
# every run, newest last
cat logs/evals/index.ndjson | jq -c '{startedAt, suite, label, arm, passK, passKRate}'

# pass^k rate over time for one suite (what the in-app Trend chart plots)
jq -c 'select(.suite == "health-insurance") |
  [.startedAt, .label, .arm, (.passKRate * 100 | floor)]' logs/evals/index.ndjson

# filter by arm — did "fixer-off" ever regress relative to baseline runs of the same suite?
jq -c 'select(.arm == "fixer-off") |
  {startedAt, suite, passKRate, flaky, gaps}' logs/evals/index.ndjson

# what the last ten runs cost
tail -10 logs/evals/index.ndjson | jq -s 'map(.estimatedCostUsd // 0) | add'

# find a run's file by label
jq -r 'select(.label == "iter0-gpt5") | .file' logs/evals/index.ndjson

# expert runs: the AUROC headline and the high-band constraint over time
jq -c 'select(.expertAuroc != null) |
  {startedAt, suite, label, expertAuroc, expertHighBandAccuracy}' logs/evals/index.ndjson
```

## Comparing two runs

Prefer `npm run eval:diff -- <before.json> <after.json>` or History → Compare
in the app — both use `diffRunLogs`, which already applies the pass^k fold,
warns when the two runs are not like-for-like (different model, engine
config, suite or repeat), and reports per-check deltas, not just verdict
flips. The raw `jq` below is for anything Compare doesn't show, or for a
quick check without opening the app.

Categories are the unit worth comparing — a flat pass count tells you
something moved, not what.

```bash
BASE=logs/evals/2026-09-22-health-insurance-baseline-1a2b3c4d.json
NEW=logs/evals/2026-09-23-health-insurance-iter0-gpt5-9f8e7d6c.json

# per-category rates, side by side
jq -r '.categories | to_entries[] | "\(.key)\t\(.value.passed)/\(.value.total)"' "$BASE" | sort > /tmp/base.tsv
jq -r '.categories | to_entries[] | "\(.key)\t\(.value.passed)/\(.value.total)"' "$NEW"  | sort > /tmp/new.tsv
diff -y /tmp/base.tsv /tmp/new.tsv

# which cases flipped (v2: case-level pass^k verdict, not a per-attempt one)
jq -r '.cases[] | "\(.id)\t\(.verdict)\t\(.passes)/\(.runs)"' "$BASE" | sort > /tmp/base-cases.tsv
jq -r '.cases[] | "\(.id)\t\(.verdict)\t\(.passes)/\(.runs)"' "$NEW"  | sort > /tmp/new-cases.tsv
diff /tmp/base-cases.tsv /tmp/new-cases.tsv

# did the change pay for itself?
jq -r '[.label, .arm, .usage.totalTokens, .summary.costPerCorrectUsd // "not priced"] | @tsv' "$BASE" "$NEW"
```

Only compare runs of the same `suite` **and** `datasets`. A different fixture
is a different question set; the numbers are not commensurable. Note
`model`, `engine` and `configHash` too — a cheaper model that loses two
categories is a different trade than an engine-lever change that loses them,
and two runs with the same `configHash` ran the literal same engine.

Keep a `baseline` run per suite and re-run it after any change to the agent
instructions, tools, schema context, the SQL repair loop, or a lever flipped
in Settings → Engine levers.

## No warehouse rows are stored

Records carry case ids, verdicts, durations, SQL **text** and row
**counts** — never query results. `sql[].rowCount` is a number; `answer` is
free text capped at 2 000 characters (`clipLogText`). This file is
deliberately committed and diffed like code, so nothing that could be
customer data belongs in it.
