# Roadmap

Pre-implementation plan for all work. Hierarchy: **Release → Milestone → Feature** (`R`, `R.M`, `R.M.F`). See *Planning convention* in the `workflow-start` skill. Each milestone is an epic, with its spec in [specs/epics/](specs/README.md); since 2026-11-11 a new milestone's heading ends in its epic ID `(M<R>-<M>)`.

Finished milestones (every feature `✅ Done` or `🚫 Cut`, other than the active epic) are moved verbatim to [roadmap-archive.md](roadmap-archive.md) by `node scripts/roadmap-archive.mjs`; their heading stays here with the suffix `— archived, see roadmap-archive.md`. Look a story up in both files.

Status legend: `📋 Planned` · `🚧 In progress` · `✅ Done` · `🚫 Cut`

Feature template:

```
#### R.M.F — <Feature name>  `📋 Planned`
- **Intent:** why this exists / the user-observable outcome.
- **Scope:** what is in.
- **Out of scope:** what is explicitly not.
- **Acceptance:** verifiable criteria (map to Gherkin scenarios in the capability specs under specs/capabilities/).
- **Notes:** links (docs/plans, ADRs, evidence), dependencies.
```

---

<!-- Releases go here. Promote Backlog items into a milestone before starting work. -->

## Release 0 — Maintenance

Correctness fixes to the shipped app that don't belong to a product phase.

### Milestone 0.1 — Desktop runtime correctness — archived, see roadmap-archive.md

### Milestone 0.2 — Delivery process ([BA-89](https://halo-powered.atlassian.net/browse/BA-89)) — archived, see roadmap-archive.md

### Milestone 0.3 — Local Development Observability ([BA-111](https://halo-powered.atlassian.net/browse/BA-111)) — archived, see roadmap-archive.md

### Milestone 0.4 — Harness Adjustments ([BA-119](https://halo-powered.atlassian.net/browse/BA-119)) — archived, see roadmap-archive.md

### Milestone 0.5 — Faster workflow, repo-only planning (M0-5) — archived, see roadmap-archive.md

### Milestone 0.6 — Workflow modes: Strict and Free style (M0-6)

Two workflows instead of one: the current eleven-step workflow becomes **Strict**, and a new **Free style** runs only understand, clarify, implement and checks, with every other step optional. At the start of a new session Claude asks which one to follow and remembers the answer for the workspace. `CLAUDE.md` becomes a short router that holds only the rules both workflows share. No app behaviour changes. Epic spec: [specs/epics/M0-6/spec.md](specs/epics/M0-6/spec.md). Requested by the user on 2026-11-12.

#### 0.6.1 — Workflow choice at session start  `✅ Done`

- **Intent:** the user picks the workflow for each new session, once, and Claude keeps to it.
- **Scope:** `CLAUDE.md` rewritten as a router: what the app is, the mandatory first action, *Choose the workflow* (a picker with Strict and Free style; the answer saved in `.context/workflow-mode`; a later session or a resumed one confirms it in one line instead of asking; "switch to strict/free style" changes it mid-session), the rules both workflows share (never on `main`, specs change with the code, ports and Postgres from a worktree, bootstrap, read and output rules), and the model routing table. History lines (Jira dates, usage figures) leave `CLAUDE.md`.
- **Out of scope:** changing what either workflow's steps do.
- **Acceptance:** `CLAUDE.md` is under 60 lines, names both workflow skills and `.context/workflow-mode`, and repeats no rule that lives in `lessons.md` or a skill; `check-specs.py` passes.

#### 0.6.2 — Strict workflow skill  `✅ Done`

- **Intent:** the current workflow keeps working unchanged, loaded only when the user picks it.
- **Scope:** a new project skill `workflow-strict` holding the `## Workflow` section moved from `CLAUDE.md` (the eleven steps, change sizes, decide-before-build, story lane, wave check, acceptance gate, the Epic gate); `workflow-start`, `workflow-implement`, `workflow-gate` and `verify` point at it instead of `CLAUDE.md`; switching from Free style to Strict mid-epic adds the roadmap story for the work already done.
- **Out of scope:** editing the step skills' conventions.
- **Acceptance:** every step line keeps the `<n>. **<title>** — <description>` form; no skill says the workflow is defined in `CLAUDE.md`.

#### 0.6.3 — Free style workflow skill  `✅ Done`

- **Intent:** a quick path for work that doesn't need the full process.
- **Scope:** a new project skill `workflow-free-style`: 1 Understand the goal, 2 Clarify, 3 Implement changes, 4 Run checks and fix until green (`node scripts/qa.mjs --free`, and an agent's evals when its input changed); the other strict steps (roadmap, ADR, E2E impact and specs, evidence, changelog, retrospective) are optional. Kept from the shared rules: a new branch, never `main`, Conventional Commits, and spec lines the change makes false are updated.
- **Out of scope:** builder or reviewer agents in Free style.
- **Acceptance:** the skill lists the four steps, names the optional ones, and says how to switch to Strict.

#### 0.6.4 — QA checks without a story (`qa.mjs --free`)  `✅ Done`

- **Intent:** Free style's step 4 runs the same checks as the gate without a roadmap id.
- **Scope:** `node scripts/qa.mjs --free [--base <ref>] [--rebuild] [--dry-run]`: the build, the full unit suites, backend lint and check-specs in parallel, then the Playwright specs the `--fast` selection picks (changed specs and `--only-changed` against the base); reports in `.qa-reports/free/`; writes nothing under `evidence/` and records no demo.
- **Out of scope:** changing `--fast`, `--gate` or `--wave`.
- **Acceptance:** `parseArgs(['--free'])` returns mode `free` with no id; an id with `--free` is a usage error; `--free --dry-run` prints the plan; `node --test scripts/qa-lib.test.mjs` passes.

#### 0.6.5 — Workflow pane reads the strict skill  `✅ Done`

- **Intent:** the `workflow-steps` mod keeps showing the real eleven steps after they leave `CLAUDE.md`.
- **Scope:** the mod reads the `## Workflow` section from `.claude/skills/workflow-strict/SKILL.md`, then from `CLAUDE.md`, then falls back to its built-in copy; the mandatory first action is still read from `CLAUDE.md`; the pane says which file it read.
- **Acceptance:** `claude plugin test` in the mod passes with a test for each source.

## Release 1 — 1.0 Beta  (target 2026-10-31)

Source of truth for scope and dates: Jira project **BA**, version *1.0 Beta* ([timeline](https://halo-powered.atlassian.net/jira/software/projects/BA/boards/2688/timeline)). Each milestone mirrors one Jira epic and each feature mirrors one story, so IDs map 1:1. Imported 2026-10-01. Status changes are made in both places.

Timeline (from the Jira timeline):

| Milestone | Epic | Window |
|---|---|---|
| 1.1 Golden Dataset and Evals | [BA-9](https://halo-powered.atlassian.net/browse/BA-9) | Oct 1 – Oct 31 (runs throughout) |
| 1.2 Data Model DSL | [BA-2](https://halo-powered.atlassian.net/browse/BA-2) | Sep 30 – Oct 16 |
| 1.3 Knowledge Store | [BA-4](https://halo-powered.atlassian.net/browse/BA-4) | Sep 30 – Oct 16 |
| 1.4 Response Reliability Signals | [BA-12](https://halo-powered.atlassian.net/browse/BA-12) | Sep 30 – Oct 16 |
| 1.5 Data Connectors | [BA-5](https://halo-powered.atlassian.net/browse/BA-5) | Sep 30 – Oct 23 |
| 1.6 User Testing | [BA-10](https://halo-powered.atlassian.net/browse/BA-10) | Oct 19 – Oct 23 |
| 1.7 Bug Fixes | [BA-11](https://halo-powered.atlassian.net/browse/BA-11) | Oct 26 – Oct 30 |
| 1.8 Agentic Hub Look and Feel | [BA-141](https://halo-powered.atlassian.net/browse/BA-141) | No dates in Jira yet |
| 1.9 Agent Hub | [BA-150](https://halo-powered.atlassian.net/browse/BA-150) | No dates in Jira yet; due with the beta |

Evals come first in the order even though they run in parallel: every other milestone is measured against them.

### Milestone 1.1 — Golden Dataset and Evals ([BA-9](https://halo-powered.atlassian.net/browse/BA-9))

The measurement baseline. Every change to the DSL, knowledge store or connectors is measured against it before the beta ships. Epic spec: [specs/epics/BA-9/spec.md](specs/epics/BA-9/spec.md). Research: [docs/research/BA-9.md](docs/research/BA-9.md). Plan: [docs/plans/BA-9.md](docs/plans/BA-9.md), whose section 3.0 holds the calendar, the open decisions and the minimum by the beta. Features 1.1.4 onward mirror the plan's steps. Their 15 Jira stories were compacted to 5 on 2026-10-13 at the user's request, so here several features share one story: 1.1.4-1.1.7 → [BA-182](https://halo-powered.atlassian.net/browse/BA-182) (Done), 1.1.8-1.1.9 → [BA-186](https://halo-powered.atlassian.net/browse/BA-186) (In Progress), 1.1.10-1.1.11 → [BA-188](https://halo-powered.atlassian.net/browse/BA-188), 1.1.12-1.1.14 → [BA-190](https://halo-powered.atlassian.net/browse/BA-190), 1.1.15-1.1.18 → [BA-193](https://halo-powered.atlassian.net/browse/BA-193). The ten merged issues are closed as duplicates and out of the epic; the features keep their own evidence folders. 1.1.19 → [BA-212](https://halo-powered.atlassian.net/browse/BA-212) (Done), the Intellify sample, shipped on `main` in PR #77 as 1.1.2 and renumbered when `main` was merged in.

#### 1.1.1 — Golden dataset and eval suite  `🚫 Cut`
- **Reason:** split into 1.1.2–1.1.18, one feature per story, by the execution plan (BA-128). Its intent, scope and acceptance carry over into the epic spec.

#### 1.1.2 — Research ([BA-127](https://halo-powered.atlassian.net/browse/BA-127))  `✅ Done`
- **Intent:** the team agrees on what to measure and why before anything is built: findings, options and a recommendation for the golden dataset and the eval suite.
- **Scope:** [docs/research/BA-9.md](docs/research/BA-9.md), converted from the "Golden Dataset and Evals Plan" artifact (version 7, 2026-10-12): the book's method (Chip Huyen, *AI Engineering*, chapter 4) and how the market evaluates text-to-SQL and agents; what exists on `main` and only on branches; the criteria list, the categories, what Databricks and REST need; worked examples; the verdict on evals on the user's own data. Every "exists on main" claim re-checked against the branch base.
- **Out of scope:** the execution plan (1.1.3); any code.
- **Acceptance:** the research doc is in the repo with every source listed by type; the baseline on `main` (the World Cup set on PostgreSQL and on REST, three runs each, from the Evals tab) is in its evidence folder and summarised in the doc; `python3 scripts/check-specs.py` passes.
- **Notes:** the baseline was taken on 2026-10-13 by Claude with the team's OpenAI key (app default `gpt-4o-mini`): PostgreSQL 1, 0 and 0 of 10, REST 0 of 10 three times; why, in the research's "Baseline on main". Evidence: [evidence/1.1.2/](evidence/1.1.2/).

#### 1.1.3 — Execution plan ([BA-128](https://halo-powered.atlassian.net/browse/BA-128))  `✅ Done`
- **Intent:** no implementation story starts before the scope, the order and the stories are agreed.
- **Scope:** [docs/plans/BA-9.md](docs/plans/BA-9.md) (the plan's Part 3 and Part 4.1–4.6, a story map, the have / need table); the epic spec rewritten to this scope; ADR-0015 in [architecture.md](specs/system/architecture.md); features 1.1.4–1.1.18; one Jira story per feature under BA-9.
- **Out of scope:** any code; the decisions themselves, which the plan records with their dates.
- **Acceptance:** the epic spec says Confirmed; the stories exist in Jira and their keys are on 1.1.4–1.1.18; `python3 scripts/check-specs.py` passes.
- **Notes:** drafted on 2026-10-12 next to the research; the epic spec confirmed and the stories BA-182 to BA-196 created on 2026-10-13. The user chose to close it before 1.1.2's baseline exists, so the build starts while the baseline runs. Evidence: [evidence/1.1.3/](evidence/1.1.3/).

#### 1.1.4 — One format and a validator (Step 1a) ([BA-182](https://halo-powered.atlassian.net/browse/BA-182))  `✅ Done`
- **Intent:** one place and one format to add a question, and wrong reference queries found in seconds without a model call.
- **Scope:** one data file per set under `backend/src/mastra/evals/sets/` in the case format of ADR-0015; a loader that refuses an incomplete case; the 31 existing questions moved over with no change in behaviour; `npm run eval:validate`; a set option on `npm run evals:assistant`; `npm run eval` and `backend/eval/` removed.
- **Out of scope:** new questions (1.1.10); retiring `check-answers.ts` (1.1.11).
- **Acceptance:** the validator passes on the PostgreSQL and REST fixtures and fails on a reference broken on purpose; a run gives the same verdicts as the baseline, within its run-to-run variation.
- **Notes:** 1 to 1.5 days. Needs 1.1.3 and the decision on how branch work comes over (plan 3.0). Jira: [BA-182](https://halo-powered.atlassian.net/browse/BA-182). Shipped 2026-10-13 with a new set, World Cup (golden set), which holds the golden-set and answer-quality questions; the World Cup sample now requires `disciplinary_events`. Evidence: [evidence/1.1.4/](evidence/1.1.4/).

#### 1.1.5 — Deterministic checks (Step 1b) ([BA-182](https://halo-powered.atlassian.net/browse/BA-182); was BA-183)  `✅ Done`
- **Intent:** a failed question names the rule that broke, at no token cost.
- **Scope:** twelve checks built with `createScorer`, one file each, each tagged with a criterion of the research's criteria list (2.5): `noRepairs`, `namesNotIds`, `numbersGrounded`, `rationaleOk`, `noHtml`, `dialect`, `qualifiedNames`, `optionCount`, `visualKeywords`, `sqlMatches`, `notMatches`, `usesEntities`; attached to every moved question.
- **Out of scope:** the report by category (1.1.6).
- **Acceptance:** each check has a unit test; one PostgreSQL run scores every check.
- **Notes:** 1 to 1.5 days. Needs 1.1.4. Jira: [BA-182](https://halo-powered.atlassian.net/browse/BA-182) (was BA-183, merged on 2026-10-13). Shipped 2026-10-13: twelve checks, the R31 fix for a result truncated at the model's own limit, and the validator's dataset-entity rule. Evidence: [evidence/1.1.5/](evidence/1.1.5/).

#### 1.1.6 — Report by category, judge optional (Step 1c) ([BA-182](https://halo-powered.atlassian.net/browse/BA-182); was BA-184)  `✅ Done`
- **Intent:** see which kind of question got worse, and stop paying for the judge on every run.
- **Scope:** a category chip per question on the Evals tab; a pass rate per category and per criterion on every finished run; a run option `judge: off | categories | on`, off by default, with judge checks shown as "not scored" when it is off.
- **Out of scope:** repeats and intervals (1.1.11); judge validation (1.1.12).
- **Acceptance:** the spec check and the E2E scenarios pass; one real PostgreSQL run has the table in its report and spent no judge tokens.
- **Notes:** 1 to 1.5 days. Needs 1.1.5. Jira: [BA-182](https://halo-powered.atlassian.net/browse/BA-182) (was BA-184, merged on 2026-10-13). Shipped 2026-10-13: judge off by default, statuses passed / failed / not scored, and the by-category and by-criterion summary in Executions and the report. Evidence: [evidence/1.1.6/](evidence/1.1.6/).

#### 1.1.7 — Domain databases: finance and marketing analytics, plus the branch's domains (Step 1d) ([BA-182](https://halo-powered.atlassian.net/browse/BA-182); was BA-185)  `✅ Done`
- **Intent:** test the assistant on data the model never saw, shaped like a customer's, with traps planted on purpose; two of the domains run on every datasource kind (decided 2026-10-13).
- **Scope:** finance (the branch's banking generator extended to finance and wealth) and marketing analytics (new, the marketing-insight product), each with a brief, a seeded generator, `facts.json`, a policy document and a starter bank of at least 30 questions; a dump script exporting each fixture to JSON for Steps 2 and 3; health insurance (42 questions), genomics (49) and supply chain (20) copied by path from `feat/engine-eval-loop` as they are; every question in the new format, tagged dev or held-out.
- **Out of scope:** HR and retail, which carry expert-mode and learning fields; growing the banks past the starter size (1.1.10); health insurance on Databricks (after the beta).
- **Acceptance:** the five domains load on the compose PostgreSQL and pass the validator; finance and marketing analytics have at least 30 questions each and a baseline run; each dump matches its PostgreSQL row counts.
- **Notes:** 5 to 6 days, Oct 19 to 23, in parallel with 1.1.5 and 1.1.6; part of the minimum by the beta since 2026-10-13. Needs 1.1.4. Claude writes the briefs, data and questions, all synthetic, with no business review (decided 2026-10-13). Decision record: `evidence/1.1.3/decisions.md`. Jira: [BA-182](https://halo-powered.atlassian.net/browse/BA-182) (was BA-185, merged on 2026-10-13). Shipped 2026-10-13: finance 68, marketing analytics 50, health insurance 42, genomics 49, supply chain 20 questions, every reference run on its data. Evidence: [evidence/1.1.7/](evidence/1.1.7/).

#### 1.1.8 — Databricks fixtures and sets (Step 2) ([BA-186](https://halo-powered.atlassian.net/browse/BA-186))  `🚧 In progress`
- **Intent:** the manager's first ask. Databricks has no eval today; the same questions on the same rows show a Databricks problem as a Databricks problem.
- **Scope:** `setup-fixture-databricks.ts` loading any fixture's JSON dump into `<catalog>.<schema>`: World Cup, finance and marketing analytics; a register-only Databricks fixture per family that the preflight accepts; a Databricks reference for every question of the three; ten Databricks-only questions; PostgreSQL and Databricks side by side in the report.
- **Out of scope:** Databricks in the nightly CI (cost); health insurance on Databricks (after the beta).
- **Acceptance:** here, the loader, the three fixtures and every Databricks reference are written and unit-tested, and the validator can run them against a configured warehouse. In the VDI, later (decided 2026-10-13): a full run of each family completes on a real warehouse from the Evals tab and from the CLI, with the report and a screenshot in evidence; one cold-start and one warm run recorded; a reference broken on purpose fails the validator on Databricks.
- **Notes:** 5 to 6 days (widened on 2026-10-13 to the two domains). Needs 1.1.4 to 1.1.6, 1.1.7 for the domains, and Databricks access (workspace, warehouse, token, catalog), asked on 2026-10-12. If access is late, 1.1.9 goes first. Jira: [BA-186](https://halo-powered.atlassian.net/browse/BA-186). Built 2026-10-13 without a warehouse (loader, fixtures, 126 Databricks references checked statically and through DuckDB, catalog rewrite R192); stays In progress until the VDI run (`docs/evals/databricks-vdi.md`). Evidence: [evidence/1.1.8/](evidence/1.1.8/).

#### 1.1.9 — REST connector cases (Step 3) ([BA-186](https://halo-powered.atlassian.net/browse/BA-186); was BA-187)  `🚧 In progress`
- **Intent:** the manager's second ask. Test what REST changes (paging, nesting, row caps, failures), not only the questions.
- **Scope:** switches on the local World Cup API, one per behaviour (page, offset and cursor paging; nested rows; rows under another key; a row cap; a refused endpoint; a required token); one datasource per variant; the same server serving the finance and marketing-analytics dumps, one REST datasource each; SQLite references for every question of the three families; twelve REST-only questions; a report per variant and per family.
- **Out of scope:** fixing the connector bugs found (filed under BA-11).
- **Acceptance:** each variant has a run; finance and marketing analytics each have a run on REST; every failing connector case has a bug under BA-11; the DIGS and RSS endpoints are checked against the switch list in writing.
- **Notes:** 4 to 5 days (widened on 2026-10-13 to the two domains). Needs 1.1.4 to 1.1.6, and 1.1.7 for the domains. Jira: [BA-186](https://halo-powered.atlassian.net/browse/BA-186) (was BA-187, merged on 2026-10-13). Built 2026-10-13 (switches, setup fix for the 401, SQLite references for 117 questions, the 12-question connector set, real runs); stays In progress until the DIGS and RSS endpoints are checked. The seven connector repros were filed on 2026-10-27 as five bugs under BA-11 ([BA-246](https://halo-powered.atlassian.net/browse/BA-246) to [BA-249](https://halo-powered.atlassian.net/browse/BA-249), plus [BA-250](https://halo-powered.atlassian.net/browse/BA-250) for the datasource label the runs showed), fixed on the branch `fix/BA-11-bug-fixes` (roadmap 1.7.21 to 1.7.25). Evidence: [evidence/1.1.9/](evidence/1.1.9/).

#### 1.1.10 — More questions: domains and question banks (Step 4) ([BA-188](https://halo-powered.atlassian.net/browse/BA-188))  `🚧 In progress`
- **Intent:** enough questions to see a 10-point change (about 100 per fixture) instead of only a 30-point one.
- **Scope:** World Cup to 100 questions, finance to 100 and marketing analytics to 60, all on all three kinds (health insurance deepens after the beta, decided 2026-10-13); every category at five questions or more; every question tagged dev or held-out; deterministic substitutes on the judge-only questions.
- **Out of scope:** Formula 1 beyond its 10 questions until these are complete.
- **Acceptance:** the counts above with references run before commit; a bootstrap over each set spreads less than 5 points; dev and held-out within 5 points of each other at baseline.
- **Notes:** about two weeks, continuous; beyond the starter banks of 1.1.7, after the beta if time runs short. Needs 1.1.4 to 1.1.9. Jira: [BA-188](https://halo-powered.atlassian.net/browse/BA-188). Started 2026-10-16 with a first slice copied by path from `feat/engine-eval-loop` (the user's choice; the decision of 2026-10-13 in `evidence/1.1.3/decisions.md`): the World Cup set grows from 12 to 52 questions (23 of the branch's 24 World Cup questions the set lacked, plus one paraphrase of each of the 17 of them that had one; `finalists-groups-2022` needs `tournament_teams`, which the World Cup sample does not require, so it waits), with PostgreSQL, SQLite and Databricks references; and the Finance, Health Insurance, Genomics and Supply Chain samples ship a knowledge seed created when the sample is loaded (testing-data R26, R27), which closes the "no knowledge seed yet" gap of 1.1.7; the 2,000-character knowledge block (knowledge R17) sends only each seed's default filters, instructions and first terms, an open question for BA-4. World Cup stays unseeded, so the World Cup set the team gates assistant changes on sees the same context as before. On 2026-10-20 the World Cup golden set (`world-cup-golden.json`, 11 questions, three variants) was merged into the World Cup bank (the user's choice: one bank per sample, not a separate file for the same sample and kinds): its questions keep their ids, checks, references and `dev` split, gain no tag, and say where they came from in their note, so `world-cup`, `world-cup-rest` and `world-cup-databricks` hold 63 questions and the three golden-set sets are gone. Still to do in this feature: World Cup to 100, finance to 100, marketing analytics to 60, every category at five, the bootstrap spread.

#### 1.1.11 — Numbers you can trust (Step 5) ([BA-188](https://halo-powered.atlassian.net/browse/BA-188); was BA-189)  `🚧 In progress`
- **Intent:** tell a real change from noise, know what a run costs, and catch a regression the day it lands.
- **Scope:** tokens and cost per question (assistant and judge apart); seconds at P50 and P90; tool calls per question; a `repeats` option (1, 3 or 5) with pass^k, a flaky count and a Wilson interval per category; the beta thresholds in the spec; a nightly CI run on PostgreSQL with the judge off that fails on any regression; `check-answers.ts` retired.
- **Out of scope:** Databricks in the nightly run.
- **Acceptance:** a week of nightly runs in evidence; the threshold table in the spec and agreed.
- **Notes:** 3 to 4 days; the nightly part is in the minimum by the beta. Needs 1.1.4; 1.1.8 for the Databricks numbers. Jira: [BA-188](https://halo-powered.atlassian.net/browse/BA-188) (was BA-189, merged on 2026-10-13). The repeats, pass^k, Wilson intervals, the split and tokens and cost per question were built under 1.1.20 (BA-242). Started 2026-10-27: `check-answers.ts` and `npm run check:answers` retired (its questions are in the World Cup bank since 1.1.4 and 1.1.10, its checks are `check-names-not-ids` and the result-set match; its `CHECK_ARM` arms wait for 1.1.13). Still to do: seconds at P50 and P90, the beta thresholds (plan 3.9's proposal, checked against rounds 4 and 17, goes to the user first) and the nightly run.

#### 1.1.12 — Judge validation and human verdict (Step 6) ([BA-190](https://halo-powered.atlassian.net/browse/BA-190))  `📋 Planned`
- **Intent:** measure how often the judge agrees with a person before its verdict counts.
- **Scope:** a Pass / Fail control on a finished question in the Details panel; a 30-case validation set from those labels; a script that prints agreement on passes and fails separately; rubric version, judge model and temperature on every run; a weekly run with the judge on.
- **Out of scope:** making the judge the gate.
- **Acceptance:** agreement at least 90% on both passes and fails, or the rubrics rewritten until it is.
- **Notes:** 3 days, after the beta. Needs 1.1.10 and a labeller. Jira: [BA-190](https://halo-powered.atlassian.net/browse/BA-190).

#### 1.1.13 — Arms: knowledge on and off, model comparison (Step 7) ([BA-190](https://halo-powered.atlassian.net/browse/BA-190); was BA-191)  `🚧 In progress`
- **Intent:** prove whether a change helps by running the same questions with it and without it.
- **Scope:** an `arm` option on a run (knowledge on or off; a model override), stored on the run; a side-by-side report of two runs by category; the loop runner and `eval:diff --draft`. Added 2026-11-02 for BA-81's memory decision ([ADR-0050](specs/system/architecture.md)): a memory arm on a run (`arm.memory`: `none`, `mastra` or `hindsight-mastra`; `EVAL_MEMORY` on the command line; `Memory <arm>` on an execution), compared only with runs of the same arm. `mastra` runs only on a build that has BA-81's store, and `hindsight-mastra` is refused as not built ([agents-evals](specs/capabilities/agents-evals/spec.md) R231, R232).
- **Out of scope:** automating the improvement loop.
- **Acceptance:** 1.3.3's acceptance (knowledge on and off, no category gets worse) is answered by one report. The memory arm answers ADR-0050's rules 1 to 3: an A/A pair of `none` runs and of `mastra` runs on the memory set (1.1.14), then `mastra` against `none` by memory category.
- **Notes:** 2 to 3 days. Needs 1.1.10 and 1.1.11. Jira: [BA-190](https://halo-powered.atlassian.net/browse/BA-190) (was BA-191, merged on 2026-10-13). The memory arm started 2026-11-02, for roadmap 1.3.7 of the BA-4 branch (BA-81); the knowledge on and off and model-override arms are still to do. The memory arm was done and accepted on 2026-11-02, and used for BA-81's decision runs; it stays In progress for the other arms. Evidence: [evidence/1.1.13/](evidence/1.1.13/).

#### 1.1.14 — Component checks and two-turn tasks (Step 8) ([BA-190](https://halo-powered.atlassian.net/browse/BA-190); was BA-192)  `🚧 In progress`
- **Intent:** a wrong answer names the part that failed, and a clarification counts only if the answer after it is right.
- **Scope:** checks on intermediate outputs (tables used, repair count, query time against the reference, the verifier's agreement in careful mode); a `turns` field on a case; at least ten tasks in the `follow-up` category. Added 2026-11-02 for BA-81's memory decision: the memory set `memory.json`, 36 two-step cases (teach signals stored in the memory under test, then a probe as the first turn of a new session) in six memory categories, 4 dev and 2 held out each; the memory checks M1 to M3 (`noRowValuesRetained`, `notRejectedSql`, `teachNotRecalled`), scored by the runner; the validator's trap and teach checks; the recall time in the Details panel ([agents-evals](specs/capabilities/agents-evals/spec.md) R233 to R246).
- **Out of scope:** none named in the plan.
- **Acceptance:** a failed task names the component that failed. The validator passes the three memory sets: every reference and teach query runs, and every trap fails the result-set match.
- **Notes:** about a week, after the beta. Jira: [BA-190](https://halo-powered.atlassian.net/browse/BA-190) (was BA-192, merged on 2026-10-13). The memory part started 2026-11-02; the component checks on intermediate outputs and the `turns` field are still to do. The memory part was done and accepted on 2026-11-02 (the validator passes the three memory sets: 30/30, 3/3 and 3/3); it stays In progress for the rest. Evidence: [evidence/1.1.13/](evidence/1.1.13/).

#### 1.1.15 — Verified queries become cases; a user eval set per dataset (Step 9) ([BA-193](https://halo-powered.atlassian.net/browse/BA-193))  `📋 Planned`
- **Intent:** a user gets a pass rate on their own data from the answers they already approved.
- **Scope:** the `eval_sets` collection; every verified query promoted into its dataset's set as an approved case; the thumbs-down correction flow storing a draft; a "Your sets" section on the Evals tab run through the same runner; approved accuracy, paraphrase agreement, coverage and "too few questions to tell" under 30.
- **Out of scope:** templates (1.1.16) and model drafts (1.1.17).
- **Acceptance:** the E2E scenarios pass; a run completes end to end on a database that is not a fixture.
- **Notes:** about a week, after the beta. Needs 1.1.4 and 1.1.11. Jira: [BA-193](https://halo-powered.atlassian.net/browse/BA-193).

#### 1.1.16 — Templates for any datasource (Step 10) ([BA-193](https://halo-powered.atlassian.net/browse/BA-193); was BA-194)  `📋 Planned`
- **Intent:** a newly connected datasource gets a correctness number in minutes, with no one writing a question.
- **Scope:** about 20 template cases per dataset from the inventory and sample rows, with reference SQL per dialect; a *Generate from schema* button; template accuracy reported apart from approved accuracy; the health check defined as templates plus the reference-free checks.
- **Out of scope:** model-written questions.
- **Acceptance:** the generator runs on the World Cup fixtures on all three kinds and on one database it has never seen; every template's SQL runs in every dialect; a capped REST endpoint produces a case marked partial.
- **Notes:** 3 to 4 days, after the beta. Needs 1.1.15. Jira: [BA-193](https://halo-powered.atlassian.net/browse/BA-193) (was BA-194, merged on 2026-10-13).

#### 1.1.17 — Draft with AI from schema, knowledge and documents (Step 11) ([BA-193](https://halo-powered.atlassian.net/browse/BA-193); was BA-195)  `📋 Planned`
- **Intent:** a user attaches a data dictionary or a past report and gets draft questions with answers to review.
- **Scope:** an eval-bootstrap agent; document attachment on the Evals tab; drafts validated by execution and de-duplicated; a review screen (approve, edit, reject) showing SQL and rows; provenance; a cap and a cost line per click; a privacy sentence.
- **Out of scope:** drafts counting before a person approves them.
- **Acceptance:** on the World Cup fixture with its glossary attached, at least 70% of drafts survive validation and a reviewer approves at least half without edits (targets confirmed in the first trial).
- **Notes:** 1 to 2 weeks, after the beta. Needs 1.1.15 and 1.1.16. Jira: [BA-193](https://halo-powered.atlassian.net/browse/BA-193) (was BA-195, merged on 2026-10-13).

#### 1.1.18 — The eval set travels with the agent (Step 12) ([BA-193](https://halo-powered.atlassian.net/browse/BA-193); was BA-196)  `📋 Planned`
- **Intent:** an SME agent is handed over with its own evals.
- **Scope:** the agent bundle export carrying prompt, knowledge and eval set; import as drafts only; approved accuracy on the agent card and detail view; evals for user agents.
- **Out of scope:** multi-reviewer approval; Genie benchmark export.
- **Acceptance:** an exported agent imports with its set as drafts, and its card shows the approved accuracy after review. (Derived from the step's scope; the plan gives no done-when for Step 12.)
- **Notes:** 3 to 4 days, after the beta. Needs 1.1.15 and the bundle format from the Agent Hub work. Jira: [BA-193](https://halo-powered.atlassian.net/browse/BA-193) (was BA-196, merged on 2026-10-13).

#### 1.1.19 — Intellify sample as a Testing Data fixture ([BA-212](https://halo-powered.atlassian.net/browse/BA-212))  `✅ Done`
- **Intent:** recreate the Intellify sample database (the Halo × Marsh ERD and data dictionary: 49 entities, 243 attributes) in one click, so the assistant can be tried and later evaluated on an employee-benefits model as well as on sports data.
- **Scope:** a fourth sample fixture `intellify` in the Testing Data catalogue: a bundled gzipped seed `003_intellify.sql.gz` that creates schema `intellify` (49 tables, 52 foreign keys, column comments carrying the source Mongo field and its dictionary description) with deterministic synthetic data, registered as datasource "Intellify PostgreSQL" and dataset "Intellify" in database `intellify` on the sample server. The generator that writes the seed, `scripts/generate-intellify-seed.py`, is committed so the seed can be regenerated byte for byte.
- **Out of scope:** an Intellify eval question set (a later BA-9 story); reading Postgres column comments into dataset descriptions (a connector change); any real Intellify data.
- **Acceptance:** Settings → Testing Data lists "Intellify" with `0/49 entities`; loading it against the sample server creates the `intellify` database when missing, seeds it and reports `49/49 entities`, and the "Intellify" dataset has sample values and the 52 declared join references. Running the generator again reproduces the committed seed exactly.
- **Notes:** shipped on `main` as roadmap 1.1.2 (PR #77); renumbered 1.1.19 on 2026-10-15, when `main` was merged into the epic branch, because the branch's 1.1.2 is the research (BA-127). Evidence: [evidence/1.1.19/](evidence/1.1.19/). The model is converted, not invented: Mongo field paths become snake_case columns (`client_clientId` → `client_client_id`, `_id` → `id`), ObjectIds are `char(24)`, embedded objects are `jsonb`, and relationships the source draws without a field stay unjoinable. All rows are synthetic.

#### 1.1.20 — Supervised improvement loop (before the beta) ([BA-242](https://halo-powered.atlassian.net/browse/BA-242))  `✅ Done`
- **Intent:** turn eval failures into accepted fixes, one lever at a time, with a number that shows each fix also holds on questions the fixer never saw.
- **Scope:** tooling: a `repeats` option (1, 3 or 5) with pass^k and a Wilson interval per category; results, summary and report split by dev and held-out; tokens and cost per question; `eval:diff` between two runs by category and split; locks (permission deny rules) so the loop cannot edit sets, checks, thresholds or facts; a leak check that rejects prompt, tool or context changes containing strings from the sets or `facts.json`; a dev-only failure export for the fixer; the loop's `program.md`, `results.tsv` and an `eval-loop` skill. Rounds: a baseline on World Cup, finance and marketing analytics on PostgreSQL, dev and held-out, repeat 3, judge off, on gpt-4o-mini; then about five supervised rounds before 2026-10-31 (triage; one lever from prompt, tool descriptions and errors, context and knowledge; target slice; full run; accept or revert by the rule in plan 3.6).
- **Out of scope:** unattended automation (after the beta); changing the model; the nightly CI run and the beta thresholds (they stay in 1.1.11).
- **Acceptance:** the tooling is in; a baseline and at least three rounds are recorded in `results.tsv` with dev and held-out side by side; each accepted change is committed with its eval diff; no change touches a locked path or fails the leak check.
- **Notes:** added 2026-10-20 at the user's request. Pulls forward the repeats, split and cost parts of 1.1.11 ([BA-188](https://halo-powered.atlassian.net/browse/BA-188)). Model: gpt-4o-mini, the user's choice, until Anthropic API keys are available; about $25 at most to the beta. The user decides keep or revert on every round; changed on 2026-10-21 at the user's request: the lead runs every round with a headless fixer, reverts on its own a round that fails the accept rule, and asks the user only about a round that meets it; and, after round 1 the same day, every round gets its full run, and the user may keep a change whose target did not rise when nothing went down (`kept`); and, after a probe of four models on 31 dev questions, the loop moved to gpt-5.6-luna at low effort from round 3 (a new baseline), with the three sets run at once, one data dir each. Loop steps and levers: [plan 3.6](docs/plans/BA-9.md#36-the-improvement-loop). Needs 1.1.4 to 1.1.7. Jira: [BA-242](https://halo-powered.atlassian.net/browse/BA-242). Phase 1 (the tooling, no model runs) built on 2026-10-20 by five work units in parallel (specs and contracts first, then backend, usage capture, frontend and loop tools): agents-evals R209 to R230. The acceptance gate (2026-10-22) updated scenarios 1, 9 and 12 of `frontend/e2e/agents.spec.ts` and added 13 to 15 (15 of 15 pass on the web target). The fixer's locks were smoke-tested with headless `claude -p` runs: reads and edits of denied paths were refused, an edit of a lever file went through. Done on 2026-10-22: ten rounds recorded in `docs/evals/loop/results.tsv` (three on gpt-4o-mini, seven on gpt-5.6-luna), one accepted (round 7) and three kept (5, 6, 9), each committed with its `eval:diff`; dev 13/130 → 102/130, held-out 7/51 → 33/51, $11.89 spent. Still owed before PR #81 merges: the repo's eval gate (100%, three runs) on a Claude model for the rounds that change what the assistant receives, or a gate change. Evidence: [evidence/1.1.20/](evidence/1.1.20/).

#### 1.1.21 — Investigation questions with planted insights ([BA-243](https://halo-powered.atlassian.net/browse/BA-243))  `✅ Done`
- **Intent:** measure the analyst's job, finding why something happened, not only fetching the right number.
- **Scope:** questions that ask why, scored with deterministic checks (`matches`, `not-matches`, `uses-entities`, `numbers-grounded`) against a story planted in the fixture data, with a planted wrong explanation; one brief per insight, written by a person in `docs/evals/domains/<domain>.md` (who asks, how they ask, the true cause, what a good analyst finds, the wrong explanation); facts and validator queries per insight; dev variants written by Claude, held-out wording by the person.
- **Out of scope:** evaluating the deep-analysis skill's phases; investigation across several turns (1.1.14).
- **Acceptance:** at least two approved briefs, each with dev and held-out questions and validated references, run in 1.1.20's rounds.
- **Notes:** added 2026-10-20. First briefs: marketing analytics (Harborline's 2024-Q3 campaign freeze, already in the data: bound policies 11,337, 10,028 and 11,457 in 2024-Q2 to Q4; most of the drop is in direct online and mobile app; the other carriers fell 1.6%) and finance. The existing case `campaign-freeze-impact` names the cause in the question and only checks that the answer contains 10,028. Waits on the user's briefs. On 2026-10-23 the user asked Claude to draft the briefs: Claude drafts each brief, its facts and validator queries and its dev variants, in `docs/evals/domains/` (a held-out path the fixer never sees); the user approves each brief and writes the held-out wording before any question enters a set. Jira: [BA-243](https://halo-powered.atlassian.net/browse/BA-243). On 2026-10-26 the user approved both briefs and their eight dev drafts as drafted, with the generic words of their patterns to go on the leak check's allowlist when the cases enter the set (recorded under *What approval decides* in each domain file). Later that day the user asked Claude (Fable 5.1) for held-out candidates and chose one per slot (*Held-out wording* in each brief); the twelve cases entered the sets (Finance 74 questions, 22 held out; Marketing Analytics 56, 18 held out), validated as the drafts were ([evidence/1.1.21/](evidence/1.1.21/)); 83 generic pattern words went on the leak allowlist, the counts were updated (agents-evals R11 and *Eval suite content*, agents.md 8.1, the domain docs, `EVAL_SETS`), and round 17 measured the banks: dev 120/138, held-out 40/55, the twelve investigation questions at 7 of 36 attempts (dev reasoning 2/10, held-out 0/4). The traces say why: on the marketing story the assistant decomposes the dip and never reads the campaign results in 13 of 18 attempts; on the finance story it finds the September billing but counts settled fees only or sums the statuses in the text, and the shared `matches` pattern lacks "timing" and "monthly" wording, so eight right answers failed a text check (a check defect). Fixed on 2026-10-27 as a supervisor change: the `matches` patterns widened to that wording (re-scored on round 17's 36 answers, 10 attempts from fail to pass and none the other way; the wrong explanations still fail), 6 more generic words allowlisted; not re-run ($21.37 of the loop's $22 spent), so the widened checks count from the next baseline, the Claude gate runs of PR #81. Done on 2026-10-27, accepted by the user by hand: the acceptance gate updated no scenario beyond the set-list counts changed in the fast loop and re-ran `agents.spec.ts` (19 of 19 on the web target). What the questions found is left to later rounds: on round 17 the assistant answered the investigations right in 7 of 36 attempts, and the widened patterns do not change that count. Evidence: [evidence/1.1.21/](evidence/1.1.21/).

#### 1.1.22 — Improvement loop rounds 10 onward, and rule A40 on a second model ([BA-244](https://halo-powered.atlassian.net/browse/BA-244))  `✅ Done`
- **Intent:** keep turning dev failures into fixes until the beta, and learn whether round 9's prompt rule holds on a model it was not tuned on.
- **Scope:** rounds from round 9's baseline (gpt-5.6-luna, low effort) by [program.md](docs/evals/loop/program.md), until the rounds have spent $22 in all or 2026-10-31; an A/B of rule A40 on gpt-6-luna: round 8's build against round 9's, same data, repeat 3, judge off, with gpt-6-luna priced in `pricing.json` first.
- **Out of scope:** the repo's eval gate on a Claude model (waits for Anthropic keys); changing the sets, the checks or the loop's model.
- **Acceptance:** each round has its `results.tsv` row and `eval:diff`; each kept or accepted change is committed with its diff; the A40 A/B is recorded with its `eval:diff`.
- **Notes:** added 2026-10-23 at the user's request. The same day the user delegated the keep and accept decisions to the lead session; the accept rule, the levers and the forbidden paths are unchanged. Needs 1.1.20. Jira: [BA-244](https://halo-powered.atlassian.net/browse/BA-244). Done on 2026-10-23: rounds 10 to 12 kept (a note on grouped results, rule A41, a LEFT JOIN filter warning) and round 13 a baseline under the fixed `check-option-count`; dev 102/130 to 113/130, held-out 33/51 to 35/51, $16.89 of $22 spent. Stopped at round 13 with $5.11 left: the remaining dev failures are checks or questions for the user to change, knowledge the Marketing Analytics sample lacks, or a flaky tail (listed in the evidence). Rule A40 holds on gpt-6-luna. Still owed before PR #81 merges: the eval gate on a Claude model. Evidence: [evidence/1.1.22/](evidence/1.1.22/). On 2026-10-26 the user set that gate for PR #81: a comparison with `main` on the beta's Claude model, no category `down` and every `out-of-scope` and `non-existent` question 3 of 3, instead of 100% ([specs/epics/BA-9/spec.md](specs/epics/BA-9/spec.md)). It still waits for the Anthropic keys.

#### 1.1.23 — E2E coverage of the improvement loop's behaviour ([BA-245](https://halo-powered.atlassian.net/browse/BA-245))  `✅ Done`
- **Intent:** every behaviour the agents-evals spec states for BA-242 has a scenario that fails when it breaks.
- **Scope:** the list in [evidence/1.1.20/e2e-impact.md](evidence/1.1.20/e2e-impact.md), *Behaviour the spec states with no Gherkin step*: Gherkin scenarios in the agents-evals spec; Playwright scenarios on the web target for R214, R26 and R216 to R218; an API-level test for the Repeats refusal (R209); tests of the command-line options and tools (R222, R223, R225 to R230) against stored runs, with no model calls.
- **Out of scope:** changes to the app's behaviour; the desktop target.
- **Acceptance:** each listed behaviour has a Gherkin scenario and a passing test; `check-specs` is green.
- **Notes:** added 2026-10-23 at the user's request. Needs 1.1.20. Jira: [BA-245](https://halo-powered.atlassian.net/browse/BA-245). Done on 2026-10-23: `agents.spec.ts` scenarios 16 to 19 added and 14 and 15 extended (19 of 19 pass on the web target); the command-line behaviour is covered by backend tests the Gherkin names, three of them new; no production code changed. Evidence: [evidence/1.1.23/](evidence/1.1.23/).

#### 1.1.24 — Checks and questions that failed right answers ([BA-188](https://halo-powered.atlassian.net/browse/BA-188))  `✅ Done`
- **Intent:** the evals stop failing answers that are right, so the loop and the 100% gate measure the assistant, not the exam.
- **Scope:** `check-uses-entities` counts the tables a view reads as read by the query that reads the view; `check-numbers-grounded` ignores the number inside a stage name ("round of 16", "round-of-16", "last 16"); the `matches` pattern of `non-performing-loans` ignores case; `matches-by-stage` asks for both tournaments counted together; a new loop baseline (round 14) under them.
- **Out of scope:** other questions or checks; the loop's accept rule; BA-243's investigation questions.
- **Acceptance:** unit tests for both check changes; the bank validates; in round 14 none of the four questions fails for the reason the review found (a view counted as no join, the 16 of a stage name, the case of a status, the per-tournament reading); round 14 recorded in `results.tsv` with its `eval:diff`; `check-specs` green.
- **Notes:** decided by the user on 2026-10-24, decisions 1 to 4 of the "Para decidir" section of the loop's log page (for decision 1, option B: the check opens the views, rather than dropping the check from the question). Found in the dev failures of rounds 8 to 13 (BA-244, 1.1.22). Jira: [BA-188](https://halo-powered.atlassian.net/browse/BA-188). Done on 2026-10-26, accepted by the user: in round 14 the four questions pass 3 of 3; dev 113/130 to 119/130, held-out 35/51 to 32/51 (within its interval; no held-out question changed). One acceptance gate with 1.1.25: no E2E scenario added, updated or deleted, the impacted specs re-run (34 of 34 on the web target). Evidence: [evidence/1.1.24/](evidence/1.1.24/).

#### 1.1.25 — Marketing Analytics knowledge seed ([BA-188](https://halo-powered.atlassian.net/browse/BA-188))  `✅ Done`
- **Intent:** the assistant gets the Marketing Analytics sample's business definitions the way it gets Finance's, so its answers count what the business counts (written premium on bound sales only, for one).
- **Scope:** a knowledge seed for the Marketing Analytics sample, created when the sample is loaded (testing-data R26, R27), with the rules of `docs/evals/domains/marketing-analytics-policy.md`, each verified by SQL against the sample; measured as loop round 15 against round 14.
- **Out of scope:** anything that answers BA-243's investigation questions (the 2024-Q3 campaign pause); seeds for other samples.
- **Acceptance:** the seed is created when the sample loads; its unit test (R27: no question id or wording) passes; every fact in it verified by SQL; round 15 recorded with its `eval:diff`.
- **Notes:** decided by the user on 2026-10-24, decision 5 of the same page. Closes the gap 1.1.10 left for Marketing Analytics (Finance, Health Insurance, Genomics and Supply Chain ship a seed). Jira: [BA-188](https://halo-powered.atlassian.net/browse/BA-188). Done on 2026-10-26, accepted by the user: round 15 kept the seed (13 entries and 4 metrics; Marketing Analytics held-out 9/16 to 14/16, the chart of written premium by quarter 3 of 3). With the seed, one governance question asked "dollars or percent?" although both readings name the same competitor. Round 16 fixed that by widening rule A4: compute every reading first, and ask only when they disagree. It was kept, and the question went from 0/3 to 3/3. After both rounds dev is 113/130 and held-out 40/51; $20.12 of the loop's $22 is spent. Evidence: [evidence/1.1.25/](evidence/1.1.25/), with the acceptance gate shared with 1.1.24 in [evidence/1.1.24/](evidence/1.1.24/).

### Milestone 1.2 — Data Model DSL ([BA-2](https://halo-powered.atlassian.net/browse/BA-2)) — archived, see roadmap-archive.md

### Milestone 1.3 — Knowledge Store ([BA-4](https://halo-powered.atlassian.net/browse/BA-4)) — archived, see roadmap-archive.md

### Milestone 1.4 — Response Reliability Signals ([BA-12](https://halo-powered.atlassian.net/browse/BA-12)) — archived, see roadmap-archive.md

### Milestone 1.5 — Data Connectors ([BA-5](https://halo-powered.atlassian.net/browse/BA-5)) — archived, see roadmap-archive.md

### Milestone 1.6 — User Testing ([BA-10](https://halo-powered.atlassian.net/browse/BA-10)) — archived, see roadmap-archive.md

### Milestone 1.7 — Bug Fixes ([BA-11](https://halo-powered.atlassian.net/browse/BA-11))

Fix the bugs and blockers from user testing and the golden-dataset evals, and stabilize the build for the Oct 31 release. No fix version in Jira yet. New bugs filed under BA-11 get a feature here.

#### 1.7.1 — Session thread is empty after navigating away and back ([BA-83](https://halo-powered.atlassian.net/browse/BA-83))  `📋 Planned`
- **Intent:** returning to a session always shows its history.
- **Scope:** `SessionChat` only resets its messages when the session id changes (`frontend/src/app/features/sessions/components/session-chat/session-chat.ts`, the effect around line 255). Check whether the session is re-fetched on return, and that leaving mid-stream resets `sending()`.
- **Out of scope:** —
- **Acceptance:**
  - Returning to a session always shows its messages without a refresh, including after leaving mid-stream.
  - Same-id refreshes still do not abort an in-flight stream (the existing `SessionChat` rule in CLAUDE.md).
  - An E2E test covers leaving and returning.

#### 1.7.2 — Release stabilization  `📋 Planned`
- **Intent:** a shippable 1.0 Beta on 2026-10-31.
- **Scope:** blockers from 1.6 and 1.1; full E2E suite green; installers built for all platforms and published to the release.
- **Acceptance:** release tagged and installers attached; no open blocker bugs in BA.

Bugs found by the spec backfill (0.2.2), security first. Details: [evidence/0.2.2/findings.md](evidence/0.2.2/findings.md).

#### 1.7.3 — Datasource credentials stored in plaintext ([BA-101](https://halo-powered.atlassian.net/browse/BA-101))  `📋 Planned`
- **Intent:** datasource secrets are encrypted at rest like the LLM key.
- **Scope:** see the Jira bug and the Open question in [system/data-model.md](specs/system/data-model.md).
- **Acceptance:** Passwords, tokens and REST credentials/headers are encrypted and masked; existing installs are migrated.

#### 1.7.4 — Desktop backend reachable from the network ([BA-102](https://halo-powered.atlassian.net/browse/BA-102))  `📋 Planned`
- **Intent:** only the local machine can reach the desktop backend.
- **Scope:** see the Jira bug and the Open question in [system/api.md](specs/system/api.md).
- **Acceptance:** The desktop backend binds `127.0.0.1`.

#### 1.7.5 — Bearer tokens survive diagnostics redaction ([BA-91](https://halo-powered.atlassian.net/browse/BA-91))  `📋 Planned`
- **Intent:** no credential reaches the logs or an exported report.
- **Scope:** see the Jira bug and the Open question in [capabilities/diagnostics/spec.md](specs/capabilities/diagnostics/spec.md).
- **Acceptance:** `Authorization: Bearer <token>` and the missing key names (`pwd`, `passwd`, `access_key`, `private_key`) are fully redacted; a unit test covers each pattern.

#### 1.7.6 — Assistant SQL not limited to session datasets ([BA-103](https://halo-powered.atlassian.net/browse/BA-103))  `📋 Planned`
- **Intent:** the assistant can only query the session's datasets.
- **Scope:** see the Jira bug and the Open question in [capabilities/datasources/spec.md](specs/capabilities/datasources/spec.md).
- **Acceptance:** Statements naming entities outside the session's datasets are rejected with a clear message.

#### 1.7.7 — Read-only SQL guard is a keyword blacklist ([BA-104](https://halo-powered.atlassian.net/browse/BA-104))  `📋 Planned`
- **Intent:** read-only enforcement is correct and does not reject harmless queries.
- **Scope:** see the Jira bug and the Open question in [capabilities/datasources/spec.md](specs/capabilities/datasources/spec.md).
- **Acceptance:** A parser-based guard; `replace(...)` and `;` inside literals pass; Databricks writes are still rejected.

#### 1.7.8 — PostgreSQL SSL skips certificate checks ([BA-105](https://halo-powered.atlassian.net/browse/BA-105))  `📋 Planned`
- **Intent:** SSL connections are verified by default.
- **Scope:** see the Jira bug and the Open question in [capabilities/datasources/spec.md](specs/capabilities/datasources/spec.md).
- **Acceptance:** Certificates are verified unless the user opts out; a CA field exists.

#### 1.7.9 — Fixed default APP_SECRET fallback ([BA-106](https://halo-powered.atlassian.net/browse/BA-106))  `✅ Done`
- **Intent:** encrypted keys are never protected by a known secret, and a change of secret never leaves the LLM settings broken behind an unexplained backend error.
- **Scope:**
  - A bare backend with no `APP_SECRET` reads or generates `<APP_DATA_DIR>/.app-secret` (32 random bytes hex, mode 0600), the same as Electron main and the CLI. The fixed development default is no longer used to encrypt.
  - At startup, an LLM API key encrypted under the old development default (`insecure-dev-secret`) is re-encrypted with the current secret, so installs that ran before the launchers persisted a secret keep their key.
  - A stored key that neither secret can read no longer fails with a 500: the settings view reports `configured: false` with `keyUnreadable: true` and keeps provider, model and base URL; the LLM Configuration screen says the key must be entered again; agent turns, test and save without a key fail with the same readable message.
- **Out of scope:** encrypting datasource credentials (1.7.3, BA-101); recovering a key encrypted under a lost random secret (impossible by design).
- **Acceptance:**
  - A backend started with no `APP_SECRET` creates `.app-secret` in its data dir and reuses it on the next start; no "insecure development default" warning.
  - A key saved under the development default is readable after a launch with a real secret, and is stored re-encrypted under it.
  - A key under an unknown secret: `GET /llm/settings` is 200 with `keyUnreadable: true`; the screen shows "Your saved API key can't be read because the app secret changed. Enter the key again, test and save."; re-entering the key, testing and saving fixes it.
  - Gherkin in [capabilities/llm-settings/spec.md](specs/capabilities/llm-settings/spec.md) mirrored by `frontend/e2e/llm-settings.spec.ts`, green.
- **Notes:** found from a diagnostics report on 2026-10-06: the first launch of a data dir after commit `a3ef363` (Electron persists `.app-secret`) could not read the key saved under the development default.

#### 1.7.10 — Web-mode diagnostics export not redacted ([BA-107](https://halo-powered.atlassian.net/browse/BA-107))  `📋 Planned`
- **Intent:** redaction is the same in desktop and browser modes.
- **Scope:** see the Jira bug and the Open question in [capabilities/diagnostics/spec.md](specs/capabilities/diagnostics/spec.md).
- **Acceptance:** The browser-mode log buffer and export are redacted.

#### 1.7.11 — Tailoring after a revert overwrites a version ([BA-92](https://halo-powered.atlassian.net/browse/BA-92))  `📋 Planned`
- **Intent:** every visual version is immutable once written.
- **Scope:** see the Jira bug and the Open question in [capabilities/visuals/spec.md](specs/capabilities/visuals/spec.md).
- **Acceptance:** After revert v3 → v1 and a tailor, the new version is v4 and v1–v3 are unchanged.

#### 1.7.12 — Interrupted eval runs stay running ([BA-93](https://halo-powered.atlassian.net/browse/BA-93))  `📋 Planned`
- **Intent:** an interrupted eval run never blocks the agent or the UI.
- **Scope:** see the Jira bug and the Open question in [capabilities/agents-evals/spec.md](specs/capabilities/agents-evals/spec.md).
- **Acceptance:** On startup, runs left `running` are marked interrupted and can be deleted.

#### 1.7.13 — Auto-repair rebuilds from stale data ([BA-94](https://halo-powered.atlassian.net/browse/BA-94))  `📋 Planned`
- **Intent:** repairing a visual never loses its data.
- **Scope:** see the Jira bug and the Open question in [capabilities/visuals/spec.md](specs/capabilities/visuals/spec.md).
- **Acceptance:** Auto-repair uses the current version's `data.json`.

#### 1.7.14 — Verified query id rotates on re-approval ([BA-95](https://halo-powered.atlassian.net/browse/BA-95))  `📋 Planned`
- **Intent:** promoted metrics keep their source link.
- **Scope:** see the Jira bug and the Open question in [capabilities/verified-queries/spec.md](specs/capabilities/verified-queries/spec.md).
- **Acceptance:** Re-approving an answer keeps the verified query id.

#### 1.7.15 — Testing data clobbers same-name datasources ([BA-96](https://halo-powered.atlassian.net/browse/BA-96))  `📋 Planned`
- **Intent:** loading or removing sample data never touches user records.
- **Scope:** see the Jira bug and the Open question in [capabilities/testing-data/spec.md](specs/capabilities/testing-data/spec.md).
- **Acceptance:** Load and Remove affect only records the fixture created.

#### 1.7.16 — Dataset rename duplicates; delete unconfirmed ([BA-97](https://halo-powered.atlassian.net/browse/BA-97))  `📋 Planned`
- **Intent:** dataset edits and deletes are predictable.
- **Scope:** see the Jira bug and the Open question in [capabilities/datasets/spec.md](specs/capabilities/datasets/spec.md).
- **Acceptance:** Rename updates in place; delete asks for confirmation and names the sessions that use the dataset.

#### 1.7.17 — Datasource-scoped knowledge is never used ([BA-98](https://halo-powered.atlassian.net/browse/BA-98))  `📋 Planned`
- **Intent:** every saved knowledge entry can reach the assistant.
- **Scope:** see the Jira bug and the Open question in [capabilities/knowledge/spec.md](specs/capabilities/dataset-ontology/spec.md).
- **Acceptance:** Datasource-scoped entries are injected for sessions on that datasource, or the scope is removed.

#### 1.7.18 — Stale application-shell visual baseline ([BA-99](https://halo-powered.atlassian.net/browse/BA-99))  `📋 Planned`
- **Intent:** the visual baseline matches the current shell.
- **Scope:** see the Jira bug and the Open question in [system/ui.md](specs/system/ui.md).
- **Acceptance:** The baseline shows the current sidebar and the visual test passes.

#### 1.7.19 — Sidebar session order goes stale ([BA-100](https://halo-powered.atlassian.net/browse/BA-100))  `📋 Planned`
- **Intent:** the most recently used session is on top.
- **Scope:** see the Jira bug and the Open question in [capabilities/agent-answers/spec.md](specs/capabilities/agent-answers/spec.md).
- **Acceptance:** After a chat turn the session moves to the top without a reload.

#### 1.7.20 — Renderer honours a non-default `BACKEND_PORT` ([BA-109](https://halo-powered.atlassian.net/browse/BA-109))  `📋 Planned`
- **Intent:** setting `BACKEND_PORT` must move the whole desktop app to that port, not just the backend. Today the main process spawns the backend and runs its readiness probe on `BACKEND_PORT` (`frontend/electron/main.cjs`), but under `file://` the renderer hardcodes `http://localhost:3000` (`frontend/src/app/core/config/api.config.ts`), and the preload bridge doesn't expose the port. With `BACKEND_PORT=3123` the window opens and every API call fails, or it quietly reaches whatever else is listening on 3000.
- **Scope:** pass the resolved port from the main process to the renderer before Angular boots: through `preload.cjs` (`contextBridge`, e.g. `window.qti.backendPort`) or a query parameter on the `loadFile` / dev URL. Make `API_BASE_URL` read it and fall back to 3000. Cover `npm run electron`, `electron:dev` and packaged builds.
- **Out of scope:** automatic free-port fallback in Electron (the CLI already has one); the web / `npx` mode, which is same-origin and unaffected.
- **Acceptance:**
  - With `BACKEND_PORT=3123`, the packaged and `npm run electron` apps load sessions, datasources and chat against port 3123, and nothing requests `:3000`.
  - With no `BACKEND_PORT`, behaviour is unchanged.
  - A Playwright scenario in `frontend/e2e/` launches Electron with a non-default `BACKEND_PORT` and asserts the shell loads data (new Gherkin scenario in [specs/capabilities/app-shell/spec.md](specs/capabilities/app-shell/spec.md)).
  - The `API_BASE_URL` sentence in CLAUDE.md ("Known gap") is updated.
- **Notes:** moved from 0.1.1 on 2026-10-04 so the bug sits under a Jira epic (BA-11). Found while drawing the C4 container diagram ([specs/system/architecture.md](specs/system/architecture.md), Level 2). Related to ADR-0001.

#### 1.7.21 — No orphaned backend survives the desktop app or an upgrade  `✅ Done`
- **Intent:** on Windows a backend process sometimes outlives its window (crash, End task, sign-out) and keeps port 3000; the next launch or the upgraded version then talks to the stale backend. Nothing left over from an earlier run or version may run alongside, or answer for, the current app.
- **Scope:** (1) the backend exits within a few seconds when the desktop window process that spawned it is gone (`DESKTOP_PARENT_PID`); (2) the desktop shell records the backend's PID in `<APP_DATA_DIR>/backend.pid`, stops a still-running backend from an earlier run at startup (only if it is the app's own executable), and the readiness probe accepts only the backend it just started (`X-Backend-Instance` header); (3) a single-instance lock: a second launch focuses the running window; (4) the Windows installer and uninstaller force-stop every copy of `Halo BI Assistant.exe` the user runs, after the usual "close the app" check (`frontend/build/installer.nsh`).
- **Out of scope:** freeing a port held by an unrelated program; macOS installers; the web / `npx` mode.
- **Acceptance:**
  - A backend whose parent process has died exits within about 2 s (unit test).
  - Startup stops a live process recorded in `backend.pid` when its image is the app's executable, leaves it alone otherwise, and clears a stale file (unit tests).
  - With another server answering on the backend port, the app does not report `ready` and records an error diagnostic naming the port.
  - Launching the desktop app a second time with the same profile opens no second window or backend and focuses the first.
  - The Windows installer built by `build-desktop.yml` compiles with the custom check.
- **Notes:** reported 2026-11-11 after the v0.48.1 build; specs in [api.md](specs/system/api.md) 4.3, [delivery.md](specs/system/delivery.md) sections 1 and 2, [data-model.md](specs/system/data-model.md) 1.2 and app-shell R54–R55.

#### 1.7.22 — Windows install takes over 5 minutes  `✅ Done`
- **Intent:** the installer writes about 47,000 files, 98% of them the backend's `node_modules`, and more than half are build-time leftovers (type declarations, source maps, TypeScript sources, docs, lint configs). Per-file cost on Windows (NTFS plus Defender scanning each new file) dominates install and uninstall time.
- **Scope:** `frontend/scripts/prune-node-modules.mjs`, run by `stage-backend.sh` after `npm ci`, deletes those files from the staged backend's `node_modules`, keeping licence files and leaving `@github/copilot-sdk*` untouched (its bundled runtime reads its own `.md` and `.ts` files).
- **Out of scope:** bundling the backend into one file; de-duplicating the nested `@opentelemetry` copies under `@mastra/*`; code signing.
- **Acceptance:** the staged backend has at least 40% fewer files; every production dependency still loads and the staged backend answers its API under Electron-as-Node; unit tests cover what is pruned and what is kept.
- **Notes:** measured 2026-11-11 on a local `--win nsis` build of 0.48.1: 46,955 files, 45,804 of them in `resources/backend/node_modules`. The first upgrade still runs the old uninstaller over the old file set.

#### 1.7.23 — Windows install still takes over 5 minutes: bundle the backend  `🚧 In progress`
- **Intent:** after 1.7.22 the installer still writes about 21,300 files, 20,176 of them the backend's pruned `node_modules` (839 packages). Bundling the backend into one file leaves only the packages that cannot be bundled.
- **Scope:** `frontend/scripts/bundle-backend.mjs`, run by `stage-backend.sh` before the prune: esbuild bundles `dist/main.js` with its pure-JS dependencies, keeps first-party `__dirname` paths and assets working, keeps native addons and packages that read their own files outside the bundle (with their dependency closure), keeps the data files `@mastra/core` and `@mastra/observability` resolve at runtime, and writes `THIRD_PARTY_LICENSES.txt`. esbuild becomes an exact-pinned backend devDependency.
- **Out of scope:** the CLI and the npm package (unbundled as before); trimming `@github/copilot-sdk` (919 files, left whole); code signing; NSIS settings.
- **Acceptance:** the installed app has at least 80% fewer files than with pruning alone; the staged backend answers its API under Electron-as-Node, loads every Testing Data fixture, runs Answer a Business Question end to end with a real LLM, and exports XLSX and PDF; the build fails when a native addon is left inside the bundle; unit tests cover the closure, the prune, the path rewrite, the asset copy and the licence file.
- **Notes:** measured 2026-11-15 on a local `--win nsis --x64` build of 0.61.0 (mercer, macOS host): 2,844 installed files, 2,765 of them in `resources/backend`. Install time on Windows is not measured yet. Developer observability in the packaged app loses the Express, NestJS and `pg` instrumentations (bundled code can't be patched); HTTP, undici and Pino keep theirs. The first upgrade still runs the old uninstaller over the old file set.

### Milestone 1.8 — Agentic Hub Look and Feel ([BA-141](https://halo-powered.atlassian.net/browse/BA-141)) — archived, see roadmap-archive.md

### Milestone 1.9 — Agent Hub ([BA-150](https://halo-powered.atlassian.net/browse/BA-150)) — archived, see roadmap-archive.md

### Milestone 1.10 — LLM configuration ([BA-159](https://halo-powered.atlassian.net/browse/BA-159)) — archived, see roadmap-archive.md

### Milestone 1.11 — Claude Code workflow mod ([BA-169](https://halo-powered.atlassian.net/browse/BA-169)) — archived, see roadmap-archive.md

### Milestone 1.13 — Assistant skills: progressive-disclosure agent structure ([BA-198](https://halo-powered.atlassian.net/browse/BA-198)) — archived, see roadmap-archive.md

### Milestone 1.14 — Agent Hub: tools and skills per agent ([BA-213](https://halo-powered.atlassian.net/browse/BA-213)) — archived, see roadmap-archive.md

### Milestone 1.15 — US Health demo ([BA-233](https://halo-powered.atlassian.net/browse/BA-233)) — archived, see roadmap-archive.md

### Milestone 1.16 — Data Readiness Agent ([BA-251](https://halo-powered.atlassian.net/browse/BA-251)) — archived, see roadmap-archive.md

### Milestone 1.17 — Custom LLM endpoint provider ([BA-281](https://halo-powered.atlassian.net/browse/BA-281)) — archived, see roadmap-archive.md

### Milestone 1.18 — Desktop installer builds ([BA-302](https://halo-powered.atlassian.net/browse/BA-302)) — archived, see roadmap-archive.md

### Milestone 1.19 — US Health testing data ([BA-305](https://halo-powered.atlassian.net/browse/BA-305)) — archived, see roadmap-archive.md

### Milestone 1.20 — Schema metadata in datasets ([BA-318](https://halo-powered.atlassian.net/browse/BA-318)) — archived, see roadmap-archive.md

### Milestone 1.21 — Questions to Insights v2 ([BA-320](https://halo-powered.atlassian.net/browse/BA-320)) — archived, see roadmap-archive.md

### Milestone 1.22 — Sampled profiling and synthetic data (M1-22) — archived, see roadmap-archive.md

### Milestone 1.23 — Workflow-first: chats run workflows, agents are building blocks (M1-23)

The app becomes workflow-first: a chat runs a **workflow** defined in code, and agents are the building blocks that its steps call (workflows → agents → skills → tools). Every agent without a workflow of its own gets an automatic one-step workflow, so every session runs a workflow and there is one turn path. A **Workflows** area on the rail lists them, shows what each does on every message and starts chats; **Agents** becomes the library. The four showcase agents are removed. The epic started on 2026-11-11 as "Questions to Insights v2: a workflow you can follow" (story 1.23.1) and was widened the same day. Decision: ADR-0040. All stories are built on the branch `feat/M1-23-workflow-first` and ship as one PR. Epic spec: [specs/epics/M1-23/spec.md](specs/epics/M1-23/spec.md). Plan and contract: [docs/plans/m1-23-workflow-first.md](docs/plans/m1-23-workflow-first.md). No Jira key (repo only). Build order: 1.23.1, 1.23.2, 1.23.8, 1.23.3, then 1.23.4 with 1.23.5 in parallel, then 1.23.6 with 1.23.7 in parallel.

#### 1.23.1 — The Graph tab draws a workflow-backed agent's turn  `✅ Done`
- **Intent:** open Questions to Insights v2 → **Graph** and see, step by step, what happens on each message. Show which steps are code and which is the LLM, what each step receives and returns, the agent's tools and step limit inside the LLM step, and where a turn fails or stops.
- **Scope:**
  - `GET /agents/:key` (api.md 34) gains `workflow?` for a workflow-backed agent (today only `assistant-v2`). It holds the workflow id and its steps in order, each with:
    - id, title, kind (`code` or `agent`) and a one-line summary;
    - input and output field names, taken from the step's schemas;
    - for the agent step, its tools and maximum steps;
    - the step's other exits (`fails` or `stops`, with a label).
  - The data is built from the registered workflow and its step catalogue, never written twice, so a step added in code shows up without a UI change.
  - Graph tab of a workflow-backed agent, top section **What happens on each message**:
    - one node per step, left to right, in the workflow bar's titles and numbering;
    - code steps and the agent step in two distinct styles, with a legend;
    - the agent step drawn open: agent name, its tools and a loop marker `≤ <n> steps`;
    - labelled arrows carry the data passed between steps;
    - each step's other exits are drawn under it.
    - Hovering or focusing a step highlights it. Clicking it opens a details card under the drawing with its kind, summary, input and output.
  - Under it, the existing prompt-links graph keeps its behaviour under a **Prompt links** heading.
  - Specs: agents-evals R105 (+ a new rule and a Gherkin scenario), api.md 34, ui.md 4.5.6, agents.md 5.11 (the step catalogue's summaries and exits).
- **Out of scope:**
  - a run's live or last status on the drawing;
  - editing the workflow from the UI;
  - Graph changes for the assistant, the RFP Builder, the Data Readiness Agent, user agents and System agents;
  - the non-streamed turn;
  - changing the workflow's steps or what reaches the model.
- **Acceptance:**
  - Questions to Insights v2's Graph tab shows `Receive question`, `Load catalog`, `Analyse` and `Wrap up` in order:
    - Analyse is in the agent style, with `list_entities`, `describe_entity`, `run_readonly_sql` and `≤ 15 steps`;
    - the other three are in the code style;
    - the arrows are labelled with the step outputs;
    - the exits are visible: empty question fails, Stop ends at Analyse, model error fails.
  - Clicking `Load catalog` shows its input `question, datasets` and output `question, catalog`.
  - The Prompt links graph is still there.
  - The assistant's Graph tab is unchanged.
  - The axe scan passes in both themes.
  - Unit tests:
    - the `workflow` field matches the registered workflow's step order and schemas;
    - the layout is a pure function.
  - The `@demo @story-1.23.1` scenario passes.
  - Builds and check-specs are green.
- **Notes:** requested on 2026-11-11, after a review of agent-vs-workflow approaches. The user chose the Graph tab over a new tab, the definition only (no run status) for now, and a new epic because Milestone 1.21 has shipped. UI story: its demo is recorded in the fast loop. Built and committed (8fa8b745) before the epic was widened; its drawing is reused by 1.23.5.

#### 1.23.2 — Workflow-first: ADR, epic spec, glossary and roadmap  `✅ Done`
- **Intent:** the move to workflow-first is decided and scoped before any code, so each later story can be built and reviewed on its own.
- **Scope:**
  - ADR-0040 in `specs/system/architecture.md`, with "amended by ADR-0040" on ADR-0004, 0008, 0028, 0029 and 0034;
  - the widened epic spec, its README row and this milestone's entries;
  - the glossary terms: Workflow, One-step workflow, Code-defined workflow; Session and Agent amended.
- **Out of scope:** product code; the capability, api, data-model, agents and ui specs (each later story updates its own).
- **Acceptance:** ADR-0040 is `Accepted` and the epic spec `Confirmed (<date>)` by the user; `origin/main` was merged first and the ADR number re-checked; check-specs passes.
- **Notes:** S-size docs story. Plan: [docs/plans/m1-23-workflow-first.md](docs/plans/m1-23-workflow-first.md).

#### 1.23.8 — Remove the showcase agents  `✅ Done`
- **Intent:** the four showcase agents (Benchmarking, Survey, LAD COE, Strategy), which never run, are gone from the app.
- **Scope:** their agent files, registration and shipped prompts; every showcase branch in the backend and the agent hub; a saved pin or prompt override for their keys is ignored, never an error (no migration). Specs: agents-evals R106 retired and the lines naming them, agents.md 2.9, api.md 33, agent-answers R64, ui.md, glossary. Past epic specs stay as history.
- **Out of scope:** System agents; any other agent.
- **Acceptance:** no showcase agent in the hub or the new-session picker; `GET /agents/benchmarking` answers 404; with a pin and an override saved for `strategy`, the hub and `GET /agents` still load; `agent-hub` and `session-management` specs updated; the `@demo @story-1.23.8` scenario passes; builds, unit tests, lint and check-specs green.
- **Notes:** requested on 2026-11-11 (answer to the plan's open question 1). Built right after 1.23.2, so later stories have no showcase case. Detail: plan section 7.

#### 1.23.3 — The workflow catalogue: list, detail, and sessions bound to a workflow  `✅ Done`
- **Intent:** the backend knows every workflow a chat can run, says which one a session runs and which workflows use an agent, and starts a session from a workflow id. No UI.
- **Scope:** the framework-free workflow catalogue and `agent-turn` step catalogue; `GET /workflows`, `GET /workflows/:id`; `POST /sessions { workflowId }`; a new session stores `workflowId`; the session's `workflowRef`; the agent's `usedInWorkflows`; the new `workflows` capability spec, api.md, data-model 3.4, agents.md.
- **Out of scope:** the turn path (1.23.4); every UI change; editing workflows.
- **Acceptance:** unit tests for the derivation table, id parsing, drift and the creation invariant; the backend e2e `backend/test/workflows.e2e-spec.ts` (catalogue order, user agents Live-only, 404s, sessions from a workflow, `usedInWorkflows`); existing agent and session e2e specs unchanged; check-specs, lint, builds, unit tests green.
- **Notes:** API-only: its demo is `evidence/1.23.3/demo.txt`. Detail and contract: plan sections 4, 5 and 7.

#### 1.23.4 — Every streamed turn runs the session's workflow  `✅ Done`
- **Intent:** one turn path: an assistant, RFP Builder, Data Readiness or user-agent turn is a run of its one-step workflow, with the same answer, events, bar and stored message as before.
- **Scope:** the `agent-turn` Mastra workflow; `runTurnWorkflow` replaces the v2-only path and the direct agent call; a one-step workflow never writes the bar; one real trace captured and Monitoring kept true (workflow spans classed as Framework only if they appear); agents.md, agent-panel, sessions-chat, monitoring (if needed).
- **Out of scope:** the non-streamed turn; evals; any change to an agent's prompt, tools or context; UI.
- **Acceptance:** the existing session unit suites pass with only v2's internal names adapted; new unit tests per agent kind, bar, clarification and error handling; the request-recording Playwright specs unchanged and green; the `getInstructions()` and tool-list hashes equal on base and branch; builds and check-specs green.
- **Notes:** highest-risk story; trace before theorising. Demo: `evidence/1.23.4/demo.txt`. Parallel with 1.23.5.

#### 1.23.5 — A Workflows area: list, workflow page and Start chat  `✅ Done`
- **Intent:** open **Workflows** on the rail, see every workflow you can run, open one to see what happens on each message and which agents it uses, and start a chat from it.
- **Scope:** the rail item; the list (search, Official and Mine sections, cards with Start chat and requirements); the workflow page (the 1.23.1 drawing, its agents, Start chat); app-shell, the `workflows` capability, ui.md.
- **Out of scope:** the composer's Workflow field (1.23.6); removing Start chat from agents (1.23.7); editing workflows; run status.
- **Acceptance:** `frontend/e2e/workflows.spec.ts` with `@demo @story-1.23.5` (open v2's workflow, open a user agent's one-step workflow, Start chat); a blocked workflow says why; no editing control exists; search; the axe scan on both pages in both themes; navigation specs green.
- **Notes:** UI story. Parallel with 1.23.4.

#### 1.23.6 — The New conversation screen picks a workflow; chats name their workflow  `✅ Done`
- **Intent:** a chat is started by choosing a **Workflow**, and every chat names its workflow in its header and in the Sessions list.
- **Scope:** the composer's Agent field becomes Workflow (same listbox behaviour, Assistant preselected); Create sends the workflow id; the `Workflow` header chip on every chat and the Sessions list chip; sessions-chat, ui.md.
- **Out of scope:** the agent pages (1.23.7).
- **Acceptance:** `session-management.spec.ts` with `@demo @story-1.23.6` (pick v2, create, header and Sessions chip, the bar's four steps); a deleted agent's session and a pre-epic session name their workflow; the axe scan on the composer in both themes; every spec using the old composer test ids updated.
- **Notes:** UI story. Parallel with 1.23.7 (ownership of `app.ts` regions in the plan).

#### 1.23.7 — Agents are building blocks: no Start chat, and "Used in" workflows  `✅ Done`
- **Intent:** the Agents area is a library: a chat is never started from an agent, and each agent shows which workflows use it.
- **Scope:** Start chat removed from hub cards and agent detail; the Official agents' Chat Box tab removed (System Prompt becomes their default tab; user agents keep Chat Box for the preview); the `Used in` line linking to workflow pages; agents-evals, sessions-chat, rfp, data-readiness, ui.md.
- **Out of scope:** the agent editor and preview chat.
- **Acceptance:** `agent-hub.spec.ts` with `@demo @story-1.23.7` (no Start chat; `Used in` opens the workflow page; RFP Builder has no Chat Box tab); draft-only and System agents show their empty `Used in` text; the RFP and Data Readiness Start chat scenarios pass through Workflows; the agent editor specs pass unchanged; the axe scan in both themes.
- **Notes:** UI story. After it, the epic's stories go through the acceptance gate, then one changelog entry and the PR.

#### 1.23.9 — Run a workflow on an input: the sequential test workflow  `✅ Done`
- **Intent:** a workflow runs once on a typed input and shows each step's result, with no chat. The first such workflow is a three-step test workflow.
- **Scope:** run workflows in the catalogue (`trigger`, typed `input` fields defined in code); the `seq-text-demo` workflow (Clean text → Count words → Format result, code only); `POST /workflows/:id/runs` (api.md 118, nothing stored); the run workflow's page with its input form, Run and the per-step result; the list card's Run button; chat-only refusals and pickers. Contract: plan section 9.
- **Out of scope:** converting the four chat workflows and changing how chats start (1.23.10); storing runs; streaming a run's progress; LLM steps.
- **Acceptance:** unit tests for the three step functions, the catalogue entry, input validation and the drift test; a backend e2e for 118 (success, failed step, missing field, chat workflow refused); `frontend/e2e/workflows.spec.ts` with `@demo @story-1.23.9` (open the Sequential test workflow, type a text, Run, see three Done steps and the summary; an empty text shows Clean text Failed and the other two Skipped); the axe scan of the run page in both themes; builds, unit tests, lint and check-specs green.
- **Notes:** requested on 2026-11-11 ("workflows trigger workflows, not chats; we'll define the input as we go"). The user chose: all workflows become run workflows (the four existing ones in 1.23.10), a code-only test workflow, results shown on the page and not stored.

Stories 1.23.10–1.23.27 retire chats: every workflow runs once on a typed input, runs are stored, past chats open read-only (ADR-0041). Plan and contract: [docs/plans/m1-23-retire-chats.md](docs/plans/m1-23-retire-chats.md); its section 11.1 maps the plan's ids (1.24.x, 1.25.x) to these. Phase A is 1.23.11–1.23.22, Phase B 1.23.23–1.23.25, Phase C 1.23.26–1.23.27. Requested on 2026-11-11; the user kept every phase in this epic and branch.

#### 1.23.10 — The workflow page as a designer: graph canvas in the middle, configuration on the right  `✅ Done`
- **Intent:** a workflow's page looks like a workflow designer: its graph on a central canvas (Start → steps → End, kind badges, zoom), and its configuration, inputs, outputs, run and code in tabs of the right-hand panel.
- **Scope:** plan section 11.2: header with breadcrumb and Execute; the canvas (pure layout function, HTML nodes over SVG connectors, toolbar, pan, selection); the right panel's Workflow, Step, Run and Code tabs; the 1.23.9 run form and result move into Run, with run status chips on the nodes; workflows spec and ui.md 4.4b.
- **Out of scope:** editing workflows; forks and parallel branches; the agent detail's Graph tab (unchanged).
- **Acceptance:** layout unit tests; `@demo @story-1.23.10` (v2 opens as a designer, select Analyse → Step tab, Code tab, run the test workflow from Execute with Done chips on its nodes); the 1.23.5 and 1.23.9 scenarios updated; axe in both themes with the panel open; builds, unit tests and check-specs green.
- **Notes:** from the user's screenshot of a workflow designer (2026-11-11). Frontend only; built first so the run stories add their inputs to the Run tab.

#### 1.23.11 — Chats retired: ADR-0041, epic spec, glossary and roadmap  `✅ Done`
- **Intent:** the retirement of chats is decided and scoped before code. **Scope:** ADR-0041 (Accepted) with its status pointers; the epic spec amendment; this roadmap; glossary terms Run, Run workflow, Past chat. **Acceptance:** check-specs green. **Notes:** plan 1.24.1.

#### 1.23.12 — Streamed runs of agent workflows on the backend  `✅ Done`
- **Intent:** every agent workflow (Assistant, v2, RFP Builder, Data Readiness, user agents) runs once on a typed input with live progress, through today's turn path on a temporary host. **Acceptance:** a run's model request equals a chat turn's for the same input; per plan 1.24.2.

#### 1.23.13 — The answer view, extracted from the chat  `✅ Done`
- **Intent:** the chat's answer rendering (text, data, SQL, visuals, files) becomes a component a run can show, with no visible change. **Acceptance:** per plan 1.24.3. Parallel with 1.23.12.

#### 1.23.14 — Stored runs, the run history API and run files  `✅ Done`
- **Intent:** runs of agent workflows are stored (`workflow_runs`), listed and downloadable. **Acceptance:** per plan 1.24.4.

#### 1.23.15 — Run the Assistant, Questions to Insights v2 and user agents from their page  `✅ Done`
- **Intent:** from the designer's Run tab, ask a question over picked datasets and see the answer, with Follow up carrying one earlier run. **Acceptance:** per plan 1.24.5, with `@demo @story-1.23.15`.

#### 1.23.16 — Run the Data Readiness Agent on a dataset  `✅ Done`
- **Acceptance:** per plan 1.24.6; reports record the run that made them.

#### 1.23.17 — Run the RFP Builder one exchange at a time  `✅ Done`
- **Acceptance:** per plan 1.24.7: one run per exchange keyed by the RFP id, with Continue.

#### 1.23.18 — Move the request-recording E2E specs from chats to runs  `✅ Done`
- **Acceptance:** per plan 1.24.8 (tests only).

#### 1.23.19 — Rate a run's answer: verified queries from runs  `✅ Done`
- **Acceptance:** per plan 1.24.9.

#### 1.23.20 — Monitoring shows runs  `✅ Done`
- **Acceptance:** per plan 1.24.10.

#### 1.23.21 — Runs replace Sessions on the rail; past chats open read-only  `✅ Done`
- **Acceptance:** per plan 1.24.11; no stored session is lost or migrated. Also carries what 1.23.15 left out of plan 1.24.5: reopening a stored run read-only (`run-detail`), Run again, the agent-phases bar inside the agent step, and the Careful mode "Cross-checked" run scenario; and Monitoring's "Sessions" tab, column and filter renamed for runs (left out of 1.23.20).

#### 1.23.22 — Chats can no longer start  `✅ Done`
- **Acceptance:** per plan 1.24.12, including the desktop readiness probe on `GET /health`. Last story of Phase A.

#### 1.23.23 — Try it: run an agent's draft instead of a preview chat  `✅ Done`
- **Acceptance:** per plan 1.25.2.

#### 1.23.24 — Deep analysis as a run workflow  `✅ Done`
- **Acceptance:** per plan 1.25.3.

#### 1.23.25 — Visual actions on a run's result  `✅ Done`
- **Acceptance:** per plan 1.25.4, including the visual card's View in a run's answer (not wired in 1.23.15: the right panel holds the designer).

#### 1.23.26 — Extract the turn engine; evals and dev scripts on run hosts  `✅ Done`
- **Scope now (moved up, wave S2):** only the turn-engine extraction, per [the speed-up contract](docs/plans/m1-23-dev-speedup.md), plan 1.23.26. Evals and dev scripts on run hosts stay for later (plan 1.25.5).
- **Acceptance:** per the speed-up contract: `sessions.service.ts` shrinks by more than 1,500 lines; backend unit and e2e suites, the request-recording Playwright specs and the agent hashes are unchanged.

#### 1.23.26b — Evals and dev scripts on run hosts  `✅ Done`
- **Intent:** the remainder of plan 1.25.5 left out of 1.23.26: evals and the dev scripts stop creating chat sessions and run on run hosts, so 1.23.27 can remove the chat write paths. Contract: [the retire-chats plan](docs/plans/m1-23-retire-chats.md), plan 1.25.5.
- **Acceptance:** evals send each agent the same requests as before (prompt and tool-list hashes equal; one eval case per agent kind run against the recording stub, before and after, with identical requests); no eval or dev script calls `POST /sessions` or the chat stream; backend unit and e2e suites green.

#### 1.23.27 — Remove the chat write paths and specs  `✅ Done`
- **Acceptance:** per plan 1.25.6; past chats stay readable.

Stories 1.23.28–1.23.33 make the development workflow faster and cheaper, and 1.23.26 moves up to run before the rest of Phase A. The user decided on 2026-11-11 to implement every suggestion of the speed-up review on this branch. Contract: [docs/plans/m1-23-dev-speedup.md](docs/plans/m1-23-dev-speedup.md). Waves: S1 = 1.23.28, 1.23.29, 1.23.30, 1.23.31, 1.23.32; S2 = 1.23.26, 1.23.33; then Phase A resumes.

#### 1.23.28 — Lean story lane, model and effort routing, decide-before-build  `✅ Done`
- **Intent:** a story costs a fraction of today's time and tokens. **Scope:** contract section 1.23.28 (CLAUDE.md, the four workflow skills, builder.md, reviewer.md, delivery.md §10/12/13, lessons.md). **Acceptance:** check-specs green; a reviewer finds no contradiction between the documents.

#### 1.23.29 — `story-pack.mjs` and the spec section index  `✅ Done`
- **Intent:** a builder starts from one generated brief instead of exploring. **Acceptance:** contract section 1.23.29.

#### 1.23.30 — Archive finished milestones of the roadmap  `✅ Done`
- **Intent:** `roadmap.md` shrinks from 277 KB to under ~40 KB. **Acceptance:** contract section 1.23.30.

#### 1.23.31 — `qa.mjs --wave`: one verification for several stories  `✅ Done`
- **Acceptance:** contract section 1.23.31.

#### 1.23.32 — Playwright in parallel  `✅ Done`
- **Acceptance:** contract section 1.23.32: 3 workers, three green runs in a row, timings before and after.

#### 1.23.33 — Split `app.ts` / `app.html` by area  `✅ Done`
- **Scope:** [the speed-up contract](docs/plans/m1-23-dev-speedup.md), plan 1.23.33.
- **Acceptance:** `app.ts` under ~500 lines and `app.html` under ~400; no visible or test-id change; the frontend unit suite and the full web Playwright suite pass.

#### 1.23.34 — Remove the RFP Builder and the Intellify RFP API  `✅ Done`
- **Intent:** the RFP Builder agent and the embedded Intellify RFP API it relied on are gone from the app, and the rest of the product behaves as before.
- **Scope:** the contract is in the removal plan: the `rfp` agent and its workflow `agent:rfp` (`GET /agents/rfp` answers `Agent "rfp" not found`, saved pins and overrides are ignored), its tools, seven stage skills, prompts and eval set; endpoints 105 and 127 and the `rfp-package` stream event; `rfpId` and `rfpPackage` on the wire; the run "Continue" feature; the Testing Data fixture `intellify-api`; the embedded Intellify RFP API (`backend/src/intellify-api/`, its env variables, key file, CLI flags `--intellify-api-port` / `--no-intellify-api` and npm script); the `intellify-api` skill; the matching specs, scripts and tests. ADR-0027 and ADR-0028 are marked Superseded.
- **Out of scope:** stored data (sessions, runs and messages that carry `agentKey: "rfp"`, `rfpId` or `rfpPackage` are left in place and ignored, with no migration); the Postgres `rfp` schema; the `intellify` Postgres sample fixture, which stays; every other agent, workflow and feature.
- **Notes:** requested 2026-11-12. Precedent: 1.23.8, Remove the showcase agents.

#### 1.23.35 — Only the Questions to Insights v2 workflow; agents are a library  `✅ Done`
- **Intent:** the Workflows area lists one workflow, Questions to Insights v2, and agents are no longer workflows: they are configured in the Agents area and cannot be run from there.
- **Scope:** the workflow catalogue is `[qti-v2-turn]` (`GET /workflows`, `GET /workflows/:id`); the one-step workflows `agent:<key or id>`, the Sequential test workflow (`seq-text-demo`) and Deep analysis (`deep-analysis`, its module, routes, UI entry point, capability spec and E2E) are removed and their ids answer `Workflow "<id>" not found`; `usedInWorkflows` lists `qti-v2-turn` for `assistant-v2` and nothing for any other agent; the Agents area has no Run on an agent page; the Data Readiness Agent stays in the library and the UI generates no new report; tests that used the test workflow move to `qti-v2-turn` with the stub model; ADR-0042 (ADR-0040 partly superseded) and the specs.
- **Out of scope:** stored data (runs and sessions of removed workflows stay in place, read-only: they list and open as plain runs with no Run again or follow-up, no migration); **Try it** on user agents stays; the agent turn engine and the eval runner for `assistant` and `data-readiness` stay; every other agent and feature.
- **Notes:** requested 2026-11-12. Stacked on 1.23.34 (branch `chore/workflows-v2-only`). Precedent: 1.23.34, Remove the RFP Builder.
---

### Milestone 1.25 — Query inspector: every figure links to its query (M1-25)

A user of Answer a Business Question could not tell how its queries were built and distrusted an answer after seeing a `LIMIT 100`. Each figure in an answer links to the query behind it; each query is explained step by step with a coverage label and its row counts; the full result is one click away. Built once in the shared layer so every agent that answers from data gets it (`CLAUDE.md`, *Rules for both workflows*). Confirmed 2026-11-15 (proposal C of three). Epic spec: [specs/epics/M1-25/spec.md](specs/epics/M1-25/spec.md). Plan and contract: [docs/plans/m1-25-query-inspector.md](docs/plans/m1-25-query-inspector.md). Branch: `jhon-buendia-halo/limit-100-query-proposals`. The number 1.24 is not used: it names plan sections of Milestone 1.23.

#### 1.25.1 — Backend evidence layer: row totals, coverage, table sizes, re-run and CSV  `✅ Done`
- **Intent:** every data-gathering tool call of an answer is stored with the facts that say how much data it stands for, with no change to what any model receives.
- **Scope:** per plan 1.25.1, on the contract of plan section 2 and the decisions of plan section 3: `totalRows` from the three connectors; the facts passed beside the tool result; `ChatMessage.evidence` derived at persist; the pure modules `query-coverage`, `query-tables`, `query-evidence`; `QueryEvidenceService`; the lock per run; endpoints 139, 142 and 143; api.md 139 to 143, data-model.md, agents.md.
- **Out of scope:** the frontend; the explainer and endpoints 140 and 141 (1.25.3); any prompt, tool description or `ToolDataRecord` field; the Answer a Business Question workflow files.
- **Acceptance:** `query-coverage.spec.ts` (the six cases of plan 1.25.1); a `run_readonly_sql` result has no `totalRows` key; a turn's stored answer has one `evidence` entry per data record; 139 sizes each table once and runs nothing when called again; 142 stores nothing; 143 answers CSV with `X-Rows-Cut` when cut; rating an answer (128) still works through the lock.
- **Notes:** no UI. Wave 1, parallel with 1.25.2. Opus: it touches the turn path every agent uses.

#### 1.25.2 — Answer view: figure chips, coverage line and query rows  `✅ Done`
- **Intent:** in a host that turns the inspector on, each figure of an answer shows which query it came from, and the answer's queries are listed with their coverage.
- **Scope:** per plan 1.25.2, on plan section 2 (2.4 test ids, 2.5 copy) and plan section 3 (3a): `figure-refs.ts`, `query-labels.ts`, the `query-evidence-summary` component, `renderMarkdown`, the answer view's `queryInspector` input and `inspectQuery` output, the chip styles; the query inspector's rules in the agent-answers spec and its section in ui.md.
- **Out of scope:** `features/workflows/` and the inspector sheet (1.25.4); the backend; any visible change when `queryInspector` is false.
- **Acceptance:** `figure-refs.spec.ts` (the cases of plan 1.25.2); with `queryInspector` true the answer view shows chips, the coverage line and one row per query, and emits `inspectQuery` with the record index on a chip or a row; with it false, `answer-view.spec.ts` passes unchanged.
- **Notes:** UI story, but no host turns the mode on until 1.25.4: its scenario is 1.25.4's, so write unit tests only and no Playwright test. Wave 1, parallel with 1.25.1.

#### 1.25.3 — The query explainer and the step counts  `✅ Done`
- **Intent:** opening a query explains it step by step in business words, and exact row counts per step are shown only when they can be verified.
- **Scope:** per plan 1.25.3, on plan section 2 (2.3, 2.5) and plan section 3 (3f): the System agent `query-explainer` (Hannah), `explanationOf`, `showStep`, `fallbackExplanation`, `checkStageCounts`, `MastraService.explainQuery`, endpoints 140 and 141; agents.md.
- **Out of scope:** the frontend's source; the Answer a Business Question workflow and its prompts; evals for the new agent.
- **Acceptance:** the `checkStageCounts` and `explanationOf` cases of plan 1.25.3; 140 stores the explanation once and a second call makes no model request; a reply that is no JSON object stores the code-built steps with `fallback: true`; 141 stores `unverified` with its reason and no step count when a check fails; `agent-personas.spec.ts` lists the new persona.
- **Notes:** no UI. Wave 2, after 1.25.1, parallel with 1.25.4. Edit the sql cards of `frontend/e2e/agent-hub.spec.ts` without running Playwright: the lead's wave check runs it.

#### 1.25.4 — The inspector and its Run panel host  `✅ Done`
- **Intent:** from an answer of Answer a Business Question, a chip or a query row opens the query inspector beside the answer: its steps, its result and its SQL, with download, re-run and copy.
- **Scope:** per plan 1.25.4, on plan section 2 (2.4, 2.5) and plan section 3 (3b, 3c): the `query-inspector` component, `rows-csv.ts`, the run adapter of `QUERY_EVIDENCE_API`, the API methods for 139 to 143, the designer's open query state and `prepare()`, the sheet on the workflow page, the Run panel turning the mode on; the Playwright assertions of plan section 4; ui.md 4.4b, the workflows spec, the datasources spec.
- **Out of scope:** the backend; other hosts of the answer view.
- **Acceptance:** `workflow-runs.spec.ts` with `@demo @story-1.25.4`: run a question, see a chip after a figure and the coverage line, open the query from the chip, read its last step, switch to Result and SQL, copy the SQL, close with Escape and get the focus back on the chip; the Playwright specs listed in plan section 4 pass with the new copy; the designer and inspector unit tests of plan 1.25.4.
- **Notes:** UI story. Wave 2, after 1.25.2, parallel with 1.25.3. The stub model's reply to the explainer is no JSON object, so the scenario reads the code-built steps (Start from, Show).

#### 1.25.5 — The run detail page hosts the inspector  `✅ Done`
- **Intent:** a stored run of Answer a Business Question opened from the Runs page shows the same figure chips, coverage line, query rows and inspector as the Run panel, so a past answer can be checked the same way.
- **Scope:** `features/runs/components/run-detail/`: the answer view in inspector mode for a run of Answer a Business Question (with its question), `prepare()` once when the run is shown, an adapter of `QUERY_EVIDENCE_API` over the run shown (the same endpoints 139 to 143), and the inspector as a sheet at the right of the page (at most 720 px, the rules of plan section 3b for focus and Escape); ui.md (the run detail page), the workflows spec's rule for the inspector.
- **Out of scope:** the backend; a user agent's Try it, past chats and the Data Readiness Agent; any change to the inspector component beyond what a second host needs.
- **Acceptance:** `run-detail.spec.ts`: a stored run of Answer a Business Question shows chips and query rows and opens the inspector from a row; a run of another workflow renders as before; `prepare` is called once per run shown.
- **Notes:** found on 2026-11-15 while checking the real app: the Runs page opened a stored run on this page, not on the workflow page. Since PR #108 (merged the same day) a finished run opens on its workflow page, whose Run panel already has the inspector, so this page shows the inspector only for a run of Answer a Business Question that is still running when opened. UI story; its Playwright check is one step added to 1.25.4's scenario (open the run from the Runs page and see a chip).

#### 1.25.6 — An answer that lists more than 50 rows shows all of them  `✅ Done`
- **Intent:** when the answer is a list longer than what Write answer reads (50 rows of each query), the answer shows every row instead of stopping at row 50 and saying the rest is missing.
- **Scope:** per plan 1.25.6 (approach B of three, picked by the user on 2026-11-15: the code writes the table). Jessica writes the headline and the commentary and puts a marker line `[[rows:<n>]]` where the full list goes; code replaces it with a Markdown table of that query's rows (at most 200, with a note when there are more). An attempt's queries carry up to 200 rows; the request still shows the first 50 and says how many there are. The marker never reaches the streamed text. agents.md 5.11 and Appendix F, the workflows spec R27.
- **Out of scope:** results over 200 rows in the answer itself (the note points at the inspector's download); any new step, agent or control flow.
- **Acceptance:** the cases of plan 1.25.6; the contract snapshot updated on purpose; the insights-analyst evals compared with base before the change is called done. Evals (2026-11-15, `claude-sonnet-5-5`, 10 cases, 3 runs per build): every code check passed in every run that reached the model, and the judged cases passed as often as on the base once the marker rule was narrowed (plan 1.25.6, note); two runs were lost to upstream errors of the model endpoint and one to the model calling a tool that does not exist, each re-run 3 of 3.
- **Notes:** found on 2026-11-15 with the inspector in the real app: `Which 100 drivers have the most race starts?` returned 102 rows and the answer read `Ranks 51 to 102 are missing from the results I received`. No UI of its own: the table is Markdown, so every host shows it and its figures get chips.

#### 1.25.7 — Validate fails an attempt that rests on a sample  `✅ Done`
- **Intent:** an analysis whose only evidence is an arbitrary sample of rows (a `LIMIT` with no `ORDER BY` that was reached) is run again instead of being written up.
- **Scope:** per plan 1.25.7: a fourth failing check in `validateAttempt`, `No answer from a sample`, with `coverageOf` (1.25.1); the retry block and Write answer's findings carry it; agents.md 5.11, the workflows spec R27.
- **Out of scope:** the bridge's `truncated` flag (it still reads a result that lands exactly on the tool's row limit as cut; see the plan's note); the `sample_rows` tool, which is exploration and never fails the check.
- **Acceptance:** the cases of plan 1.25.7; the insights-analyst evals of 1.25.6's run cover it.
- **Notes:** confirmed in code on 2026-11-15: `SELECT … LIMIT 50` with no sort, under the tool's limit of 100, passed Validate with only a warning to the model.

#### 1.25.8 — The SQL bridge flags a result as cut only when rows were dropped  `✅ Done`
- **Intent:** a result that lands exactly on the row limit with nothing dropped (a `LIMIT 100` under the default limit of 100) is no longer told `row limit reached` nor warned as cut short.
- **Scope:** per plan 1.25.8: `truncated`, the note and the `row-cap-reached` warning follow the connector's `totalRows`; agents.md 3.4, agent-answers R28.
- **Out of scope:** a connector that reports no `totalRows` (a full page still reads as cut).
- **Acceptance:** the bridge and tool tests of plan 1.25.8; the evals of `assistant`, `insights-analyst` and `data-readiness` compared with base, 3 runs per case per build.
- **Notes:** no UI. It changes a tool result three agents' models read.

#### 1.25.9 — Answer evidence for a session's message and for a draft run  `✅ Done`
- **Intent:** the inspector's backend works for any answer the app can show, not only a stored run's: a past chat's message and a Try it run.
- **Scope:** per plan 1.25.9 on the decisions of plan section 5: `AnswerEvidenceService` over an answer host; the draft run kept in memory for 30 minutes behind 139 to 143; endpoints 144 to 148 for a session's message; `evidence` derived on read of a session; api.md, data-model.md, past-chats and agents-evals specs.
- **Out of scope:** the frontend; any model input; the workflow files; storing a draft run.
- **Acceptance:** the tests of plan 1.25.9, the existing tests of 139 to 143 unchanged and green, and a negative test for each access rule.
- **Notes:** no UI. Opus: it moves code every stored run's evidence goes through.

#### 1.25.10 — Past chats host the inspector  `✅ Done`
- **Intent:** an answer in a past chat, of any agent, shows its figure chips, coverage and queries and opens the inspector, as a run does.
- **Scope:** per plan 1.25.10: the session chat in inspector mode, the adapter over 144 to 148, the sheet; ui.md, past-chats and agent-answers specs.
- **Out of scope:** the backend; Try it; any change to a past chat being read-only for the user.
- **Acceptance:** `session-chat.spec.ts` (chips and query rows on an assistant message with data, the question passed, the inspector opens from a row and closes with Escape, prepare on the last answer once); then, in round 2, a Playwright scenario tagged `@story-1.25.10` on a stored session.
- **Notes:** UI story. The Data Readiness Agent's stored sessions are past chats: covered here.

#### 1.25.11 — Try it hosts the inspector  `✅ Done`
- **Intent:** a user agent's answer in Try it, the only place such an agent runs, shows its evidence through the same inspector.
- **Scope:** per plan 1.25.11: Try it in inspector mode on the draft's run id, the expired-preview message, the sheet over the editor; ui.md 4.5.1, agents-evals R60 and R61.
- **Out of scope:** the backend; storing a draft run.
- **Acceptance:** `agent-try-it.spec.ts` (inspector mode on an answer with data, the run id from the stream drives the calls, a 404 shows the expired message); then, in round 2, a Playwright scenario tagged `@story-1.25.11`.
- **Notes:** UI story.

#### 1.25.12 — Evals for the query explainer  `✅ Done`
- **Intent:** a change to Hannah's instructions or model can be measured: her steps are checked on real statements, and her counts against real data.
- **Scope:** per plan 1.25.12: the eval set `query-explainer` on the World Cup fixture, its target and checks, its listing under the agent's Evals tab and in the CLI; agents.md 2.12 and 8.
- **Out of scope:** Hannah's instructions; any other agent's set.
- **Acceptance:** each check unit-tested on one real answer; `EVAL_SET=query-explainer` runs from the CLI; the set passes 3 of 3 runs on the code checks and at least 2 of 3 on each judged case, or the failing case is reported with its reason.
- **Notes:** no UI of its own.

### Milestone 1.26 — Background tasks survive navigation (M1-26)

Saving a dataset disappeared when the user opened another screen, and the dataset showed up only once the save ended; twenty slow operations behaved the same way, some were even cancelled. Long work the user starts now runs as a background task owned by the shell: a **Background tasks** button in the rail beside System logs lists what runs and what ended, the screen shown again reads its state back, and a toast offers **Open** or **Retry** at the end. Requested and confirmed with a prototype on 2026-11-15 (Free style). Epic spec: [specs/epics/M1-26/spec.md](specs/epics/M1-26/spec.md). Plan and contract: [docs/plans/m1-26-background-tasks.md](docs/plans/m1-26-background-tasks.md). ADR-0047.

#### 1.26.1 — The background tasks layer and the rail indicator  `🚧 In progress`
- **Intent:** one place where long work lives and can be seen, whatever screen is shown.
- **Scope:** per plan 1.26.1: `BackgroundTasksService`, the rail button and its panel, toast actions; app-shell R30, R37, R58–R63; ui.md 1.3, 3.3, 3.7, 5.1, 5.3; ADR-0047.
- **Out of scope:** wiring any operation (1.26.2–1.26.5); storing tasks across a reload.
- **Acceptance:** `background-tasks.service.spec.ts` (the work survives at the root, no duplicate start, failure and Retry, progress, Stop, Open, the cap of 20).

#### 1.26.2 — Saving a dataset and loading an inventory run in the background  `🚧 In progress`
- **Intent:** the reported case: a dataset being saved appears in the Datasets list at once and stays visible while the user works elsewhere.
- **Scope:** per plan 1.26.2 and section 4: the save returns to the list with a pending row; the inventory load is no longer cancelled by leaving; datasets spec.
- **Out of scope:** the backend.
- **Acceptance:** unit tests for the pending row, the save task and the re-created catalog browser.

#### 1.26.3 — Testing Data, ontology suggestions and the synthetic profile run in the background  `🚧 In progress`
- **Intent:** the Settings and dataset-editor operations keep running and keep their result when the user leaves.
- **Scope:** per plan 1.26.3; testing-data, dataset-ontology and synthetic-data specs.
- **Out of scope:** test connection, script and export downloads.
- **Acceptance:** unit tests: the busy state survives re-creating each screen and the result is applied after it.

#### 1.26.4 — Visual tailor and refresh, and eval runs, run in the background  `🚧 In progress`
- **Intent:** a visual being tailored and an eval run stay visible and land when the user is elsewhere; eval polling no longer leaks after the agent page closes.
- **Scope:** per plan 1.26.4; visuals and agents-evals specs.
- **Out of scope:** the automatic visual repair; eval jobs started before an app reload.
- **Acceptance:** unit tests: busy state and result across re-creation; polling stops at the terminal status and with no timer left.

#### 1.26.5 — Workflow runs keep running when the user leaves their page  `🚧 In progress`
- **Intent:** leaving a workflow's page, reloading or closing the window no longer stops its run; the run shows in Background tasks and the page re-attaches to it with the live view it had.
- **Scope:** approach A of three (picked by the user on 2026-11-15): a backend registry of live runs with a numbered event log; the start, follow-up and resume streams detach from their connection; a re-attach stream and a Stop endpoint; the designer re-attaches and Stop calls the endpoint; `workflow-run` tasks polled through 121, registered at start-up for runs still running; api.md, workflows spec, ADR-0048.
- **Out of scope:** surviving a backend restart (R20 unchanged); draft runs (Try it) and a step's chat keep stopping when their connection closes.
- **Acceptance:** Jest tests for the registry and the two routes; Karma tests for the designer (leaving does not abort, Stop calls the endpoint, re-attach rebuilds the live view); a Playwright scenario: start a run, leave, the rail counts it, return, the live view is there, the answer lands.
- **Notes:** rejected: B (Mastra's `watch`/`cancel`, internal API, every agent step rewritten, evals), C (frontend-only, a reload stops the run, 6 connections per origin).

## Release 2 — Multi-user  (no target date yet)

The app becomes multi-user. An organisation self-hosts it as an org server, with sign-in, roles and an admin panel. Local mode stays the default. Direction: [specs/product/vision.md](specs/product/vision.md). Not part of the 1.0 Beta.

### Milestone 2.1 — Admin Panel ([BA-161](https://halo-powered.atlassian.net/browse/BA-161)) — archived, see roadmap-archive.md

## Backlog

Open stories and unsequenced plans live in [roadmap-backlog.md](roadmap-backlog.md); `qa.mjs`, `story-pack.mjs`, `demo-page.mjs` and `check-specs.py` read it.
