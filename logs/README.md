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
    └── 2026-09-22-health-insurance-baseline-1a2b3c4d.json
```

Nothing here contains rows from a warehouse. Records carry case ids, verdicts,
durations and token counts — never query results.

## Who writes it

| Writer | Harness value | Command |
| --- | --- | --- |
| Golden-set CLI | `golden-set` | `npm run eval` (from `backend/`) |
| Reference-SQL check | `validate` | `npm run eval:validate` — zero model calls, so no usage |
| In-app runner | `in-app` | Agents → Evals in the desktop app |

`--no-log` skips the write. `EVAL_LOG_DIR` points the writers somewhere else
(useful from a packaged app or CI, where no checkout exists).

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
loop included). They do **not** include the side passes a turn can make — the
grounding guard, the tool-only synthesis, careful mode's cross-check, or the
visual designer's sub-calls. Those are separate agent calls; treat a run's total
as a close floor, not an invoice.

## Record schema

One JSON file per run, `schemaVersion: 1`. Fields, in the order they appear:

| Field | Type | Meaning |
| --- | --- | --- |
| `schemaVersion` | `1` | Bumped if the shape ever changes, so old runs stay readable. |
| `runId` | uuid | Unique per run. Its first 8 characters end up in the filename. |
| `label` | string? | Your tag for the run — `--label baseline`, `--label iter-2-prompt-ratio`. The one field that makes a comparison meaningful later. |
| `harness` | `in-app` \| `golden-set` \| `validate` | Which runner produced it. |
| `suite` | string | Suite id, or the case file's basename (`golden-set`). |
| `agentKey` | string? | In-app runs only: which agent was evaluated. |
| `datasets` | string[] | Saved dataset names the cases ran against. |
| `model` | string? | The model that actually answered, as resolved at run time (`openai/gpt-4o-mini`, `lenai/<deployment>`). Absent on `validate` runs — they call no model. |
| `startedAt` / `finishedAt` | ISO 8601 | Wall-clock bounds of the run. |
| `durationMs` | number | `finishedAt - startedAt`, including boot and preflight. |
| `appVersion` | string? | `frontend/package.json` version — the single source of truth for releases. |
| `gitCommit` | string? | Short SHA of the tree that ran. Absent outside a checkout. |
| `totals` | object | `{ cases, passed, failed, errored, skipped }`. |
| `categories` | object | `{ "<category>": { total, passed } }` — the per-failure-class tally the loop is steered by. Skipped cases are excluded: a case that never ran cannot lower a rate. Cases with no `category` land under `uncategorised`. |
| `usage` | object | Run total: `{ inputTokens, outputTokens, totalTokens, reasoningTokens, cachedInputTokens, calls }`. |
| `estimatedCostUsd` | number? | Run total in US dollars, or absent when the model has no rate. |
| `costIncomplete` | boolean? | See above — the cost is a floor. |
| `cases` | array | Per case: `id`, `category?`, `verdict` (`PASS`/`FAIL`/`ERROR`/`SKIP`), `reason?` (`result-mismatch`, `no-sql`, `timeout`, `sql-error`, …), `durationMs`, `usage?`, `estimatedCostUsd?`. With `--repeat n` the CLI also writes `runs` and `passes`, so a 4/5 case reads as a flake rather than a flat fail. |
| `comparedToRunId` | string? | Set when the run was diffed against an earlier one. |
| `regressions` / `improvements` | string[]? | Case ids that flipped, relative to `comparedToRunId`. |

`validate` runs reuse the same shape: every reference query is a "case", `PASS`
means the query returned usable rows (its `reason` is `empty` when it returned
none), `FAIL(too-many-rows)` means it hit the row cap, and `usage.calls` is `0`
because nothing was spent.

## Reading the index

`evals/index.ndjson` is one JSON object per line, appended in run order, holding
just enough for a trend line: `runId`, `startedAt`, `suite`, `label`, `harness`,
`model`, `gitCommit`, `cases`, `passed`, token totals, `estimatedCostUsd` and
the `file` to open for the detail.

```bash
# every run, newest last
cat logs/evals/index.ndjson | jq -c '{startedAt, suite, label, passed, cases, totalTokens}'

# pass rate over time for one suite
jq -c 'select(.suite == "health-insurance") | [.startedAt, .label, (.passed / .cases * 100 | floor)]' logs/evals/index.ndjson

# what the last ten runs cost
tail -10 logs/evals/index.ndjson | jq -s 'map(.estimatedCostUsd // 0) | add'

# find a run's file by label
jq -r 'select(.label == "baseline") | .file' logs/evals/index.ndjson
```

## Comparing two runs

Categories are the unit worth comparing — a flat pass count tells you something
moved, not what.

```bash
BASE=logs/evals/2026-09-22-health-insurance-baseline-1a2b3c4d.json
NEW=logs/evals/2026-09-23-health-insurance-iter-2-9f8e7d6c.json

# per-category rates, side by side
jq -r '.categories | to_entries[] | "\(.key)\t\(.value.passed)/\(.value.total)"' "$BASE" | sort > /tmp/base.tsv
jq -r '.categories | to_entries[] | "\(.key)\t\(.value.passed)/\(.value.total)"' "$NEW"  | sort > /tmp/new.tsv
diff -y /tmp/base.tsv /tmp/new.tsv

# which cases flipped
jq -r '.cases[] | "\(.id)\t\(.verdict)"' "$BASE" | sort > /tmp/base-cases.tsv
jq -r '.cases[] | "\(.id)\t\(.verdict)"' "$NEW"  | sort > /tmp/new-cases.tsv
diff /tmp/base-cases.tsv /tmp/new-cases.tsv

# did the change pay for itself?
jq -r '[.label, .usage.totalTokens, (.estimatedCostUsd // "not priced")] | @tsv' "$BASE" "$NEW"
```

Only compare runs of the same `suite` **and** `datasets`. A different fixture is
a different question set; the numbers are not commensurable. Note the `model`
too — a cheaper model that loses two categories is a different trade than a
prompt change that loses them.

Keep a `--label baseline` run per fixture and re-run it after any change to the
agent instructions, tools, schema context or the SQL repair loop.
