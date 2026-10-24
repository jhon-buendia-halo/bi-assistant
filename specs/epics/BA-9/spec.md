# BA-9 — Golden Dataset and Evals

- **Jira:** [BA-9](https://halo-powered.atlassian.net/browse/BA-9) · **Roadmap:** Milestone 1.1 · **Status:** Confirmed by the user on 2026-10-13, rewritten to the scope of the execution plan ([BA-128](https://halo-powered.atlassian.net/browse/BA-128)). Scope extended on 2026-10-20 with a supervised improvement loop ([BA-242](https://halo-powered.atlassian.net/browse/BA-242)) and investigation questions ([BA-243](https://halo-powered.atlassian.net/browse/BA-243)), confirmed by the user the same day.
- **Research:** [docs/research/BA-9.md](../../../docs/research/BA-9.md) ([BA-127](https://halo-powered.atlassian.net/browse/BA-127)) · **Plan:** [docs/plans/BA-9.md](../../../docs/plans/BA-9.md) ([BA-128](https://halo-powered.atlassian.net/browse/BA-128)) · **ADR:** ADR-0015 in [architecture.md](../../system/architecture.md)

## Goal
Know, with numbers, whether a change made answers better or worse, on every datasource kind the app supports: PostgreSQL, Databricks and REST. One golden dataset of questions with known-correct answers on fixtures we control, scored first by deterministic checks that cost no tokens, with the LLM judge as a run option. It runs throughout October so every change to the DSL ([BA-2](../BA-2/spec.md)), the knowledge store ([BA-4](../BA-4/spec.md)) and the connectors ([BA-5](../BA-5/spec.md)) is measured before the beta ships. The manager's priority (2026-10-12): as many evals as possible for Databricks and REST. After the beta, the same runner and report give users a number they can trust on their own data.

## Scope
- **One format.** The three eval harnesses on `main` folded into the in-app suite; cases as data files with one reference query per dialect, and a validator that runs every reference with no model call (ADR-0015).
- **Deterministic first.** Checks tied to a criteria list; a report per category and per criterion; the judge as a run option, off by default, with judge-only checks reported as not scored.
- **Three fixture families on every kind** (decided 2026-10-13): World Cup, **finance** (the branch's banking domain extended to finance and wealth) and **marketing analytics** (new, the marketing-insight product), each on PostgreSQL, Databricks and REST, loaded from one PostgreSQL source through a JSON dump so the rows are identical on every kind; `samples.tpch` as a Databricks smoke set.
- **Databricks.** A loader that takes any fixture's dump into a Unity Catalog schema, register-only fixtures the preflight accepts, and Databricks-only cases.
- **REST.** Server variants of the local API that page, nest, cap, refuse and require a token, the same server serving the domain dumps, and REST-only cases.
- **Breadth and depth.** Health insurance, genomics and supply chain brought over from the local branch on PostgreSQL as they are; World Cup and finance growing toward 100 questions and marketing analytics toward 60, split into dev and held-out.
- **Numbers you can trust.** Repeats with intervals, tokens, cost and latency, and a nightly CI run on PostgreSQL.
- **A supervised improvement loop** (added 2026-10-20, [BA-242](https://halo-powered.atlassian.net/browse/BA-242)). Before the beta, the loop of plan 3.6 runs with a person deciding every change: triage of dev failures, one lever per round (prompt, tool descriptions and errors, context, knowledge), accept or revert on dev and held-out. Locks keep the loop from editing sets, checks, thresholds or facts, a leak check rejects changes that quote the sets, and the fixer reads a dev-only export, never a held-out case.
- **Investigation questions** (added 2026-10-20, [BA-243](https://halo-powered.atlassian.net/browse/BA-243)). Questions that ask why something happened, scored with deterministic checks against a story planted in the fixture data, with a planted wrong explanation. A person writes and approves each brief and the held-out wording.
- **Trust in the judge and comparisons.** Judge agreement measured against human labels; arms (knowledge on and off, model comparison); component checks and two-turn tasks.
- **After the beta: evals on the user's own data.** A user eval set per dataset fed by verified queries, templates from the schema and model drafts a person approves, and the eval set carried in the agent bundle.

## Out of scope
- Customer data in the developer suite: it runs on fixtures we control. A masked copy of a real dataset is a later privacy decision.
- A wholesale merge of `feat/engine-eval-loop` or `feat/knowledge-learning-evals`; expert mode, learning and memory belong to other epics.
- The HR and retail domains, which carry expert-mode and learning fields.
- Databricks in the nightly CI run, because of cost; Databricks runs are on demand.
- Unattended automation of the improvement loop: until after the beta it runs supervised, with a person accepting every change ([BA-242](https://halo-powered.atlassian.net/browse/BA-242)), and from 2026-10-23 with the lead session deciding keep and accept on the user's delegation ([BA-244](https://halo-powered.atlassian.net/browse/BA-244)); approval by more than one reviewer; export as a Genie benchmark; evals on documents an agent reads.

## Stories
The two process stories come first; five stories cover the plan's steps; two more were added on 2026-10-20 (BA-242, BA-243), and two on 2026-10-23 (BA-244, BA-245). [BA-212](https://halo-powered.atlassian.net/browse/BA-212), the Intellify sample, was built under this epic on its own branch and shipped on `main` in PR #77 (roadmap 1.1.19, Done); it came onto this branch when `main` was merged in on 2026-10-15.

| Story | Summary | Roadmap features |
|---|---|---|
| [BA-127](https://halo-powered.atlassian.net/browse/BA-127) | Research | 1.1.2 |
| [BA-128](https://halo-powered.atlassian.net/browse/BA-128) | Execution plan | 1.1.3 |
| [BA-182](https://halo-powered.atlassian.net/browse/BA-182) | Foundation: one format, deterministic checks, report by category, domain databases (Steps 1a-1d) | 1.1.4-1.1.7 |
| [BA-186](https://halo-powered.atlassian.net/browse/BA-186) | Databricks and REST evals (Steps 2-3) | 1.1.8-1.1.9 |
| [BA-188](https://halo-powered.atlassian.net/browse/BA-188) | More questions and numbers you can trust (Steps 4-5) | 1.1.10-1.1.11, 1.1.24-1.1.25 |
| [BA-190](https://halo-powered.atlassian.net/browse/BA-190) | Judge validation, arms and component checks (Steps 6-8, after the beta) | 1.1.12-1.1.14 |
| [BA-193](https://halo-powered.atlassian.net/browse/BA-193) | Evals on the user's own data (Steps 9-12, after the beta) | 1.1.15-1.1.18 |
| [BA-212](https://halo-powered.atlassian.net/browse/BA-212) | Intellify sample as a Testing Data fixture (Done; shipped on `main` in PR #77) | 1.1.19 |
| [BA-242](https://halo-powered.atlassian.net/browse/BA-242) | Supervised improvement loop (before the beta) | 1.1.20 |
| [BA-243](https://halo-powered.atlassian.net/browse/BA-243) | Investigation questions with planted insights | 1.1.21 |
| [BA-244](https://halo-powered.atlassian.net/browse/BA-244) | Improvement loop rounds 10 onward, and rule A40 on a second model | 1.1.22 |
| [BA-245](https://halo-powered.atlassian.net/browse/BA-245) | E2E coverage of the improvement loop's behaviour | 1.1.23 |

The 15 step stories created on 2026-10-13 (BA-182 to BA-196) were compacted to these five the same day at the user's request; the ten merged issues (BA-183, BA-184, BA-185, BA-187, BA-189, BA-191, BA-192, BA-194, BA-195, BA-196) are closed as duplicates of their story and taken out of the epic. Record: [evidence/1.1.3/jira-compaction.tsv](../../../evidence/1.1.3/jira-compaction.tsv).

## Specs touched
- **Capabilities:** [agents-evals](../../capabilities/agents-evals/spec.md) (criteria and categories, run options `judge`, `repeats` and `arm`, reports by category and criterion, user sets, Gherkin); [testing-data](../../capabilities/testing-data/spec.md) (the Databricks fixture, register-only kinds; the Intellify sample, BA-212); [sessions-chat](../../capabilities/sessions-chat/spec.md) (verified queries and corrections becoming cases, Step 9).
- **System:** [data-model](../../system/data-model.md) (the case shape; `eval_runs` gains repeats, arm, judge settings, human verdict, usage and tool-call count; the `eval_sets` collection in Step 9); [api](../../system/api.md) (run options; user set endpoints); [agents](../../system/agents.md) (judge rubric versioning; the Databricks dialect note; the eval-bootstrap agent in Step 11); [ui](../../system/ui.md) (category chip and summary, the Pass / Fail control, "Your sets"); [delivery](../../system/delivery.md) (REST server switches, `eval:validate`, the nightly workflow); [architecture](../../system/architecture.md) (ADR-0015).

## Acceptance
- **By the beta (2026-10-30), the minimum:** Steps 0, 1a to 1d, 2, 3, and the nightly run of Step 5. World Cup, finance and marketing analytics run on demand on PostgreSQL, Databricks and REST, the two domains with at least 30 questions each; it reports per question, per category and per criterion; runs compare with the previous run; the judge is off by default and judge-only checks show as not scored; a nightly PostgreSQL run fails on any regression.
- The beta thresholds are written in the agents-evals spec and agreed by 2026-10-23 (proposal in plan 3.9).
- A knowledge on and off comparison by category is one report (Step 7), which answers [BA-80](https://halo-powered.atlassian.net/browse/BA-80)'s acceptance.
- The judge agrees with human labels on at least 90% of passes and of fails before its verdict counts (Step 6).
- Steps 9 to 12 meet the done-when of each step in the plan.
- **By the beta, the loop (BA-242):** its tooling is in, and a baseline plus at least three supervised rounds (on gpt-4o-mini, then on gpt-5.6-luna from 2026-10-21) are recorded with dev and held-out side by side, each accepted change committed with its eval diff.
- **Investigation questions (BA-243):** at least two approved briefs, each with dev and held-out questions and validated references, run in the loop's rounds.

## Dependencies, risks and open questions
- **Databricks access** exists inside a VDI (2026-10-13). Step 2 is built here without a warehouse; its runs on a real warehouse are validated later in the VDI, from a copy of the repository. Until then, Databricks results are unverified.
- **Decided on 2026-10-13** (by Claude on the user's delegation; [decision record](../../../evidence/1.1.3/decisions.md)): the branch work comes over by copying the data by path and rebuilding the wiring on `main`; the fixtures are World Cup, finance and marketing analytics on all three kinds, with `samples.tpch` as a smoke set, and health insurance goes to Databricks after the beta. By the user, the same day: Databricks is validated later in the VDI, and the two domains are synthetic, written by Claude with no business review.
- **Open decisions, with dates** (plan 3.0): one PR at the end of the epic or an early PR after Step 1c (2026-10-16; recommendation: the early PR, so BA-2, BA-4 and BA-5 can measure against the suite); the beta thresholds (2026-10-23); who labels the judge validation set (after the beta).
- **The baseline on `main`** (six runs, action 3 in plan 3.0) is taken before any change; every later step compares with it.
- **Time:** with the two domains, the minimum is about 19 to 24 days of work against the 14 working days from 2026-10-13, so it fits only if Claude runs the domain work in parallel with the other steps. What moves after the beta, and in which order, is in plan 3.0.
- **Cost:** real numbers need an LLM key and spend tokens; the judge is off by default, Databricks runs are on demand.
- **The loop's model** (the user's choice, 2026-10-20): gpt-4o-mini, until Anthropic API keys are available. Fixes in the app (context, tool errors) are expected to carry over to other models; prompt rules accepted on gpt-4o-mini are re-measured on any other model before they count there. Budget: about $25 at most to the beta at 34,000 tokens per attempt (plan 3.6), standard OpenAI prices read on 2026-10-20. Changed by the user on 2026-10-21, after two rounds on gpt-4o-mini: gpt-5.6-luna at low reasoning effort, chosen from a probe of 31 dev questions at one attempt each (gpt-4o-mini passed 16% of its baseline attempts on them, gpt-5.6-luna 71%, gpt-6-luna 58%, gpt-5-mini 32%), at about the same cost per full run as gpt-4o-mini's measured $1.44.
- **ADR number:** ADR-0013 and ADR-0014 are claimed on other branches; re-check that 0015 is free when this branch merges. Re-checked on 2026-10-15, when `main` (v0.34.0) was merged in: `main` has ADR-0001 to ADR-0012 and ADR-0018 to ADR-0030, so 0015 is still free.
- The Phase 1 plan's golden-set item ([phase-1-answer-reliability](../../../docs/plans/phase-1-answer-reliability.md), Workstream C) is covered by Steps 1a and 5.
