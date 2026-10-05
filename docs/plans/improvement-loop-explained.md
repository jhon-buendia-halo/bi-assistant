# The improvement loop, explained

*Plain-language companion to `improvement-loop-engineering.md` · 2026-09-23*

## The names used in this document

Everything below uses the names the app already uses. This table is the
only vocabulary you need.

| Name | What it is | Where you see it |
| --- | --- | --- |
| **Assistant** | The agent that answers a question in a session: plans, writes and runs the SQL, explains the result. | Any session chat |
| **Datasets** | The fixture databases we built to test against: *World Cup*, *Health Insurance*, *Genomics*. One Docker Postgres, one schema each, registered by `npm run fixtures:register`. | Datasets screen |
| **Suite** | A set of eval questions for one dataset: `world-cup` (10), `health-insurance` (20), `genomics` (20). | Agents → Evals → Questions, suite dropdown |
| **Eval question** | One question with a trusted SQL answer (or a rubric for behaviour questions) and the checks it is scored on. | Agents → Evals → Questions |
| **Category** | The kind of mistake a question is designed to catch: ratio-trap, value-vocabulary, default-filter, id-vs-name, … 16 in total. `control` marks the easy ones that must always pass. | Category filter and the per-category table |
| **Run** | One execution of a suite against the assistant, with a verdict per question. | Agents → Evals → Executions |
| **Checks** | The rules a question is scored on: result set matches the trusted SQL, text includes a name, a tool was or was not called, the judge rubric. | Trace panel of a run |
| **Knowledge** | User-written facts about a dataset: terms, instructions, default filters. Pushed into the assistant's context. | Knowledge screen |
| **Metrics** | Governed metric definitions (for example *Net paid*), also pushed into context. | Metrics screen |
| **Verified queries** | Question → SQL pairs saved when you thumbs-up an answer; similar ones are shown to the assistant. | Thumbs-up on an answer |
| **Careful mode** | A second, independent SQL derivation compared against the answer's result. | Careful switch in a session |
| **SQL fixer** | The auto-repair that rewrites a failed SQL statement and re-runs it. | Invisible; the answer cites the corrected SQL |
| **Answer review** *(planned)* | A short check of the final answer against the question, SQL and results before it is shown. | Would appear as a chip on the answer, like careful mode |
| **Result guards** | Warnings attached to a query result: ratio of a number by itself, constant column, unranked top-N, row cap reached. | Invisible; the assistant is told to act on them |
| **Settings → LLM** | Which model the assistant runs on and the reasoning effort. | Settings |
| **Run log** | `logs/evals/` — one JSON per run with verdicts and token counts, plus `docs/evals/change-log.md` for why something was changed. | Repo |

## The idea

We ask the assistant the eval questions of a suite, against the dataset the
suite belongs to, and mark each answer against the trusted SQL. Then we
change one thing about how the assistant works — its model, its context, a
tool, a prompt rule — run the same suite again, and keep the change only if
the marks went up and nothing else went down.

Everything below is about making the marking fair first, then making the
assistant better, in that order.

## What we already have

More than it may feel like:

- **Three datasets, not two.** World Cup was written by hand. Health
  Insurance and Genomics are generated from a fixed seed, so the data never
  changes under us, and both have deliberate traps planted: a `currency`
  column that is always USD, two specialties tied on exactly 48 claims,
  money stored in cents, a `0/0` genotype that looks like a carrier but is
  not.
- **Fifty eval questions across three suites**, each tagged with a category.
  Forty have a trusted SQL answer; ten test behaviour, like asking for
  clarification when "best team" is undefined, or refusing to invent 2019
  payouts when the data covers only 2024 and 2025.
- **Three ways to run them**: `npm run eval:validate` (checks the trusted
  SQL still works, costs nothing), `npm run eval` (command line), and the
  Evals tab, with a per-category table, a comparison against the previous
  run and a downloadable report with the full trace.
- **A run log** with token counts for every paid run, and a change log.
- **An assistant that is already more than one model call**: the SQL fixer,
  careful mode's independent second derivation, the result guards, and
  Knowledge, Metrics and verified queries feeding its context.

## What the runs say today

| Model (Settings → LLM) | Health Insurance | Genomics | World Cup |
| --- | --- | --- | --- |
| gpt-4o-mini | 2–3 of 20 | 2 of 20 | 0 of 10 |
| gpt-5 | 11 of 20 | not run yet | not run yet |

Two things stand out before any conclusion about the assistant:

1. **Nine health-insurance questions fail with every model, in every run.**
   When gpt-5 and gpt-4o-mini fail the same question the same way, the first
   thing to check is the checks, not the assistant.
2. **Three questions flip between two identical runs.** Same model, same
   suite, same dataset, same day: pass, then fail. One run tells us little.

## Why we do not trust the verdicts yet

We read the checks and the harness code. The main problems:

- **The Evals tab does not run the assistant the way a session does.** In a
  session the assistant receives the Metrics block, the verified queries and
  the configured reasoning effort before every question, and its answer goes
  through the grounding guard. In an eval run it receives only the entity
  list and Knowledge. The two questions about *net paid* can only be answered
  with the `Net paid` metric, so they fail by design.
- **Some checks punish right answers.** Three discovery questions require the
  assistant to call `list_entities`, but the entity list is already in its
  context, so a sensible assistant never calls it. Every question has a
  `noToolErrors` check, so one exploratory query that errored fails the
  question even when the assistant noticed, fixed it and answered correctly.
  Several `includes` and `matches` checks look for a number written one
  particular way, so "$588.6K" fails where "58,862,147 cents" passes. One
  `matches "PAID"` is case-sensitive.
- **One trusted answer is an opinion.** `denial-rate` is marked against a
  definition that excludes pending claims. Nothing in Knowledge or Metrics
  tells the assistant to do that. Both models fail it.
- **The run log cannot explain a failure.** It records the verdict and the
  name of the first failed check. Not the SQL, not the answer. To find out
  why `paid-by-country` failed, you open Executions and read the trace by
  hand.

None of this means the assistant is good. It means we cannot yet say how good
it is. Fixing the checks is the first job.

## Your plan, reviewed

**1. More synthetic databases.** Right idea, wrong moment. With the assistant
failing most of the current fifty questions, a fourth dataset adds cost but
no new information: every category already has a question that fails. Add a
new dataset when the current suites stop telling us anything, and make that
one *ugly on purpose* (cryptic column names, no declared foreign keys, dates
stored as numbers, big tables that hit the row cap), because that is what
real warehouses look like and what our clean fixtures cannot test. A
Databricks-dialect dataset matters too, since the product runs on Databricks
and every eval today runs on Postgres.

**2. Eval questions with answers, and one metric.** Yes. This is the core,
and the metric should be the one the field uses and the harness already
implements: *did the SQL the assistant ran return the same rows as the
trusted SQL?* We add one twist: a question only counts as passed when it
passes **three times out of three**. A question that passes once in three is
luck, not ability. That is the single number we will watch, per suite and per
category. Tokens per question is tracked as a cost next to it, not as a
score.

Two rules for writing questions: write them the way a business user would,
never using a column name; and write at least three per category per suite,
because one question per category cannot tell a pattern from a coin flip.
Rephrasing an existing question is free (same trusted SQL) and tells us how
sensitive the assistant is to wording.

**3. The loop and specialised agents.** The order you had is right: fix the
checks, then the model, then the tools, then the prompt, and repeat before
believing. On "specialised agents": most of the wish list maps onto things
the app already has, and only one item is genuinely a new agent.

| Wish | What it is in this app | Status |
| --- | --- | --- |
| Retry when SQL fails | The SQL fixer | Exists. Needs a check that the repair did not change the question. |
| Understand relationships | Join hints in the assistant's context, from declared keys and naming | Exists. Needs to reach the Evals tab and to say one-to-many. |
| Know what a column means and which values it holds | Sample values on the dataset snapshot, shown by `describe_entity` | Partial. Needs counts: distinct values, blanks, constant, top values. |
| Use Knowledge properly | The Knowledge and Metrics blocks | Exists, but everything is pasted in newest-first until a size cap, and the assistant cannot look anything up. Needs ranking and a lookup tool. |
| Sampling | `sample_rows` | Exists. |
| Filtering | Knowledge `default_filter` entries | Exists. Needs a guard that checks the SQL applied them. |
| Independent verification | Careful mode | Exists. Should switch on automatically for risky categories. |
| Question analysis and schema linking | **Nothing yet** | The one new agent worth adding: read the question against all of the above and decide tables, columns, values, definitions, and whether to ask. |

Every extra model call costs time, tokens and adds randomness. So: build the
counting first, then the one linking stage, and measure each on its own.

## What others have found (research, September 2026)

We looked at recent papers, vendor docs and talks so the plan is not built on
instinct. The short version:

- **Trusted answers are often wrong.** Two 2026 audits found half or more of
  the reference answers in the big public text-to-SQL benchmarks to be
  incorrect. Our hand-checked `expectedSql` is worth protecting, which is why
  `eval:validate` runs before every paid run.
- **One run proves nothing.** Studies of agent evaluations show the same
  system scoring several points apart on identical runs, even with randomness
  turned down. Three-out-of-three is the field's answer, not our invention.
- **Business context beats model choice.** In several 2026 measurements, a
  short written description of the business (what "net paid" means, how
  tables join, which rows to exclude, what units are used) lifted accuracy by
  17 to 23 points; switching between models of the same class did far less.
  In this app that description is Knowledge plus Metrics. Databricks' own
  guidance for Genie follows the same order: names and values first, example
  queries second, domain instructions third.
- **Distinct values beat sample rows.** Showing the assistant the list of
  possible values in a column helps more than showing it a few example rows.
- **Guided exploration beats free exploration.** Agents that can inspect the
  data do well on messy schemas but wander without guidance; putting hints
  directly in tool results cut wasted steps several-fold. Our result guards
  already work this way for errors.
- **The top of the leaderboards is expensive.** The best public systems
  generate many candidate queries, run them all and hold a tournament to pick
  one. That buys a few points at high cost. Careful mode with three to five
  candidates, only for risky categories, is the affordable slice.
- **Frameworks agree.** Mastra, the agent framework we use, now recommends a
  supervisor agent that calls sub-agents and tools over its older "agent
  network" idea, which is the shape our assistant already has.

Sources and numbers are in section 9 of the technical document.

## What the Omni talk adds (Code with Claude, London, May 2026)

Chris Merrick, CTO of Omni, described how their analytics agent Blobby grew
from a one-shot answer box into a production harness on Claude. Almost every
lesson maps onto a component we already have. In our vocabulary:

- **Tell it about the business, next to the thing it describes.** Omni's
  biggest lever was metadata on the semantic model: a label, a description,
  an "AI context" note on how to use a field, sample queries, and a taste of
  the field's values. He stressed that context works best *placed beside the
  definition it refers to*, like a `CLAUDE.md` next to the code. For us that
  means a Knowledge entry about a column should also appear inside
  `describe_entity`, right next to that column, not only in the separate
  Knowledge block.
- **Show it the values.** Seeing `AMER, EMEA, APAC` lets the assistant map
  "United States" to `US`, typos included. We keep five sample values per
  column today; the plan adds value counts and a lookup tool that matches a
  user's phrase to the real values before the query runs.
- **Great error messages plus a budget to retry was their first big jump.**
  "That alone allowed the quality score to increase dramatically." Our SQL
  fixer does the retry for the assistant, silently, and it never sees the
  question. The plan now tests the Omni way first: descriptive errors ("no
  column `approved`; closest are `status`, `adjudicated_on`") returned to the
  assistant, fixer switched off, and the assistant retries with the question
  in mind. The fixer stays only if it wins.
- **Don't split the brain.** Omni's early design had an outer agent planning
  and a sub-agent writing one query at a time. The outer agent kept asking
  for things one query could not do, and sessions looked random until the
  traces showed why. They merged the two. This is a direct warning for the
  "specialised agents" idea: keep the assistant as the one brain that owns
  the tools; anything extra is a briefing it reads or a check that runs after,
  never a second decision-maker.
- **Let it write SQL, then check the SQL.** Omni replaced a structured query
  format with plain SQL that Claude already knows, parsed and validated
  afterwards, and hard questions went from three or four attempts to one. For
  us: keep `run_readonly_sql` as the interface and add a free check that
  parses the SQL before it runs, confirming tables and columns exist, joins
  use known keys, default filters are applied and metric formulas match the
  Metrics screen.
- **Small chat models are not built for agentic loops.** They moved from
  Haiku to Sonnet once conversations became multi-step. This matches our own
  gpt-4o-mini versus gpt-5 numbers and the model decision in step 2.
- **Traces are the point of evals.** His favourite part of their eval system
  is the raw trace: "this was bad, why?" The judge is an efficiency gain on
  top. Our run log stores no trace today; step 1 fixes that.
- **Validate before answering, by default.** Blobby has validation tools on
  in production. Omni's benchmark ran every question twice and reported
  accuracy by difficulty, consistency across runs, whether an answer came
  back every time, speed, and cost per *correct* answer. The plan adds an
  answer review that runs by default, a difficulty tag per eval question,
  and cost per correct answer in Executions.

## The plan in five steps

1. **Make the checks honest** (week 1). Run eval questions through the same
   code path a session uses, so the Evals tab sees Metrics, verified queries,
   the reasoning effort and the grounding guard. Drop `calledTool
   list_entities` from the discovery questions, make `noToolErrors` apply only
   to `control` questions, and delete the number-formatting `includes` and
   `matches` checks where the result-set check already covers the number.
   Record the SQL and the answer in the run log. Add "repeat three times" to
   the Evals tab. Then re-run all three suites with gpt-4o-mini and gpt-5.
   Every remaining failure gets read once in Executions and labelled:
   assistant, trusted SQL, or harness.
2. **Choose the model** (week 2). gpt-5 already scores four times higher on
   Health Insurance with no regressions. Decide the production default in
   Settings → LLM and the reasoning effort, and measure a mid-priced model for
   the cost curve using the token counts in the run log.
3. **Give the assistant better context** (weeks 2–4). Column profiles and
   value lists computed when a dataset is saved and shown by
   `describe_entity`; Knowledge entries about a column shown right beside
   that column; a `lookup_values` tool that matches a phrase to real values;
   a full Knowledge and Metrics set per dataset, seeded by
   `fixtures:register`; Knowledge and Metrics ranked by relevance to the
   question instead of newest-first; a `lookup_knowledge` tool. From then on
   every suite is run twice, once with Knowledge and Metrics and once without,
   because a new customer starts without them. This is where the research
   and the Omni talk both say the biggest gains are.
4. **Fix the tools that create wrong answers** (week 4). Descriptive error
   messages first, then a run with the SQL fixer switched off to see whether
   the assistant recovers better on its own; a free check that parses each
   query before it runs (tables and columns exist, joins use known keys,
   default filters applied, metric formulas match); result guards that catch
   an answer keyed by ids instead of names; if the fixer stays, it repairs
   only syntax and names and warns when a repair changed the question.
5. **Add the answer review and automatic careful mode** (week 5): a short
   check of the final answer against the question, the SQL and the results,
   on by default, catching unsupported claims, wrong date filters, a
   truncated result treated as complete, arithmetic done in prose. A
   question-briefing step comes only if step 3 still leaves table-choice
   failures, and then as something the assistant reads, never a second
   decision-maker. Then prompt rules only for what is left, one at a time,
   including removing rules the model no longer needs. Grow the suites the
   whole time toward three questions per category plus rephrasings, and add
   the messy dataset once the clean suites pass.

Each step ends with an entry in `docs/evals/change-log.md`: what changed,
why, and the per-category verdicts before and after, so nobody has to guess
later why the assistant works the way it does.

## How we will know it worked

- A published "before" run per suite (week 1) and a change-log entry for
  every change after it.
- `control` questions at 100 %, three times out of three, on every suite.
- Overall at or above 80 % three-out-of-three on the production model, with
  no category at zero.
- Tokens and, once `logs/pricing.json` is filled, cost per *correct* answer
  written next to every result in Executions, plus how often the assistant
  returned an answer at all.

## Decisions needed from you

- Which model in Settings → LLM is the production default we optimise for,
  and roughly what a full three-repeat run of the three suites may cost per
  week.
- Whether a Databricks-dialect dataset is in scope this quarter.
- Whether the eval judge (the model that grades behaviour questions against
  their rubric) may be pinned to one model that differs from the production
  model. Recommended, so changing the assistant's model does not move the
  ruler.
