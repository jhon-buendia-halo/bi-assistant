# Improvement loop — engineering plan

*Branch `improve/engine-eval-loop` · written 2026-09-22 · status: proposal, ready to start*

This is the engineering plan for turning the eval harness into a working
improvement loop: a trustworthy number, a way to move it, and a way to prove
the move was real. It complements, and does not replace, three existing docs:

| Doc | What it is | What it is not |
| --- | --- | --- |
| `docs/evals/improvement-loop.md` | Operator runbook: the commands to run one iteration | A plan for building the loop |
| `docs/evals/synthetic-domains.md` | Design of the two generated fixtures and their traps | A plan for more fixtures or more cases |
| `docs/plans/phase-1-answer-reliability.md` | The build plan for the first harness (Workstream C) | Current — the harness has grown past it |

Nothing in the repo today says *what to build next* to make the loop
trustworthy and effective. That is this document.

---

## 0. Summary

**Where we are.** Three Postgres fixtures, 50 tagged cases, three harnesses,
token logging, a change log, and an engine that is already a small pipeline
(assistant + SQL fixer + independent verifier + guards + knowledge/metrics/
verified-query context). Baseline on the current cases: gpt-4o-mini passes
2–3 of 20 per suite; gpt-5 passes 11 of 20 on health insurance.

**Why the numbers cannot be trusted yet.** Nine of the twenty health-insurance
cases fail on *every* model in *every* run. When gpt-5 and gpt-4o-mini fail
the same case the same way, the first suspect is the exam, not the student.
Section 2 lists the defects: the in-app harness omits context the production
turn gets, several checks fail correct answers, one reference encodes a
debatable definition, and the run log cannot show *why* a case failed.

**The plan, in order.**

1. **Make the scorecard honest** (WS0). Harness parity with production, retire
   or repair the checks that punish right answers, enrich the log so every
   failure is diagnosable offline, re-baseline with repeats.
2. **One metric**: execution accuracy (result set matches the trusted SQL),
   reported as **pass^3** — a case counts only when it passes 3 of 3 repeats —
   with per-category breakdown. Tokens per case is a constraint, not a score.
3. **Pull the engine levers in evidence order** (WS2): model and effort
   (free), context retrieval (largest measured gain in the 2026 literature,
   §9), tool behaviours, pipeline stages, prompt rules last. One lever per
   iteration.
4. **Grow the question set before growing the fixture set** (WS3 before WS4).
   Three cases per category per suite and paraphrase variants; a fourth,
   deliberately messy fixture only once the clean ones stop discriminating.

**On specialised agents.** The evidence, including Omni's production harness
(§9.7), favours *few, well-sized tools and stages with deterministic inputs*
over *many agents*: schema linking fed by column profiles and a join
graph, a SQL writer that sees only the linked schema, a verifier that
re-derives independently. Two of those three already exist here. Section 5.4
says what to add and what not to.

---

## 1. Inventory — what exists today

### 1.1 Fixtures

One Docker Postgres (`docker-compose.yml`, db `world_cup`, port 55432), one
schema per domain, loaded from `docker/postgres/init/` on first volume init.

| Schema | Origin | Largest tables | Traps |
| --- | --- | --- | --- |
| `world_cup` | hand-written `001_world_cup.sql` | 47 goals, 32 team-match stats | none planted; realistic small sports DB |
| `health_insurance` | `generate/health-insurance.ts`, seed 20260922 | 1 200 claims, 2 602 lines, 246 denials | H1–H14 (`synthetic-domains.md`) |
| `genomics` | `generate/genomics.ts`, seed 20240815 | 5 263 variant calls, 3 000 expression rows | G1–G15 |

Both generators draw every value from one `Rng` and **throw** when a planted
invariant drifts (48/48 tie, null bands, distractor margins). `npm run
fixtures:register` creates the datasource, saves one dataset per schema
through the UI's own code path (sample values + join hints included) and
seeds two metrics (`net_paid`, `allele_fraction`) and four knowledge snippets
(two default filters, two terms).

### 1.2 Cases

`backend/src/mastra/evals/suites/*.json` — 50 cases: World Cup 10, Health
Insurance 20, Genomics 20. 40 carry `expectedSql`, 9 carry a `judgeRubric`.
Every case is tagged with one of 16 categories. **Coverage is one case per
category per suite** for 13 of the 16 categories; only `ratio-trap`,
`default-filter`, `domain-semantics` and `control` have more than one.

Checks in use: `noToolErrors` on all 50, `calledTool` on 47, `includes` on 38,
`matches` on 36, `didNotCall` on 6, `toolOrder` on 1. Two cases use `matches`
twice (`net-paid-after-reversals-2024`, `denial-data-discovery`), which the
scorer silently collapses to one.

`backend/eval/golden-set.json` holds 9 further World Cup cases with no
category and no checks (result-set only). They do not overlap the suite.

### 1.3 Harnesses

| Harness | Entry | Runs the agent through | Scores with | Repeats |
| --- | --- | --- | --- | --- |
| `validate` | `npm run eval:validate -- --suite <id>` | nothing (reference SQL only) | OK / EMPTY / TOO-MANY / ERROR | n/a |
| `golden-set` | `npm run eval -- --suite <id>` | **`SessionsService.streamMessage`** — the production path | result-set only | `--repeat n`, all-must-pass |
| `in-app` | Agents → Evals tab, `npm run evals:assistant` | **`runEvals` on the bare agent** | text/tool checks + result set + LLM judge | none |

The two graded harnesses measure different systems (see 2.1).

A fourth script, `npm run check:answers`, is the precedent for repeats: it
runs the World Cup guard questions `CHECK_TRIALS` times and reports pass
rates with Wilson 95 % intervals. It is not wired to the suites.

### 1.4 Scoring

`result-compare.ts`: rows compared as a multiset; column names and order
ignored (row key = sorted values); numbers to 6 significant figures;
width-tolerant (the agent may return extra columns). `result-set-check.ts`
replays the captured SQL at 500 rows when completeness is unknown, iterates
*every* successful query and passes on the first match, and names harness
faults `MEASUREMENT GAP` — but still scores them 0.

LLM judge: `assistant-eval-judge`, same model as the agent, temperature 0,
strict rubric, `pass=false` on doubt; a judge error also scores 0.

### 1.5 Logging and UI

`logs/evals/<date>-<suite>-<label>-<id>.json` + `index.ndjson`. Per case:
id, category, verdict, first-failing-check id, duration, tokens. **No SQL,
no answer text, no per-check detail.** Traces live only in the in-app doc
store and the downloadable Markdown report. `logs/pricing.json` is empty by
design, so every run reports "not priced".

### 1.6 Engine

Six Mastra agents (`src/mastra/index.ts`): `assistant` (7 tools, 15-step
budget), `sql-fixer` (execution-guided repair, ≤2 attempts), `sql-verifier`
(careful mode: independent SQL from the question, result sets compared),
`assistant-eval-judge`, `knowledge-bootstrap`, `interactive-visual-designer`.

Context a production turn injects (`SessionsService.agentContext`): entity
list + join hints (≤1 500 chars), **metrics block** (≤4 000), **knowledge
block** (≤2 000), **verified queries** (≤3 pairs, lexical Jaccard), and
`reasoningEffort` from settings. Knowledge and metrics are pushed wholesale
with no relevance ranking; the model has no tool to look any of it up.

Result guards (`result-guards.ts`): degenerate ratio, constant metric (0/1
only), unordered limit, blank group key, row cap. Advisory: they ride back
on the tool result; nothing blocks an answer.

Datasets carry per-column `sampleValues` (5), `description`, and
`references` (declared FKs + naming-inferred joins) captured at save time.

### 1.7 Baseline runs (2026-09-22, `logs/evals/`)

| Suite | Model | Passed | Tokens / case | Notes |
| --- | --- | --- | --- | --- |
| health-insurance | gpt-4o-mini ×3 runs | 3, 2, 3 / 20 | ≈10 k | 3 cases flipped between the two identical post-fix runs |
| health-insurance | gpt-5 | 11 / 20 | ≈24 k | 8 improvements, 0 regressions vs 4o-mini |
| genomics | gpt-4o-mini ×2 | 2, 2 / 20 | ≈10 k | 2 cases flipped (both runs pre harness fix) |
| world-cup | gpt-4o-mini | 0 / 10 | ≈27 k | pre harness fix; not re-run since |

Cases failing on every model and every run (health insurance):
`paid-share-by-specialty`, `approved-claims-2024`, `payouts-2019`,
`net-paid-by-region-2024`, `net-paid-after-reversals-2024`, `paid-by-country`,
`denial-data-discovery`, `denial-rate`, `active-members-by-region`.

---

## 2. Findings — why the scorecard is not yet measuring the engine

### 2.1 The in-app harness does not run the production turn

`runAssistantEvalCase` (`assistant.evals.ts:587-612`) calls `runEvals` on the
bare agent with two system blocks: entity orientation and knowledge. A real
turn (`sessions.service.ts:235-300`) also injects:

- the **metrics block** — so the seeded `net_paid` and `allele_fraction`
  metrics never reach the agent in an eval. `net-paid-by-region-2024` and
  `mean-allele-fraction` (both `metric-definition`) cannot pass by
  construction. Same for the metric half of `net-paid-after-reversals-2024`;
- **verified reference queries**;
- `providerOptions.openai.reasoningEffort` — production defaults to `high`,
  evals run at the provider default;
- the **zero-SQL grounding guard**, the **tool-only synthesis fallback**
  (which the harness runs *after* scoring, so text checks see empty text),
  and the **careful-mode cross-check**.

The golden-set CLI goes through `streamMessage` and therefore *does* get all
of this, but it has no text/tool checks and no judge. Neither harness measures
"the product with all its checks".

### 2.2 Checks that fail correct answers

| Defect | Where | Effect | Evidence |
| --- | --- | --- | --- |
| `calledTool: list_entities` on discovery cases | 3 cases (`schema-discovery`, `denial-data-discovery`, `expression-data-discovery`) | The system block already lists every entity, so a well-behaved agent never calls the tool. | Fails on every model, every run. |
| `noToolErrors` on all 50 cases | every suite | One failed exploratory query — even one the fixer could not repair before the agent refined it and answered correctly — fails the case. | 5 failures across recorded runs carry reason `check-no-tool-errors`. |
| Text checks on numbers | `includes "395"`, `matches "6[,.]?318[,.]?595\|63[,.]?185"`, `matches "\b10\b"` … | Formatting, unit (cents vs dollars), rounding and abbreviation ("$588.6K") decide the verdict, not correctness. The result-set check already covers the number. | Most `check-includes` / `check-matches` failures. |
| Case-sensitive `matches` | `matches "PAID"` (no `i` flag) | "paid claims" fails. | `approved-claims-2024`. |
| Duplicate check type | 2 cases with `matches` ×2 | First pattern silently unenforced (`scorerResults[id]` overwrite). | `suite-loader.ts:472-479` comment; not validated. |
| Text checks before synthesis | `assistant.evals.ts:631-645` | A tool-only turn is scored on empty text, then prose is synthesised for the report. | Design. |
| Measurement gaps score 0 | `result-set-check.ts:249-256, 328-338` | Harness faults lower the engine's rate. | Commit `f04defd` fixed one class (14 false failures). |
| Judge error scores 0 | `assistant.evals.ts:504-536` | Malformed judge JSON = engine failure. | Design. |
| `validate`: EMPTY = PASS | `run-eval.ts:794-847` | A reference returning no rows is reported as healthy. | Design. |
| Result-set passes on any query | `result-set-check.ts:301-322` | A supporting query that matches passes a case whose *answer* used a different, wrong query. | Design. |
| Row key sorts values | `result-compare.ts:49-51` | Two columns swapped within a row are invisible. | Minor. |

### 2.3 References that encode a definition, not a fact

`denial-rate` expects `DENIED / (all non-PENDING)`. Excluding pending claims
from the denominator is a policy choice; nothing in the schema, sample values
or seeded knowledge tells the agent so. Both models fail it. Either seed it
as a metric (then it is a `metric-definition` case) or accept both
denominators when the answer names its choice. Review every reference whose
correctness depends on an unstated definition.

### 2.4 The log cannot explain a failure

A run-log case has no SQL, no answer, no per-check reason. To find out why
`paid-by-country` fails you must open the app, find the run, and read the
trace or download the Markdown. Diagnosis across runs and models — the core
activity of the loop — is not possible from the artefacts the loop produces.

### 2.5 Non-determinism is not measured

Three of twenty health-insurance cases flipped between two identical
gpt-4o-mini runs made after the truncation fix (`f04defd`); a fourth flips
when the earlier run is included. `--repeat` exists in the CLI only, and the in-app runner
compares single runs. A "regression" or "improvement" of one case between two
single runs is within noise.

### 2.6 Category coverage is one case

With n = 1 per category, a category rate is 0 % or 100 %. The per-category
diagnostic that the whole loop rests on cannot separate a systematic failure
from a coin flip.

### 2.7 SQL auto-repair can change the question

`sql-fixer` is told to "keep the original intent", but nothing checks that it
did. A repaired statement that swaps a column or drops a filter comes back as
a normal success with a note; the assistant cites the corrected SQL as its
own work.

---

## 3. Assessment of the proposed plan

The three points, as stated, and what the inventory says about each.

### 3.1 "Create more synthetic databases"

**Right direction, wrong moment.** There are three fixtures, not two (World
Cup counts). With gpt-4o-mini at 10–15 % and gpt-5 at 55 % on the *existing*
50 cases, a fourth domain adds cost without adding information: every trap
class already has a case that fails. New fixtures earn their keep when the
current ones stop discriminating — when most cases pass on the production
model and you need harder or different ones.

What a fourth fixture should be *when* it comes: not another clean, well-named
domain. The two generated schemas have real FKs, `CHECK` constraints, tidy
names and small tables. Real warehouses have abbreviated columns (`clm_amt_01`),
no declared keys, dates stored as `int` or text, wide denormalised fact tables,
near-duplicate columns and enough rows to hit the 500-row cap. That fixture
tests schema linking and truncation handling, which the clean ones cannot.
A Databricks-dialect fixture is the other gap: production targets Databricks
SQL, every eval runs on Postgres.

### 3.2 "Create questions with their answers, and one metric"

**Correct, and it is the core.** Two refinements:

- **The metric.** Execution accuracy — result set matches the trusted SQL —
  is the field's standard and already implemented. What is missing is
  *reliability*: a case that passes 1 of 3 times is not a capability. Report
  **pass^3** (all three repeats pass) as the headline, mean pass rate as the
  secondary figure, and treat 0 < passes < 3 as its own bucket ("flaky").
  Behaviour cases (clarify, refuse out-of-scope, describe schema) keep the
  judge, contribute to the same rate, and are reported as a separate row.
  Nothing else: no soft-F1, no partial credit, no answer-quality score.
- **How questions are written.** Business phrasing, never a column name;
  at least three cases per category per suite; two or three paraphrases of
  the same reference SQL (free to add, no new SQL to verify) to measure
  phrasing robustness — Databricks recommends 2–4 phrasings per benchmark
  question for the same reason (§9.1); every trap case should also carry the *tempting wrong
  SQL* so `validate` can assert the case discriminates (reference result ≠
  trap result). Section 5.3.

### 3.3 "The loop, and specialised agents"

**The order you had is right**, and the inventory sharpens it: scorecard →
harness parity → model/effort → context retrieval → tool behaviours → prompt.
The one addition: **repeat before believing** is not a last step, it is the
run mode (pass^3).

On specialised agents: the wish list — filtering, retry on failure, schema
relationships, semantic column meaning, sampling, using Knowledge properly —
splits into three kinds of thing, and only one of them is an agent:

| Wish | What it actually is | Status here |
| --- | --- | --- |
| Retry when SQL fails | a tool loop, best driven by the agent that knows the question, fed by descriptive errors | exists (`runSqlWithRepair`, a fixer that never sees the question); needs an intent guard (2.7) and a fixer-off comparison (L3, §9.7) |
| Understand relationships | a deterministic join graph | exists (declared FKs + `relationships.ts`); needs FK cardinality and to reach the eval harness |
| Semantic column meaning, value vocab | column profiles + value dictionaries computed at save time, plus retrieval | partial (5 sample values); needs null rate, distinct count, constant flag, top-N values |
| Use Knowledge correctly | relevance-ranked retrieval + a lookup tool | missing (push-only, no ranking) |
| Sampling | a tool | exists (`sample_rows`) |
| Filtering (default filters) | knowledge retrieval + a guard that checks the SQL applied them | retrieval exists; guard missing |
| Schema linking / question analysis | **one structured LLM stage** whose inputs are all of the above | missing — the real candidate for a new agent |
| Independent verification | an LLM stage | exists (`sql-verifier`, careful mode) |

Each additional LLM call adds latency, tokens and one more place for the
variance in 2.5 to enter. Build deterministic enrichment first, then one
linking stage, and measure each on its own before adding another.

---

## 4. The metric, precisely

**Case verdict.** For a case with `expectedSql`: PASS iff the result set of
the SQL *the answer used* (last successful `run_readonly_sql`) matches the
reference under the existing normalisation. For a behaviour case: PASS iff
the rubric judge passes and the declared tool checks hold. Harness faults are
`GAP`, excluded from the denominator and counted separately.

**Reliability.** Each case runs k times with identical inputs (k = 3 for
baselines and keep/revert decisions, k = 1 for cheap exploration).
`pass^k` = passed all k. `flaky` = 0 < passes < k. Headline number per suite:

```
pass^3 rate = cases passing 3/3 ÷ (cases − gaps)
```

Reported alongside: mean pass rate (Σ passes ÷ Σ runs), flaky count,
per-category pass^3, behaviour-case pass^3, pass^3 by **difficulty** (each
case tagged `easy` / `medium` / `hard`), the **answered-every-time** rate
(no empty or fallback response in any repeat), tokens and calls per case,
and **cost per correct answer** (run cost ÷ cases passing) once `pricing.json`
is filled — the figure Omni reports and the one that makes a cheaper-but-
worse model comparable with a dearer-but-better one (§9.7).

**Why k = 3 and not 1.** Published measurements (§9.1) put the run-to-run
spread of a single agentic eval at 2–6 points even at temperature 0. A
lever that moves the total by less than that on a single run has not been
shown to do anything.

**Constraint, not score.** Tokens per case and, once `pricing.json` is
filled, dollars per case. A lever that doubles cost for two points is
recorded as such; the decision is the operator's.

**Targets for the programme** (revise after WS0's honest baseline):
control 100 % pass^3 on every suite; ≥ 80 % pass^3 overall on the production
model; no category at 0 %.

---

## 5. Workstreams

Effort is in engineer-days, rough. File references point at where the change
lands. Each workstream ends with an exit criterion; nothing downstream starts
until it is met.

### WS0 — Scorecard trust (≈ 6–8 days, first)

| # | Task | Where | Notes |
| --- | --- | --- | --- |
| 0.1 | **Harness parity.** Extract the production turn into one reusable function (`runTurn(session, question, opts)` returning text, records, calledTools, usage, clarification) used by `streamMessage`, the golden-set CLI and the in-app runner. The in-app runner then gets metrics, verified queries, reasoning effort, grounding guard, synthesis-before-scoring and an optional `careful` flag. | `sessions.service.ts`, `assistant.evals.ts`, `eval-runs.service.ts`, `run-eval.ts` | Biggest single fix. Score text checks on the *final* text. |
| 0.2 | **Retire `calledTool: list_entities`** on the three discovery cases; keep `didNotCall: run_readonly_sql` + a rubric ("names the relevant entities without running SQL"). | 3 suite files | Or make the check "mentioned ≥ N entity names". |
| 0.3 | **Make `noToolErrors` opt-in.** Replace with `finalSqlSucceeded` (the answer's query ran) and keep `noToolErrors` only on `control` cases where exploration is unnecessary. | `suite-loader.ts`, all suites | Add the new check type to `CHECK_TYPES`. |
| 0.4 | **Number checks → result set.** Delete `includes`/`matches` that assert numbers when `expectedSql` exists; keep text checks for names, vocabulary and behaviour words. Add the `i` flag by default. | all suites | Loader: warn when a `matches` pattern is purely numeric on a case with `expectedSql`. |
| 0.5 | **Reject duplicate check types** in the loader; fix the two offending cases (merge into one alternation or split the case). | `suite-loader.ts:472-479`, `health-insurance.json` | |
| 0.6 | **`GAP` verdict.** Measurement gaps and judge errors become `GAP`, excluded from totals, listed in the report. `validate`: EMPTY → `WARN`, not PASS. Behaviour cases get a **second, supervised judge pass** on disagreement or low confidence (Omni's pattern, §9.7); every `judgeRubric` gains a *close-but-wrong* clause. | `result-set-check.ts`, `assistant.evals.ts`, `eval-telemetry.ts`, `run-eval.ts`, suites | Schema version 2 of the run log. |
| 0.7 | **Compare the answer's query first.** Result-set check tries the last successful query; a match on an earlier query passes with flag `viaSupportingQuery` so it can be reported. | `result-set-check.ts:301-322` | |
| 0.8 | **Enrich the run log** per case: final SQL, all SQL with success/error, answer text (≤ 2 k chars), per-check pass/reason, step count, calledTools, repairs, guard warnings, clarification asked, model + effort; per run: `repeat`, `passes`, harness config hash. | `eval-telemetry.ts`, `eval-run-log.ts`, `eval-runs.service.ts`, `run-eval.ts` | `logs/README.md` says no warehouse rows are stored — keep it that way (SQL and text only). |
| 0.9 | **`--repeat` everywhere.** In-app runner and `evals:assistant` gain `repeat`; the log stores per-attempt verdicts; the report shows pass^k, mean, flaky. Regression comparison uses pass^k. | `eval-runs.service.ts`, `agents.controller.ts`, Evals tab | |
| 0.10 | **Fix references.** `denial-rate` (seed a metric or accept both denominators via two `expectedSql` alternatives); review `\b10\b`-style checks; re-run `validate` on all suites. | suites, `bootstrap-fixtures.ts` | |
| 0.11 | **Fixer intent guard.** After repair, diff normalised token multisets of original vs repaired SQL; if anything beyond identifier substitution changed (filters, aggregates, joins), attach `warning: the repaired query changed the question — verify before answering` and record `repairKind`. | `sessions.service.ts:382-507` | Deterministic; no model call. |
| 0.13 | **Tool contract tests.** Zod-validate every tool's input *and* output shape; a detector for malformed state (a `run_readonly_sql` result with neither rows nor error); integration tests for cross-step rules ("after a repaired query, the answer cites the corrected SQL"; "a `default_filter` in Knowledge appears in the executed SQL"). | `src/mastra/tools/*.spec.ts` (none exist today), `sessions.service.spec.ts` | Omni: "every tool must perform exactly as specified" (§9.7). |
| 0.12 | **Iteration 0 baseline.** All three suites × {gpt-4o-mini, gpt-5} × repeat 3 through the parity harness. Read the trace of every remaining failure once and label it (engine / reference / gap). Change-log entry. | `docs/evals/change-log.md` | This is the "before" for every later claim. |

**Exit criterion.** Every FAIL in the Iteration 0 baseline is a confirmed
engine failure, with the failing SQL visible in the log. No case fails on all
models for a harness reason.

### WS1 — Diagnosis tooling (≈ 3–4 days, parallel with WS0 after 0.8)

| # | Task | Notes |
| --- | --- | --- |
| 1.1 | `npm run eval:diff -- <runA> <runB>` — per case verdict change, SQL side by side, check deltas, tokens delta. | Reads the enriched log only; no DB needed. |
| 1.2 | Automatic failure labels from the final SQL vs reference SQL: `no-sql`, `missing-default-filter`, `wrong-table`, `missing-join`, `id-not-name` (projection keyed by `*_id` without a name column), `wrong-aggregate`, `unit` (÷100 missing), `format-only` (result set matched, text check failed). | Heuristic, pure functions, unit-tested. Drives the "which lever" table in the runbook. |
| 1.3 | Trend view: Evals tab reads `index.ndjson`-equivalent history per suite and plots pass^k over runs, coloured by label. | Small; uses existing Angular feature. |
| 1.4 | Fill `logs/pricing.json` for the models in use. | Operator task; unblocks $/case. |

### WS2 — Engine levers, one per iteration (≈ 2–3 days each, weeks 2–6)

Each lever: hypothesis → categories expected to move → run pass^3 on the
target suite and World Cup (side-effect detector) → change-log entry →
keep/revert. Order reflects expected gain per unit of effort and the
research summary in §9.

**L1 — Model and effort (no code).** gpt-5 already moves 3 → 11 on health
insurance with zero regressions. Decide the production default; also measure
a mid-tier model (gpt-4.1 or gpt-5-mini class) at `medium` effort for the
cost-quality curve. Record tokens per case for each. This lever is repeated
at the end of the programme, because later levers may change which model is
enough.

**L2 — Context retrieval (largest expected gain).**
- *Column profiles at save time* (`datasets.service.ts` enrichment): null
  rate, distinct count, constant flag, min/max, top-N values for
  low-cardinality columns (≤ 25 distinct), numeric magnitude hint. Surface in
  `describe_entity` and in a compact per-entity "schema card" in the
  orientation block. Deterministically pre-empts `constant-column`,
  `empty-column`, `value-vocabulary`, `unit-confusion`.
- *Relevance-ranked knowledge and metrics*: score snippets and metrics against
  the question and the entities named in it (token overlap + entity match),
  fill the budget best-first instead of newest-first; raise the caps.
- *Context next to the definition* (§9.7): a Knowledge snippet whose
  `entities` names one table, or a new optional `column`, is also rendered
  inline in `describe_entity` output and in the schema card beside that
  column ("status: PAID/DENIED/PENDING/REVERSED — 'approved' means PAID"),
  not only in the separate Knowledge block. Same fact, placed where it is
  used.
- *`lookup_knowledge` tool*: lets the model pull a definition, a filter or a
  metric expression on demand — pull, not only push.
- *`lookup_values` tool* (Omni's field-values tool, §9.7): given an entity,
  a column and a phrase, return the distinct values (from the profile, or
  live for high-cardinality columns) ranked by fuzzy similarity, so
  "approved" resolves to `PAID` and "New York" to `NYC` before the query
  runs. Directly attacks `value-vocabulary` and the empty-result class.
- *Dataset descriptions and a pick step*: each dataset gets a one-paragraph
  "what questions this answers" (seeded by `fixtures:register`, editable in
  the Datasets screen); when a session spans several datasets the assistant
  is told to pick one first and say which (Omni's topic picker).
- *Join graph in the eval harness* (comes free with 0.1) and FK cardinality
  in the hints (`one-to-many`) so the model can reason about fan-out.
- *A business-semantics document per fixture* (§9.2, the largest measured
  lever in 2026 studies: +17 to +23 points on frontier models): metric
  definitions, join paths, default filters, units, coverage facts — seeded by
  `fixtures:register` as knowledge and metrics, not only the six trap-specific
  entries. Run **two eval arms** from then on, *bare* (schema only) and
  *curated* (semantics doc), and report both: the bare arm measures what a
  new customer gets on day one, the curated arm what a maintained dataset
  gets.
- *Failure → knowledge loop* (§9.2, TK-Boost): when a labelled failure is
  context-shaped, draft a dataset-level knowledge snippet (the
  `knowledge-bootstrap` agent already produces this shape), review it, and
  re-run. **Overfitting guard:** snippets must state a rule about the data
  ("statuses are PAID/DENIED/PENDING/REVERSED; 'approved' means PAID"), never
  a hint about a question; they are validated on held-out paraphrases (3.2),
  not on the case that produced them.

**L3 — Tool behaviours and guards.**
- **Descriptive errors first** (§9.7, Omni's first big win): every error a
  tool returns says what happened and how to fix it. Unknown column → the
  three closest column names on that entity; unknown table → the in-scope
  tables; type mismatch → the column's type and a sample value; empty result
  on an equality filter → the column's distinct values. Deterministic, uses
  the snapshot and profiles; no model call.
- **Fixer-off arm** (§9.7, split brain): run the target suite with
  `SQL_REPAIR_ATTEMPTS = 0` and descriptive errors on, so the assistant —
  which knows the question — does the retry. Keep the fixer only if this arm
  loses on pass^3; if kept, it is limited to syntax and identifier errors
  (0.11).
- `constant-metric` fires on any constant value over ≥ 2 rows, not only 0/1.
- New guard `id-only-projection`: result keyed by `*_id` with no text column
  → "join to the name".
- New guard `default-filter-missing`: a knowledge `default_filter` exists for
  an entity the query reads and its predicate is absent → warning.
- Empty-result handling: after `EMPTY_ROWS_NOTE`, if the query has an equality
  filter on a low-cardinality column, attach the column's known values.
- Fixer scope: repair only syntax and unknown-identifier errors; refuse
  semantic rewrites (builds on 0.11). Classify the execution outcome (error /
  timeout / empty) and respond per class (§9.3).
- **Context ordering for caching** (§9.7): put static blocks first
  (instructions, entity orientation, join hints, Knowledge, Metrics) and
  dynamic ones last (visuals list, active visual, verified pairs for this
  question). Today the visuals section rides in the first block. Zero risk,
  measurable in `cachedInputTokens`.
- *Optional: result summariser sub-call.* When a result exceeds the stored
  cap, a `maxSteps: 1` call with its own context turns it into a compact
  CSV plus three observations before it re-enters the assistant's context
  (Omni's summarisation sub-agent). Only if L2/L3 show truncation still
  drives failures; row caps are cheaper.
- **Parse-validate-enrich before execution** (§9.3, §9.7; zero tokens):
  parse the statement; verify every table and column exists in the dataset
  snapshot; verify join predicates use known edges or same-named keys; flag
  `SELECT *` on wide tables; check that every `default_filter` for an entity
  the query reads is present; when the query aggregates a column that a
  governed Metric defines, check the expression matches and name the Metric
  if it does not. Return findings as a tool `warning` *before* the database
  is hit. This is Omni's "let it write SQL, then parse it" applied to raw
  warehouses: SQL stays the interface, the semantic checks happen after.

**L4 — Pipeline stages (the "specialised agents" work).**
- *Stage A: question briefing (schema linking), only if L2 leaves linking
  failures.* One structured call, before the assistant loop, over: question,
  schema cards, join graph, ranked knowledge/metrics, verified pairs.
  Output: candidate entities and columns, matched literal values,
  metric/filter definitions that apply, an ambiguity note, and a one-line
  plan. **It is a briefing, not a delegate** (§9.7, "consolidating the
  brain"): it owns no tools and makes no query decisions; the assistant
  reads it as a system block and keeps every tool. Measured on its own with a
  *schema-linking recall* check (did the briefing name the tables the
  reference uses?) — cheap, no execution needed. Try L2's deterministic
  enrichment first; Omni's experience says a second brain is a cost to pay
  only when one brain with better context still fails.
- *Stage C₀: answer review, on by default* (Omni's validation agent, §9.7).
  One `maxSteps: 1` call over the transcript — question, executed SQL,
  result shape, warnings, final text — that checks the eight error classes
  Omni's judge checks: claims the results do not support, wrong or off-by-one
  date filters, a truncated result treated as complete, arithmetic done in
  prose instead of SQL, wrong comparison windows, ignoring the requested
  breakdown, degenerate query, disagreement with a matched Metric or
  default filter. On a finding, the assistant gets one corrective pass (the
  grounding guard already has this shape). Cheaper than re-deriving SQL;
  reported as a chip like `crossCheck`. Measured as its own lever with the
  token delta.
- *Optional experiment: `run_metric` tool.* A deterministic compiler from
  `(metric, dimensions[], filters[], period)` to SQL over the Metrics store
  and join graph. Omni tried a structured query form and abandoned it for
  "write SQL, then parse it" (§9.7), so this is **not** the primary path;
  the parse-validate-enrich stage in L3 covers the same ground with SQL as
  the interface. Run it only if metric-definition failures survive L2 + L3.
- *Stage C: verification as a gate for hard categories.* Careful mode's
  independent re-derivation already exists; run it automatically when Stage A
  flags `ratio`, `metric`, `multi-join`, or when a guard fired; on
  disagreement, generate a third candidate and vote by result set. Gate it on
  tokens: log the cost delta.
- Implement as sub-calls in `SessionsService` (the pattern the fixer and
  verifier already use). Move to a Mastra workflow only if a fourth stage
  appears.
- **Not recommended:** separate agents for filtering, retrying or sampling.
  They are tools and deterministic steps (§3.3).

**L5 — Prompt rules, last, one at a time — including removals.** Only for
failures the trace shows are rule-shaped (the model had the right context
and still did the wrong thing). Each rule is one iteration with a World Cup
side-effect run. The assistant prompt is ~120 lines of rules, each an
assumption about what the model cannot do on its own (§9.7); run a **prompt
ablation** iteration that removes rule groups and measures pass^3, and
repeat it after every model upgrade.

### WS3 — Question set growth (≈ 4–5 days, from week 3, continuous)

| # | Task | Notes |
| --- | --- | --- |
| 3.1 | ≥ 3 cases per category per suite (≈ 150 cases). Prioritise categories with a single failing case. | Hand-verified `expectedSql`, `validate` green. |
| 3.2 | **Paraphrase variants**: `variants: ["…", "…"]` on a case → same checks and SQL, run as separate attempts. Free coverage of phrasing robustness. | Loader + runner change; report per base case and per variant. |
| 3.3 | **Discriminating references**: optional `trapSql` per trap case; `validate` asserts `result(expectedSql) ≠ result(trapSql)`. | Catches fixture drift that would make a trap vacuous. |
| 3.4 | Writing rules in `backend/eval/README.md`: business phrasing, no column names, one fact per question, state units, no dates relative to today; a `difficulty` tag (`easy` / `medium` / `hard`) on every case; every `judgeRubric` states the correct answer, the failure criteria and what *close but wrong* looks like (§9.7). | |
| 3.5 | Real-session intake: thumbs-down on an answer opens a pre-filled case draft (question, agent SQL, dataset); the operator writes the reference. Once the app has users, real questions outrank synthetic ones — Omni's benchmark is 100 production questions, Anthropic's guide says to start from "user-reported failures" (§9.7). | Uses the existing feedback endpoint. |
| 3.6 | Generate candidate questions with a model *from the trap table*, then hand-verify. Never accept generated SQL as reference without running `validate` and reading it. | Speeds 3.1; does not replace verification. |

### WS4 — Fixtures (≈ 5–8 days, only after pass^3 ≥ 70 % on clean suites)

- **Fixture 4: "messy enterprise"** — e.g. a retail/ERP star-plus-snowflake
  schema: abbreviated column names, no declared FKs (forces `relationships.ts`),
  dates as `int` yyyymmdd and text, a wide denormalised fact table with
  near-duplicate columns, string-encoded booleans, 200 k+ rows in the fact
  table so honest answers must aggregate. Same `Rng` discipline and
  invariants. Traps: schema linking, truncation, type coercion.
- **Databricks dialect coverage**: either a Databricks workspace fixture
  (same DDL, loaded via the connector) or a dialect-translation layer for the
  suites so at least the control and multi-join cases run on Databricks SQL.
  Production targets Databricks; today nothing measures it.
- Only after both: a fifth *domain* if a category still has no realistic
  representative.

### WS5 — Automation (≈ 2–3 days, week 6+)

- `npm run eval:gate`: `validate` on all suites + `control` cases on the
  cheapest acceptable model, `repeat 1`. Runs in CI on PRs touching
  `mastra/`, `sessions/`, `datasets/`, suites or fixtures. Costs cents.
- Nightly: full pass^3 on the production model; appends to the index; posts
  the diff vs the previous nightly.
- Change-log discipline: a PR that changes a lever must include the entry.

---

## 6. The iteration protocol

The runbook (`docs/evals/improvement-loop.md`) stays the how-to. The
protocol below is what changes in it once WS0 lands.

1. **Pick one lever** from a labelled failure in the enriched log, never from
   the total. Write the hypothesis and the categories expected to move
   *before* running.
2. **Cheap check**: `--category <c> --repeat 3` on the target suite.
3. **Full check**: all suites, `--repeat 3`, production model. World Cup is
   the side-effect detector.
4. **Decide** with pass^3 and the flaky bucket: keep if the target categories
   improved and no category regressed in pass^3; revert if the total is flat
   and categories traded places; investigate if the flaky bucket grew.
5. **Record** in `change-log.md`: lever, change, why, before → after per
   category, side effects, tokens per case delta, verdict, run ids.
6. **Convert** every remaining systematic failure into either a fix, a new
   case that guards it, or a documented limit.

---

## 7. Sequencing

| Week | Workstream | Deliverable | Exit |
| --- | --- | --- | --- |
| 1 | WS0 0.1–0.11 | Parity harness, repaired checks, `GAP`, enriched log, repeat in-app | Unit tests green; `validate` green on all suites |
| 1–2 | WS0 0.12 + WS1 1.1–1.2 | Iteration 0 baseline (3 suites × 2 models × 3) with every failure labelled; `eval:diff` | Change-log entry "Iteration 0" |
| 2 | WS2 L1 | Model/effort decision with cost curve | Change-log entry |
| 2–4 | WS2 L2 | Column profiles, ranked retrieval, `lookup_knowledge`, join graph in harness | Each sub-lever its own entry |
| 4 | WS2 L3 | Guards + fixer scope | Entry |
| 3+ | WS3 | 3 cases/category, paraphrases, `trapSql`, intake | `validate` green; cases added *before* the fix that makes them pass |
| 5 | WS2 L4 | Answer review on by default, Stage A briefing (if still needed), verification gate — each measured separately | One entry each, with tokens delta |
| 6 | WS2 L5, WS5 | Prompt rules if still needed; gate + nightly | |
| 7+ | WS4 | Messy fixture, Databricks coverage | Only if pass^3 ≥ 70 % |

The subagent fan-out in `CLAUDE.md` applies: WS0 tasks 0.2–0.7 and 0.11 are
independent units; 0.1 and 0.8 are the cross-file ones.

---

## 8. Risks and honest limits

- **The judge runs on the model under test.** For behaviour cases the judge
  is the metric. Pin the judge to one fixed model per programme (not the
  agent's) so a model change does not move the ruler; note it in the log.
- **Fixtures are small and clean.** A high pass^3 here is necessary, not
  sufficient, for production quality. WS4 exists for that reason.
- **Paraphrases share one reference.** They measure phrasing robustness, not
  new capability. Count them separately.
- **Cost of repeats.** A full pass^3 on three suites is ≈ 150 turns; at the
  measured 10–24 k tokens per turn that is 1.5–3.6 M tokens, single-digit
  dollars at public list prices. Fill `pricing.json` so the log says it.
- **Generated questions and generated SQL.** Use a model to *draft*; never to
  *verify*. A wrong reference is worse than no reference.
- **Side passes are not in the token count** (grounding guard, verifier,
  synthesis, visuals). WS0 0.8 should sum them; until then totals are floors.

---

## 9. What the field is doing (internet research, 2026-09-22)

A deeper pass than the 2026-09-16 competitive research, focused on eval
methodology, context engineering and agent decomposition. Sources were
fetched and read unless marked *(snippet only)*. Each bullet ends with what
it changes in this plan.

### 9.1 Evaluation

- **Public gold references are wrong at scale.** Jin, Choi, Zhu & Kang
  (CIDR'26 / PVLDB 19(5), arXiv 2601.08778, 2026-01) found 52.8 % of BIRD
  Mini-Dev and 62.8 % of Spider 2.0-Snow annotations erroneous; re-scoring
  moved system ranks by up to ±9 places. A follow-up (BIRD-Platinum, arXiv
  2603.20004, 2026-03) corrected 61 % of items. → Our hand-verified references
  are the asset. WS0 0.10 (reference review) and WS3 3.3 (`trapSql`
  discrimination) are not optional polish.
- **Single runs are noise.** "On Randomness in Agentic Evals" (arXiv
  2602.07150, 2026-02): across 60 k trajectories, single-run pass@1 varied
  2–6 points with SD > 1.5 *even at temperature 0*; 2–3 point "improvements"
  may be noise. `nl2sql-reliability` (GitHub, 498 questions × 10 runs):
  pass@k 49.8 % vs pass^k 36.1 % for a 7B model, a 13.7-point gap; 41 % of
  attempts executed cleanly but returned wrong answers. → pass^3 as the
  headline (§4) is the field's recommendation, not a local preference.
- **Product scorers are pragmatic.** Databricks Genie benchmarks
  (docs.databricks.com/aws/en/genie/benchmarks): result sets match regardless
  of order, numerics to 4 significant digits, *extra columns fail*, 5 000-row
  cap, 2–4 phrasings per question recommended; agent mode uses an LLM judge
  guided by an "evaluation note". Snowflake Cortex Analyst evaluations pin
  the judge model per version and report accuracy, regression count and
  latency. Snowflake's 2024 methodology allowed several gold SQLs per question
  and used no LLM judge. → We keep width tolerance (it is reported via
  `shapeDiffers`), keep 6 significant digits, add multiple `expectedSql`
  alternatives for definition-dependent cases (0.10), and **pin the judge
  model** (§8).
- **Paraphrase robustness is a hidden axis.** SQL2NL (EMNLP 2025, arXiv
  2509.04657): schema-aligned paraphrases dropped a 70B model 77 → 67 and an
  8B model 63 → 43. → WS3 3.2 paraphrase variants.
- **Judge calibration.** Husain & Shankar's evals FAQ (hamel.dev, updated
  2026-09-18): binary pass/fail judges, 100–200 human-labelled examples per
  failure mode, report true-positive and true-negative rates, headline =
  "passes all checks", error analysis on ~100 traces first. → WS0 0.12 reads
  every failure once; add a small human-labelled set for the 9 rubric cases
  and report judge agreement.
- **Cost belongs next to accuracy.** BIRD reports R-VES (efficiency) beside
  EX; "Both Ends Count" (EuroMLSys'26, arXiv 2602.21480) shows 2–12× cost and
  latency spreads between models at similar accuracy. → tokens and $/case in
  every report (§4).

### 9.2 Context engineering

- **A business-semantics document is the largest measured lever.**
  Rumiantsau & Fokeev (arXiv 2604.25149, 2026-04, 100 questions): a 4 KB
  markdown "semantic layer" doc lifted three frontier models from 45–50 % to
  67–69 % (+17 to +23 points), and "the semantic-layer document accounts for
  essentially all of the significant variance; model choice within tier does
  not." dbt (2026-04-07, 11 questions × 20 runs): text-to-SQL 90 % → semantic
  layer 98 % on a well-modelled project; semantic-layer failures were
  *refusals*, text-to-SQL failures were *confident wrong numbers*. Databricks'
  Genie walkthrough (2026-02-06): 54 % after names/descriptions/keys/value
  dictionaries → 77 % after example SQL for metrics → 100 % after domain
  instructions. → **New L2 item**: a full semantics document per fixture
  (metric definitions, join paths, default filters, units, coverage facts)
  seeded by `fixtures:register`, and **two eval arms** — *bare* (schema only)
  and *curated* — reported separately, because the product must work at both
  ends.
- **Distinct values beat sample rows for schema linking.** A June 2025 study
  (arXiv 2506.11986, *snippet only*) reports linking recall 90.6 % with
  distinct column values vs 86.7 % with sample values vs 82.3 % with sample
  rows. → L2 column profiles with top-N distinct values, not only 5 samples.
- **Knowledge mined from the agent's own failures.** TK-Boost (arXiv
  2602.13521, 2026-02): run the agent on sample questions, distil corrective
  notes with applicability conditions, retrieve them at query time; up to
  +16.9 on Spider 2.0 and +10 as a bolt-on to state-of-the-art pipelines.
  → **New L2 item**: a failure → knowledge-snippet path (the
  `knowledge-bootstrap` agent already drafts snippets). **Guard against
  overfitting the exam**: notes must be dataset-level rules, never
  case-specific hints, and are evaluated on held-out paraphrases.
- **Retrieved verified question→SQL pairs are the production workhorse.**
  Swiggy Hermes V3 (2025-09, *snippet only*): 54 % → 93 % with historical
  query embeddings as few-shots. Snowflake now uses verified queries to
  optimise the semantic model and as a fast path that bypasses reasoning on
  near-duplicates (2025-11 / 2025-12). → Our `verified_queries` store already
  reaches the prompt; L2 upgrades retrieval from word overlap and 0.1 gets
  it into the eval harness.
- **Guided exploration beats free exploration.** FlexSQL (COLM 2026), TRUST-SQL
  (EMNLP 2026) and APEX-SQL (KDD 2026) show tool-using single agents matching
  or beating fixed pipelines on messy enterprise schemas (Spider2-Snow 65 %
  with an open 120B model); Sophrosyne (arXiv 2605.30862, 2026-05) shows the
  same agents over-explore, and that *directives in tool responses* cut
  exploration 4.6× and raised accuracy up to 12 % relative. → Keep the
  single assistant loop; make tool results carry directives (column
  profiles, "these are the distinct values", "join on X"). This is what
  `warnings` on `run_readonly_sql` already do for errors.

### 9.3 Architecture and selection

- **The BIRD leaderboard plateau (~82 % EX) is heavy multi-candidate
  pipelines.** Agentar-Scale-SQL (arXiv 2509.24403, 2026): task
  understanding → 17+ candidates from two generators → iterative fixer →
  group by identical execution result → pairwise tournament judge. Its
  ablation: −4.9 without the reasoning generator, −3.8 without the second
  generator, −1.8 without selection scaling, −0.5 without iterative
  refinement, −0.45 without task understanding. Authors concede "substantial
  computational overhead and high latency". → L4 Stage C (3–5 candidates,
  group by result, judge) is the affordable slice; the gains were measured on
  32B+ models, so expect less on small ones.
- **Repair by execution-outcome class.** SIRIUS-SQL (arXiv 2606.01246,
  2026-05): runtime error, timeout and empty result each get a targeted
  repair. → L3: fixer scoped to syntax/identifier errors; empty results get
  value hints, not a rewrite.
- **A deterministic verifier before execution is a real stage.** DeepEye-SQL
  (SIGMOD'26, arXiv 2510.17586): schema linking with relational closure →
  N-version generation → deterministic syntax/logic/quality toolchain →
  execution-guided selection; 75 % BIRD test with a ~30B MoE. Wren AI's
  "dry-plan validation" is the product version. → **New L3 item**: static SQL
  check against the dataset snapshot (parse, every identifier exists, join
  keys are known edges) before execution — zero tokens, and it pre-empts most
  fixer calls.
- **A dedicated critic agent is rare.** Across the systems above, critique is
  embedded in selection (tournament judge) or verification (independent
  re-derivation), not in a standalone "reviewer". → Supports §3.3: no
  agents for filtering, retrying or sampling.
- **Genie's 2026 pitch is context, not model.** Genie Agent Mode (2026-04)
  plans → hypotheses → many queries → report with SQL citations; Genie
  Ontology (2026-06) is a knowledge graph over tables, queries and dashboards
  with authority weighting; Databricks' internal 28-question suite: 84.5 %
  first-attempt vs 52.4 % for the best coding agent. Vendor numbers, but the
  direction matches 9.2.
- **Mastra.** Agent networks are deprecated in favour of *supervisor agents*
  that register sub-agents, workflows and tools with descriptions and
  schemas (mastra.ai/docs/agents/networks); scorers run live per trace or
  offline over stored traces (mastra.ai/docs/evals/overview). → L4 stays as
  sub-calls in `SessionsService` first; if a supervisor is needed, use that
  API, not networks.

### 9.4 Model choice

- Within a tier, model matters less than context (9.2). Between tiers, the
  same harness still moves ~8 points on hard enterprise SQL (Spider2-Snow
  leaderboard, two frontier models under one system). dbt found no gain from
  the highest reasoning effort over `high` at 2.5× the latency. Small open
  models are viable generators when wrapped (7B models near 69 % BIRD dev)
  but pay in reliability (pass^k gap 23.6 points for a 3B model vs 13.7 for
  7B). No public table pairs EX with $/question for the mid-tier models.
  → L1 measures a mid-tier model at `medium` effort against gpt-5 at `high`,
  and we publish our own $/case curve from `eval-telemetry`.

### 9.5 Synthetic evals

- **Answer-key-first fixtures** (dev.to, 2026; tools at
  github.com/rasinmuhammed/evalpacks): declare the truth, generate data to
  satisfy it, verify with an engine that shares no code with the generator,
  rotate seeds against contamination. Our generators already assert planted
  invariants and `validate` re-executes on live Postgres. → Keep; add
  `trapSql` (3.3).
- **Business-logic-driven question synthesis** (arXiv 2601.14518, 2026-01):
  personas, scenarios and a complexity dial; state of the art reached only
  43 % on the hardest tier. CORGI (arXiv 2510.07309) adds explanatory and
  recommendational questions. → WS3 3.6 uses a model to *draft* from the
  trap table; humans verify.
- **Messy-schema benchmarks exist** (LiveSQLBench-Large: ~1 000 columns and
  54 tables per DB, ~84 k prompt tokens). → WS4's fixture 4 is in the
  mainstream, not a detour.

### 9.7 The Omni harness — Chris Merrick, Code with Claude London (2026-05-20)

"Building the best agentic analytics harness: powered by Claude, built with
Claude Code" (youtube.com/watch?v=K4-flzsPraE, 26 min). Omni is an AI
analytics platform with a semantic layer; its agent is called Blobby. The
notes below follow the talk's transcript; Omni's written material fills in
detail: the architecture post (omni.co/blog, 2025-12-09), the benchmark post
(2026-07-28), the Evals docs (docs.omni.co/ai/evals). Anthropic's two
companion posts frame the same ideas generally: "Agent Harness Design:
3 Patterns" (claude.com/blog, 2026-04-02) and "Demystifying Evals for AI
Agents" (anthropic.com/engineering, 2026-01-09).

**How Blobby grew up — the phases and what each one taught them.**

1. *Single question, single answer.* Not enough: "you need to tell it more
   about your business if you want it to answer questions about your
   business" — even "last quarter" means calendar quarter to engineering and
   fiscal quarter to sales.
2. *Metadata on the semantic model.* Beyond label and description they added
   **AI context** ("how should you use this field"), **sample queries**
   ("this is the query you would run to answer a question like X") and
   **values** — "just a taste of what the values of that field are", so the
   model sees `AMER, EMEA, APAC` and infers that "United States" becomes
   `US`. Context is most effective **localised next to the definition it
   refers to**, "rather than in a separate file over somewhere else" — the
   same reason a `CLAUDE.md` close to the code beats one far away.
3. *The agentic loop.* The first "massive quality increase" was
   **error recovery**: "tell Blobby how to recover from errors and give it
   some budget to do that", then "invest in providing great error messages
   that were descriptive about what was happening and how you might fix
   it". "That alone allowed the quality score to increase dramatically…
   a lot of our more difficult evals got a lot better."
4. *Model tier.* Haiku was fine for question-and-answer but "once you get
   into these more elaborate agentic conversations it's just not designed
   for those"; they moved to Sonnet. Token use rose by design, and usage
   took off because hard questions started landing.
5. *Traces.* The CEO refused "LLMs are unpredictable" as an answer. The
   fix was to "really invest in understanding the traces" of bad sessions,
   where "seemingly random" failures "were rooted in real problems".
6. *"Consolidating the brain."* The original design had an **outer agent**
   that planned the task list and a **query sub-agent** that generated one
   query per request. "The outer agent didn't know what was actually able to
   be answered in a single query", asked for the impossible, and the
   sub-agent could not comply. "You want to be careful not to have a split
   brain between any sort of sub-agent system and outer agent system." They
   pulled the query tools up into the outer agent; "this got rid of a lot of
   this kind of seemingly unpredictable surprising behaviour" and
   "dramatically improved a lot of our more complicated evals".
7. *SQL, not a private query format.* Their query tool originally took a
   "highly structured", "jsonified" query. They switched to letting Claude
   **write SQL** and **parsing it** back into the semantic layer ("as long
   as it fits into a general form that we understand"; Claude "really likes
   CTEs" and the parser handled them well). Result: questions that had
   needed three or four chained attempts became one shot, and "we didn't
   have to teach Blobby about this proprietary JSON form of a query".
8. *Today.* An outer loop that checkpoints executions for recovery, an inner
   loop with a growing tool set (query, field values, visualisation,
   dashboards, **validation tools**, data-modelling tools), an internal eval
   system and one being built for customers, because the promise is
   "predictability and quality — the CEO needs to get the right answer, and
   the same answer every time".
9. *Evals as observability.* "My favourite thing about the eval is just
   having that raw trace data… being able to go and say, okay, this was bad.
   Why? … and then capturing that into a judge is a nice efficiency gain."
10. *Learn the harness from Claude Code.* "A semantic model is not that
    different from a codebase" — being users of Claude Code showed them what
    a good harness looks like (exploration tools, localised context,
    recovery budget), and they baked those patterns into Blobby.

Product stance stated in passing: "AI to build, UI to validate,
troubleshoot and refine" — every answer opens in a workbook where the query
and its filters can be inspected and changed.

**From the written material.** The benchmark (2026-07-28): 100 real
production questions, five setups on one warehouse, a rubric per question
covering "the correct answer, failure criteria, and what 'close, but wrong'
looked like", Claude Opus as judge with "a second Opus agent" running a
supervised check, the whole matrix run twice. Reported: accuracy by
difficulty (96 / 97 / 90 % easy / medium / hard), consistency (same answer
on 96 of 100 across runs; the next-best setup changed 30), answered-every-
time rate, median latency, **$ per correct answer** and tokens per correct
answer. "Nearly every observed failure happened in the sixth step": the
competing agent had found the right definitions, then hand-wrote SQL that
ignored them. Omni's product Evals: prompt sets of ≤ 25 questions written
"the way a user would ask, not in language that mirrors field names", a
binary judge that reads the whole transcript and checks eight error classes
(unsupported claims, wrong date filters, truncated result treated as
complete, arithmetic in prose, wrong comparison window, ignoring the
requested shape, wrong topic or degenerate query, mismatch with the expected
behaviour), side-by-side run comparison with per-prompt cost and duration,
"begin with 10–15 prompts… add a regression prompt whenever an answer turns
out wrong".

**Anthropic's framing.** Harnesses "encode assumptions about what Claude
can't do on its own"; re-test them at each model step change and ask "what
can I stop doing?". Keep tools general and few; static context first,
dynamic last, for caching; sub-agents for context isolation, not for
decisions; grade "what the agent produced, not the path it took"; a 0 % pass
rate across many trials "is most often a signal of a broken task, not an
incapable agent"; "read the transcripts".

**What this changes in the plan.**

| Lesson | Verdict | Where it lands |
| --- | --- | --- |
| Descriptive error messages + recovery budget were the first big win | Adopt as a first-class lever, ahead of a smarter fixer. Unknown column → name the closest columns; unknown table → list the in-scope tables; empty result on an equality filter → show the column's distinct values. | L3 (moved to the top) |
| **Split brain**: a sub-agent that generates SQL without the question is a design risk | Adopt. Our `sql-fixer` is exactly that: it sees the failed SQL and the error, never the question. Run an arm with the fixer **off** and descriptive errors **on**, letting the assistant (which has the question) retry. Keep the fixer only if the arm loses. Stage A becomes a *briefing* the assistant reads, never a delegate that owns query decisions. | L3, L4 |
| SQL as the interface, parsed and validated after, not a private DSL | Adopt. The static SQL check (L3) grows into a **parse-validate-enrich** stage: identifiers exist, joins are known edges, matched Metric expressions and `default_filter` predicates are present or flagged. `run_metric` is demoted to an optional experiment. | L3, L4 |
| Context localised next to the definition | Adopt. Knowledge snippets scoped to an entity or column render inline in `describe_entity` and the schema cards, beside the column they explain, in addition to the Knowledge block. | L2 |
| Values: a taste of each field's values | Already have 5 sample values; add profiles and the `lookup_values` tool with fuzzy match (typos are normal). | L2 |
| Model tier: small chat models are not built for agentic loops | Supports L1: measure a mid tier at `medium` effort before paying for the top tier; expect gpt-4o-mini-class to stay low regardless of other levers. | L1 |
| Traces are the eval's most valuable output | WS0 0.8 stores SQL, answer and per-check reasons per case; 0.12 reads every failure once. | WS0 |
| Validation tools, on by default | Adopt: answer review over the transcript, checking Omni's eight error classes. | L4 Stage C₀ |
| Field-values tool, topic pick, summarisation sub-agent | Adopt the first two; summarisation only if truncation still drives failures. | L2, L3 |
| Rubrics with "close but wrong"; difficulty tags; $ per correct answer; answered-every-time; second judge pass on behaviour cases | Adopt. | §4, WS0 0.6, WS3 3.4 |
| Static-first, dynamic-last context; prompt ablation on model upgrades | Adopt. | L3, L5 |
| Same answer every time | Is pass^3. | §4 |
| A semantic layer that owns all business logic and compiles the SQL | Direction we already follow with Knowledge + Metrics + the parse-validate stage; a full query engine is out of scope for a tool over arbitrary warehouses. | noted |

### 9.6 Sources (selection)

| Topic | Source | Date | Verified |
| --- | --- | --- | --- |
| Annotation errors | arxiv.org/abs/2601.08778 | 2026-01 | fetched |
| Randomness in agentic evals | arxiv.org/abs/2602.07150 | 2026-02 | fetched |
| pass^k reliability | github.com/MohanVishe/nl2sql-reliability | 2026 | fetched |
| Genie benchmarks | docs.databricks.com/aws/en/genie/benchmarks | 2026 | fetched |
| Cortex Analyst evaluations | docs.snowflake.com/…/cortex-analyst-evaluations | 2026 | fetched |
| Semantic-layer doc lift | arxiv.org/abs/2604.25149 | 2026-04 | fetched |
| dbt semantic layer vs text-to-SQL | docs.getdbt.com/blog/semantic-layer-vs-text-to-sql-2026 | 2026-04 | fetched |
| Genie iteration walkthrough | databricks.com/blog/how-build-production-ready-genie-spaces… | 2026-02 | fetched |
| TK-Boost | arxiv.org/abs/2602.13521 | 2026-02 | fetched |
| Distinct values vs samples | arxiv.org/pdf/2506.11986 | 2025-06 | snippet only |
| Sophrosyne (exploration) | arxiv.org/abs/2605.30862 | 2026-05 | fetched |
| FlexSQL / TRUST-SQL / APEX-SQL | arxiv 2605.02815 / 2603.16448 / 2602.16720 | 2026 | fetched |
| Agentar-Scale-SQL | arxiv.org/html/2509.24403v3 | 2026 | fetched |
| SIRIUS-SQL | arxiv.org/abs/2606.01246 | 2026-05 | fetched |
| DeepEye-SQL | arxiv.org/abs/2510.17586 | 2026 | fetched |
| SQL2NL paraphrases | arxiv.org/abs/2509.04657 | 2025-09 | fetched |
| Evals FAQ | hamel.dev/blog/posts/evals-faq | 2026-09-18 | fetched |
| Mastra supervisor agents / scorers | mastra.ai/docs/agents/networks, mastra.ai/docs/evals/overview | 2026 | fetched |
| Anthropic, writing tools for agents | anthropic.com/engineering/writing-tools-for-agents | 2025-09 | fetched |
| Omni harness talk | youtube.com/watch?v=K4-flzsPraE (Code with Claude London) | 2026-05-21 | title, description, session page verified; no captions |
| Omni architecture post | omni.co/blog/building-omnis-architecture-for-agentic-analytics | 2025-12-09 | fetched |
| Omni benchmark post | omni.co/blog/benchmarking-omnis-agentic-analytics-harness | 2026-07-28 | fetched |
| Omni Evals docs | docs.omni.co/ai/evals; docs.omni.co/modeling/models/ai-settings | 2026 | fetched |
| Anthropic harness patterns | claude.com/blog/harnessing-claudes-intelligence | 2026-04-02 | fetched |
| Anthropic evals guide | anthropic.com/engineering/demystifying-evals-for-ai-agents | 2026-01-09 | fetched |
| Talks | Sam Bhagwat, "Agents vs Workflows" (AI Engineer, 2025-08); Husain & Shankar on evals (Lenny's Podcast, 2025-09-25); Data + AI Summit keynote (2026-06-16) | | title/channel verified |

## Appendix A — Case-by-case reading of the always-failing health-insurance cases

| Case | Checks | Probable cause | Owner |
| --- | --- | --- | --- |
| `denial-data-discovery` | `calledTool list_entities` | Entities are already in the system block. | Scorecard (0.2) |
| `net-paid-by-region-2024` | `matches` on the net number | Metrics block not injected in evals → no `net_paid` definition. | Harness (0.1) |
| `net-paid-after-reversals-2024` | `matches` ×2 | Same, plus duplicate check type. | Harness (0.1, 0.5) |
| `denial-rate` | `includes "19.8"` | Reference excludes PENDING; nothing tells the agent to. | Reference (0.10) |
| `approved-claims-2024` | `includes "395"`, `matches "PAID"` | Number differs — needs trace; `PAID` is case-sensitive regardless. | Unknown → trace (0.12) |
| `payouts-2019` | judge | Rubric requires stating covered years; agent may only say "no 2019 data". | Engine or judge → trace |
| `paid-by-country` | `matches` on the total | Formatting or test-claim filter — needs trace. | Unknown → trace |
| `paid-share-by-specialty` | result set | Ratio trap; likely genuine. | Engine (L2/L3) |
| `active-members-by-region` | `matches "\b10\b"` / result set | Brittle number check and/or `terminated_on` filter. | Both |

## Appendix B — Glossary

- **Execution accuracy (EX)**: the SQL the agent ran returns the same rows as
  the trusted SQL. The standard text-to-SQL metric.
- **pass^k**: a case passes only if it passes all k repeats. Measures
  reliability, not luck.
- **GAP**: a verdict for "the harness could not measure this", excluded from
  the rate.
- **Schema linking**: choosing which tables and columns a question is about.
  The single largest error class in enterprise text-to-SQL benchmarks.
- **Value dictionary**: the distinct values of a low-cardinality column,
  stored so the model can map "approved" to `PAID`.
