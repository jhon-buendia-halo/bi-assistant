# Running the improvement loop

How to measure the engine on a dataset, change one thing, and prove whether it
helped. This is the operator's runbook for the loop in *Questions to Insights
Evals*, Part 2. Everything here can be done in the app; the CLI equivalents
are given alongside for scripting and CI.

The rule the whole thing rests on: **same questions, same data, one change at
a time.** Change two levers at once and the report tells you nothing about
either.

Vocabulary check: a **run** grades one suite once; a **loop** runs several
suites × several **arms** (named bundles of engine levers) in one go and
prints the matrix. A case's verdict with `--repeat 3` (or "repeat 3" in the
app) is **pass^3**: it counts as passed only when all three attempts passed.
A **GAP** means the harness could not measure a case — a broken reference
query, a judge that errored twice — and is excluded from every rate; it is
never a pass or a fail.

---

## 0. Once per machine

```bash
docker compose up -d postgres          # repo root — the three fixtures live here
cd backend
npm run fixtures:register -- --reprofile
```

`fixtures:register` creates the Postgres datasource, saves the three fixture
datasets through the same code path the UI uses, and seeds the full
business-semantics document per fixture (knowledge snippets, metrics **and**
dataset descriptions) from `backend/scripts/fixture-semantics.ts`.
`--reprofile` additionally computes column profiles (null rate, distinct
count, top values) for each fixture dataset. It is idempotent — safe to
re-run after regenerating a fixture (`--force-refresh` re-snapshots the
datasets themselves).

Two narrower flags, for when you don't want the full seed: `--descriptions`
restricts the run to **dataset descriptions only**, skipping the
knowledge/metric seed entirely — do not use it for first-time setup, it
will leave the fixtures without their knowledge and metrics. `--semantics-only`
skips datasource/dataset creation and only (re-)seeds knowledge, metrics and
descriptions against datasets a prior run already registered.

This has to run against the **same datastore the desktop app reads**, so set
`APP_DATA_DIR` before running it (or run the app once, add a datasource by
hand, and skip this):

```bash
# dev build (npm run electron / electron:dev)
export APP_DATA_DIR="$HOME/Library/Application Support/frontend"

# packaged app ("Halo BI Assistant" is frontend/package.json's productName)
export APP_DATA_DIR="$HOME/Library/Application Support/Halo BI Assistant"
```

Then:

- **Fill `logs/pricing.json`.** It ships with an empty `models` object on
  purpose — this repo cannot know your negotiated rate. Copy the `_example`
  entry into `models`, key it by the model id the run log records (the part
  after the provider slash is matched too, so `"gpt-4o-mini"` covers both
  `openai/gpt-4o-mini` and `lenai/gpt-4o-mini`). Until an entry exists, every
  report says **not priced** and only the (exact) token counts carry the
  report.
- **Optional: pin the judge model.** Settings → Engine levers → *Eval judge* →
  *Judge model* (a `<provider>/<model>` router id, e.g.
  `openai/gpt-4.1-mini`). Recommended, so changing the assistant's production
  model does not also move the ruler the assistant is judged against on
  behaviour cases (clarification, out-of-scope, discovery). Empty = the
  judge runs on the assistant's own configured model.

---

## 1. Choose the model

Settings → LLM. Three providers:

- **OpenAI** — model name + API key.
- **LenAI (Halo gateway)** — deployment name + base URL + API key.
- **Databricks (Model Serving)** — *Serving endpoint* (the endpoint name,
  e.g. `databricks-claude-sonnet-4-5`) + *Workspace URL*
  (`https://adb-…azuredatabricks.net`, no path) + *Personal access token*.
  Requests go to `<workspace>/serving-endpoints/chat/completions`,
  bearer-token only. **This provider has not been exercised against a live
  Databricks workspace** — the request-shaping is unit-tested but unverified
  end to end. Click **Test connection** before **Save connection**; the
  button is disabled until a test passes.

Reasoning effort is set alongside the model. An eval run can override effort
per arm (`effort-medium`, `effort-low`) without touching this setting.

**Comparing two models**: run the same suite(s) at the same repeat under each
model (Settings → LLM, change the model, re-run — nothing else). Then
History → Compare (or `npm run eval:diff`) the two logs: pass^k side by side,
and — once `logs/pricing.json` has both models priced — **$ per correct
answer**, which is what actually decides a production default, not raw
accuracy. A cheaper model that loses a category the assistant's users rely on
is not automatically the wrong choice, but it is a choice, not an accident.

---

## 2. Iteration 0 — the baseline everything else is measured against

**In the app:** Agents → assistant → **Evals** → **Loop run** →

- Suites: tick all three.
- Arms: `baseline` (production defaults, whatever Settings currently says).
  Add `bare` in the same loop to also see how the assistant does with no
  Knowledge/Metrics/verified-query context — the "day one, no customer setup
  yet" reading.
- Repeat: **3** (pass^3 — the option is literally labelled "repeat 3 — pass^3,
  the number we trust").
- Label: `iter0-<model>`, e.g. `iter0-gpt-5`.

Start. The panel shows a live estimated turn count (`cases × repeat × arms`)
before you commit — read it before running two arms on an expensive model;
see §6 for how that translates into tokens and dollars.

**CLI equivalent:**

```bash
cd backend
npm run eval:validate -- --suites all                       # free — do this first
npm run eval -- --suites all --repeat 3 --arms baseline,bare --label iter0-gpt-5
```

**What to read**, in Executions (in-app) or the printed tables (CLI):

1. The **pass^3 headline** — `12/19 (63%) · mean 71% · 2 flaky · 1 gap ·
   answered 19/19 · $0.42/correct`.
2. The **per-category table, worst first** — this is the diagnostic, not the
   total. The category is the failure class; each failure class points at
   one lever (table in §3).
3. **GAP must be 0.** A GAP is the harness admitting it could not measure a
   case — a broken reference query or a judge that errored twice — and it is
   a harness bug, not an engine finding. Report it and fix the case or the
   harness before trusting anything else in that run.
4. The **flaky list** — cases with `0 < passes < runs`. A case that passes
   twice in three is wrong once in three for the user who asks it; that is
   a finding about reliability, not a shrug.
5. Open every remaining failure once in the trace (Executions → click a
   case, or the downloaded Markdown report's `#### Executed steps`) and read
   its **failure label** (`no-sql`, `missing-default-filter`, `wrong-table`,
   `missing-join`, `id-not-name`, `wrong-aggregate`, `unit`, `format-only`,
   `wrong-filter`, `judge`, `tool-error`, `timeout`, `clarified`, `unknown`).
   The label is a heuristic, not a verdict — read the SQL and the answer
   before believing it.

**How the result-set check compares.** It replays the answer's final SQL
(then its earlier queries, flagged `viaSupportingQuery`) and compares rows
with the reference: extra columns are context and pass, a missing reference
value fails, and numbers agree when they round to the same value at the
fewer decimal places either one shows — so a reference that says
`ROUND(x, 1)` does not fail an answer that kept four decimals — as long as
the rounded figure keeps enough significant figures (`0.48` against
`0.4847` is a different answer, not the same one rounded; two integers
compare exactly). When a question has more than
one equally correct result shape — a figure in cents or dollars, a single
count or a breakdown that contains it — the case lists the others under
`expectedSqlAlternatives`; the check passes on any of them and the run log
records which one matched (`matchedReference`, 0 = `expectedSql`). Add an
alternative only for a shape the *question* allows, never to rescue an
answer that read the question differently.

Repeat with a second model (Settings → LLM → change it) at the same repeat
and arm, label `iter0-<model2>`, then History → Compare and read
`$ / correct answer` before picking the production default in step 1.

---

## 3. Change exactly one lever

Every lever in the engine ships **off** in production defaults until it is
measured and kept — `ENGINE_DEFAULTS` in
`backend/src/modules/engine/engine-options.ts` is today's engine, exactly, so
Iteration 0 measures the assistant as it actually behaves, not as it could
behave. An eval run selects an **arm** — a named bundle of lever overrides,
applied over whatever Settings → Engine levers currently holds — without a
code change or a rebuild.

| Arm | Lever(s) it flips | Step | Categories it should move |
| --- | --- | --- | --- |
| `baseline` | none — today's Settings, as configured | — | comparison arm |
| `legacy` | every lever off, ignoring Settings | — | comparison arm — the engine exactly as shipped |
| `bare` | `context: 'bare'` — drops Knowledge, Metrics, verified queries | L2 | should get *worse*: `value-vocabulary`, `metric-definition`, `default-filter`, `domain-semantics` — this arm exists to prove curated context is worth having, not to improve on it |
| `curated` | `context: 'curated'` (today's default) | L2 | comparison arm |
| `profiles` | column profiles + inline knowledge in `describe_entity` | L2 | `value-vocabulary`, `id-vs-name`, `domain-semantics`, `unit-confusion` |
| `ranked` | Knowledge/Metrics ranked by relevance instead of newest-first | L2 | `default-filter`, `metric-definition`, `domain-semantics` — matters most once a fixture has more snippets than the context budget |
| `lookup` | `lookup_values` / `lookup_knowledge` tools | L2 | `value-vocabulary`, `id-vs-name` |
| `context-full` | every L2 lever together | L2 | same as above, combined — the L2 ceiling |
| `errors` | descriptive tool errors (closest columns/tables/values) | L3 | `multi-step-join`, `quality-filter` — anywhere a wrong first attempt needs a better second one |
| `fixer-off` | SQL fixer off, descriptive errors on — the assistant (which knows the question) retries instead of the silent fixer | L3 | wherever a "split-brain" fixer might silently change intent — watch `default-filter`, `quality-filter` |
| `precheck` | zero-token parse/validate before execution | L3 | `default-filter`, `multi-step-join`, `metric-definition` — catches these before a turn is even spent |
| `guards` | extended result guards (constant-metric-any-value, id-only-projection, default-filter-missing) | L3 | `constant-column`, `id-vs-name`, `default-filter`, `ratio-trap` |
| `static-first` | static context first, dynamic (visuals, verified pairs) last | L3 | no category effect expected — a caching/cost check, and a side-effect detector on its own |
| `tools-full` | every L3 lever together | L3 | same as above, combined |
| `review` | answer review before the answer is shown, one corrective pass on a finding | L4 | `unit-confusion`, `domain-semantics`, `quality-filter`, `multi-step-join` |
| `careful-auto` | independent cross-check, on for risky categories or a guard/repair warning | L4 | `ratio-trap`, `metric-definition`, `multi-step-join`, `default-filter`, `unit-confusion` (`RISKY_CATEGORIES`) |
| `careful-on` | cross-check on every turn | L4 | same, broader and more expensive — compare against `careful-auto`, not just `baseline` |
| `no-prompt-rules` | every ablatable prompt rule group removed | L5 | whichever categories regress *are* the ones that rule group was protecting — this arm is a subtraction test, not an improvement one |
| `effort-medium` / `effort-low` | reasoning effort override | L1 | all categories — a cost/quality trade-off, not a targeted fix |
| `full` | every context + tool lever, `review`, `careful: 'auto'` | L2–L4 | the ceiling — what the engine can do with everything on |

`custom:{"sqlRepair":false,"careful":"auto"}` (CLI `--arm`) or the Evals tab's
"custom…" option builds an arm from any subset of levers directly, without
adding a name to the table above.

**The loop:**

1. **Cheap check first** — does the lever move the categories it targets?
   In the app, tick only that category's questions (the category filter) or
   type the category into the Loop run panel's filter, repeat 3, arms
   `baseline,<arm>`. CLI:
   `npm run eval -- --suite health-insurance --category ratio-trap --repeat 3 --arms baseline,guards`.
2. **Full check** — did anything else break? Run every suite **including
   World Cup**, even when the lever targets Health Insurance or Genomics —
   World Cup is the side-effect detector: a change that fixes claims
   questions and quietly breaks football questions is exactly the failure
   mode evals exist to catch.
   ```bash
   npm run eval -- --suites all --repeat 3 --arms baseline,<arm> --label <arm>-1
   ```
3. **Decide.** Keep the lever only when its target categories' pass^3
   improved **and** nothing regressed elsewhere in pass^3 (a flat total that
   trades one category for another is not an improvement). A person decides
   this — the tool reports the numbers, not the verdict.
4. **Flip the default.** Settings → Engine levers → toggle the lever → Save.
   From then on `baseline` means "with this lever on" for every future run.
5. **Record it.** History → open the "after" run → **Draft change-log entry**
   → fill lever / change / why → Copy or **Append to
   docs/evals/change-log.md** (only available from a checkout — it writes
   the file directly). CLI equivalent:
   ```bash
   npm run eval:diff -- <before.json> <after.json> \
     --draft "guards|extended result guards on|constant-column false passes in health-insurance"
   ```
   prints a `docs/evals/change-log.md` entry with the measured half (suite,
   before → after, side effects) filled in; the verdict is still yours to
   write.

A "reverted" entry is worth as much as a kept one — it stops the next person
trying the same thing. See `docs/evals/change-log.md` for the format and
`backend/eval/README.md` for how to write a new eval case (business
phrasing, difficulty, provenance, trap SQL, judge rubric shape) — those
rules do not belong in this runbook, since they apply whether or not you are
mid-loop.

---

## 4. Where the logs live

Every graded run — in-app or CLI, completed, failed or aborted — writes a
schema v2 record into a `logs/` folder, resolved in this order:

1. `EVAL_LOG_DIR` env var, if set.
2. The checkout's own `logs/` (this repo, committed — the engineering
   record).
3. `<APP_DATA_DIR>/logs` (the packaged app, which has no checkout).
4. `<cwd>/data/logs` (a standalone backend with neither).

**History** (Agents → assistant → Evals → History) reads from *every*
directory that exists and merges them, newest first — so an app started from
this checkout lists the CLI's runs alongside its own, and a packaged app
shows its own `<userData>/logs` runs. `eval:diff` and `--file`/`--suite`
lookups do the same search. See `logs/README.md` for the full schema, the
verdict-folding rules and `jq` recipes for the raw files.

---

## 5. Databricks SQL datasource (optional, untested)

The product runs on Databricks; every fixture above runs on Postgres. A
loader can copy the three fixture schemas into a Databricks catalog so the
suites can be validated against the dialect the product actually ships on —
**this path has not been run against a live workspace.**

```bash
cd backend
DATABRICKS_TOKEN=<pat> npm run fixtures:databricks -- \
  --dry-run --host https://<workspace>.cloud.databricks.com \
  --warehouse <warehouse-id> --catalog eval_fixtures
```

`--dry-run` never connects to Databricks — it prints the DDL and row counts
it *would* load, from the running Postgres fixture, so you can review before
spending anything. Drop `--dry-run` and add `--yes` to actually load (add
`--register` to also register a `databricks` datasource + one
`<name> (Databricks)` dataset per schema, the same way the UI would). The
loader also emits `docker/databricks/views-<schema>.sql` — best-effort
translated view DDL — for manual review; apply it by hand.

Then validate the reference SQL for that dialect before spending any tokens:

```bash
npm run eval:validate -- --suite world-cup --dialect databricks
```

`--dialect` picks `expectedSqlByDialect.databricks` where a case has one,
falling back to `expectedSql` (only the `control` cases currently carry a
Databricks override). In the Evals tab, pick the Databricks datasource and
its `<name> (Databricks)` datasets to run a suite against it the same way.

---

## 6. Cost

A pass^3 run over every suite is **cases × 3** turns, per arm — a loop with
two arms doubles that. Suites are growing toward the plan's target of at
least three cases per category per suite (see the case counts in
`backend/src/mastra/evals/suites/*.json` for the current total — they change
as suite growth continues). Measured tokens per turn
(`docs/plans/improvement-loop-engineering.md` §1.7): **≈10k** on
`gpt-4o-mini`-class models, **≈24k** on `gpt-5`-class models — multiply by
the turn count above for a rough token budget, then by your rate in
`logs/pricing.json` for dollars. That count is a floor, not an invoice: it
covers the turn's own agent run, not side passes (grounding guard,
tool-only synthesis, careful mode's cross-check, the answer-review pass) —
see `logs/README.md`.

Run cheap before broad:

- `npm run eval:validate` (free, zero model calls) before every paid run —
  a wrong reference produces confident false failures, and step 1 exists to
  catch that before it costs anything.
- A single category, repeat 1, before a full pass^3 — confirm the lever
  moves what you think it moves before paying for three attempts × every
  suite.
- `--only <case>` / the Evals tab's per-case selection when chasing one
  flaky case with `--repeat 5`, not a whole suite.

---

## Honest limits

- **Non-determinism.** One flip may be noise — that is what `repeat`/pass^k
  and the flaky count exist to surface, not to hide.
- **A wrong reference is worse than no reference.** It produces confident
  false failures, and you will change the engine to satisfy a bug.
  `eval:validate` is not optional, and it is free.
- **The judge can run on the same model as the agent** unless you pin it
  (§0). Treat its verdicts as a second opinion, not proof — especially when
  it passes something you doubt.
- **A GAP is the harness's fault, not the engine's.** It is excluded from
  every rate on purpose; do not read it as a pass, a fail, or "probably
  fine."
- **Costs are estimates; tokens are measured.** Dollars are token counts ×
  the rates in `logs/pricing.json`, which you maintain. Until a model has an
  entry there, every report says "not priced" rather than a guessed number.
