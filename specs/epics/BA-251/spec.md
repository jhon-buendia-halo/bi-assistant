# BA-251 — Data Readiness Agent

- **Jira:** [BA-251](https://halo-powered.atlassian.net/browse/BA-251) · **Roadmap:** Milestone 1.16 · **Status:** Confirmed (by the user on 2026-11-03)

## Goal

A user can ask a new Official agent, the **Data Readiness Agent**, how ready a connected Postgres or Databricks datasource is for analysis, and get a scored, explainable answer. The assessment follows the DMBOK data-quality dimensions and is ported from the deterministic engine of the separate `data-readiness-agent` project. **Every score and finding comes from that deterministic engine. The LLM only runs the assessment and explains the stored report. It never computes, adjusts or invents a score.** Every assessment is saved, so the user can reopen past reports and compare them.

## Scope

- **Engine.** A pure, deterministic engine reads a *source profile*: pre-aggregated statistics per table, column, key and relationship. It runs eight checks: completeness, validity, consistency, uniqueness, integrity, accessibility, timeliness and reasonability.
  - Each check yields findings with a severity: info, low, medium or high.
  - Dimension score: `100 × (1 − Σ weight / checks run)`, with weights info 0, low 0.1, medium 0.4 and high 1.0. A dimension with no checks scores 100.
  - Overall score: the unweighted mean of the assessed dimensions. Its maturity band is Optimised (≥ 95), Managed (≥ 85), Defined (≥ 70), Repeatable (≥ 50) or Initial.
  - Accuracy and currency are listed but *not assessed*.
  - Thresholds are fixed at the reference defaults: completeness medium 10 % and high 50 % nulls; dates before 1900 are ancient; data is stale after 365 days.
  - The current time is an input, so the same profile at the same time always gives the same report.
- **Profiling.** Postgres and Databricks connectors gain aggregate-only profiling queries: column stats, declared keys, duplicate counts, orphan counts, invalid-format counts, normalized distinct counts and table privileges.
  - Adapters turn those queries into a source profile. They infer format rules from column names and infer joins from naming patterns.
- **Saved reports.** Each assessment is stored with its datasource, time, scores and findings. Reports can be listed per datasource and read by id through the API.
- **Agent.** The new Official agent `data-readiness` has three tools: run an assessment, read a report, and list reports. It has one skill.
  - Start chat needs a session dataset backed by Postgres or Databricks. Otherwise it is disabled and shows the reason.
- **UI.**
  - A chat card and a right-panel **scorecard**: overall score and band, one bar per dimension (accuracy and currency greyed as not assessed), and a findings table filterable by dimension and severity.
  - A **Past assessments** list that opens a saved report in the same scorecard.
- **Fidelity.** A golden conformance suite, copied from the reference project's labelled corpus, proves the port meets the reference precision and recall floors.

## Out of scope

- Editable thresholds or any Settings page for the engine.
- Per-finding provenance (rule id, formula and evidence query), and marking findings as false positives.
- MongoDB and REST datasources.
- Quality-rule derivation and exports (dbt, Soda, Great Expectations).
- The reference project's LLM features: readiness brief, quality rules, model assessment, insights narrative and NL-to-SQL.
- Scheduling or automatic re-assessment.

## Stories

| Story | Summary | Roadmap feature |
|---|---|---|
| [BA-252](https://halo-powered.atlassian.net/browse/BA-252) | Scoring and check engine | 1.16.1 |
| [BA-253](https://halo-powered.atlassian.net/browse/BA-253) | Completeness, validity, consistency and uniqueness checks | 1.16.2 |
| [BA-254](https://halo-powered.atlassian.net/browse/BA-254) | Integrity, accessibility, timeliness and reasonability checks, plus join inference | 1.16.3 |
| [BA-255](https://halo-powered.atlassian.net/browse/BA-255) | Golden conformance suite from the reference corpus | 1.16.4 |
| [BA-256](https://halo-powered.atlassian.net/browse/BA-256) | Postgres profiling queries | 1.16.5 |
| [BA-257](https://halo-powered.atlassian.net/browse/BA-257) | Databricks profiling queries | 1.16.6 |
| [BA-258](https://halo-powered.atlassian.net/browse/BA-258) | Source profile adapters for Postgres and Databricks | 1.16.7 |
| [BA-259](https://halo-powered.atlassian.net/browse/BA-259) | Saved assessment reports and API | 1.16.8 |
| [BA-260](https://halo-powered.atlassian.net/browse/BA-260) | Agent, prompt, skill and tools | 1.16.9 |
| [BA-261](https://halo-powered.atlassian.net/browse/BA-261) | Agent catalogue and chat session wiring | 1.16.10 |
| [BA-262](https://halo-powered.atlassian.net/browse/BA-262) | Scorecard panel and chat card | 1.16.11 |
| [BA-263](https://halo-powered.atlassian.net/browse/BA-263) | Past assessments history | 1.16.12 |

## Specs touched

- New [capabilities/data-readiness](../../capabilities/data-readiness/spec.md): concepts, rules, Gherkin flows.
- [capabilities/agents-evals](../../capabilities/agents-evals/spec.md): the Official agents list and the Start chat requirement.
- [capabilities/sessions-chat](../../capabilities/sessions-chat/spec.md): R52, R61, R64 (the new agent's sessions, its panel item kind `readiness` and the Agent picker).
- [system/architecture.md](../../system/architecture.md): a new ADR. The deterministic engine owns all scores, and profiling queries are a connector capability outside the user SQL path.
- [system/agents.md](../../system/agents.md): the registry row, a new agent section, the tool contracts, the skill, the prompt appendix, and the evals.
- [system/api.md](../../system/api.md): the three `/data-readiness/assessments` routes, and the stream event `readiness-report`.
- [system/data-model.md](../../system/data-model.md): the `readiness_reports` collection.
- [system/ui.md](../../system/ui.md): the scorecard panel, the chat card and Past assessments.
- [product/glossary.md](../../product/glossary.md): data readiness, readiness dimension, maturity band, finding.

## Acceptance

- `python3 scripts/check-specs.py`, backend and frontend unit tests, lint and builds are green.
- The engine reproduces the reference scoring numbers and meets the reference precision and recall floors on the copied golden fixtures.
- Assessing the World Cup Postgres sample through the API or the agent stores a report. In that report, the overall score is the mean of the eight assessed dimension scores.
- In the app, the Data Readiness Agent appears as an Official agent. A chat on a Postgres-backed dataset that asks for an assessment shows the scorecard with the same numbers as the API. Past assessments lists every report for the datasource and reopens one.
- Start chat is disabled, with its reason, when no Postgres or Databricks dataset exists.
- A new Playwright spec `data-readiness.spec.ts` passes on the web target. The agent's new eval set passes at 100 %, each case 3 of 3.

## Dependencies, risks and open questions

- **Depends on** the Postgres and Databricks connectors (Milestone 1.5), the Agent Hub and built-in session agents (Milestone 1.9, ADR-0008), and built-in prompt overrides (ADR-0026).
- **Risk: full-table aggregates.** Profiling runs COUNT and DISTINCT aggregates over whole tables, as the reference does, so a large Databricks table can be slow. Each statement has a timeout, and a table that times out is reported, not fatal.
- **Risk: time-dependent results.** Timeliness and reasonability depend on the current date. The engine takes the time as an input so tests are stable, but live scores still drift as data ages.
- **Risk: parallel build.** The epic is built by 12 parallel units against a shared contracts scaffold, then merged on this branch, so integration conflicts are resolved at merge time.
- **Open question:** none at this time.
