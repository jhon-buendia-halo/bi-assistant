# BA-9 — Golden Dataset and Evals

- **Jira:** [BA-9](https://halo-powered.atlassian.net/browse/BA-9) · **Roadmap:** Milestone 1.1 · **Status:** Draft — confirmation waived by the user on 2026-10-04 (one-time exception); work on its stories may start

## Goal
Know, with numbers, whether a change made answers better or worse. A golden dataset of representative questions with known-correct answers on the sample fixtures, and an eval suite (LLM judge plus SQL and result checks) that runs against it. It runs throughout October so every change to the DSL, knowledge store or connectors is measured before the beta ships.

## Scope
- The golden dataset: questions with known-correct answers on the sample fixtures, grouped by category.
- An eval suite on demand with per-question and per-category results, run-to-run comparison and a knowledge on/off comparison.
- Built on the existing `assistant-eval-judge` agent, `mastra/evals/` and the Agents, Evals tab.

## Out of scope
- Evals on customer data.

## Stories
Jira lists **no child issues**; the roadmap mirrors the epic as one feature.

| Story | Summary | Roadmap feature |
|---|---|---|
| — | Golden dataset and eval suite | 1.1.1 |

## Specs touched
- Capabilities: [agents-evals](../../capabilities/agents-evals/spec.md) (question sets, runs, reports, comparison), [testing-data](../../capabilities/testing-data/spec.md) (fixtures the golden set is bound to).
- System: [agents](../../system/agents.md) (`assistant-eval-judge`), [api](../../system/api.md) (eval run endpoints), [data-model](../../system/data-model.md) (eval sets and runs).

## Acceptance
From the roadmap (Jira has none): the suite runs on demand against the golden dataset and reports per-question and per-category results; results compare run to run; knowledge on/off comparison is possible (needed by [BA-80](../BA-4/spec.md)). Exact pass thresholds: To be agreed.

## Dependencies, risks and open questions
- **Already built:** the Agents feature has an Evals tab (question suite, executions, Markdown report, run regression in `eval-regression.ts`, `eval-report.ts`), `assistant.evals.ts` and `result-set-check.ts`, bound to a sample fixture registry. Open: what is missing for a "golden" set and for run-to-run and knowledge on/off comparison?
- Needs an LLM key to produce real numbers; the DSL model-vs-legacy comparison ([BA-2](../BA-2/spec.md)) is waiting on it.
- Jira has no stories, no assignee and no fix version; split into stories before starting.
- Phase 1 plan's golden-set item: [phase-1-answer-reliability](../../../docs/plans/phase-1-answer-reliability.md) (Workstream C).
