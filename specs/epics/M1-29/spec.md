# M1-29 — Border-case evals for every agent of the two workflows

- **Roadmap:** Milestone 1.29 · **Status:** Confirmed (2026-11-16, the user: "quiero que agreguemos evals sólidos con border cases que nos permitan probar independientemente cada agente…", then "cuando la propuesta esté lista sigue con tu recomendación".)

## Goal

Every agent of Answer a Business Question (Zoe, Nathan, Olivia, Michael, Sarah's data-quality call, Jessica) and of Assess Data Readiness (Zoe, Sarah's Explain report) has an eval set of border cases that runs it on its own, so a wrong answer is traced to one agent and to its purpose; two whole-workflow sets on the Edge Cases sample catch inconsistencies between agents.

## Scope

- Infrastructure (1.29.1); one set per agent (1.29.2–1.29.7); a baseline, an inconsistency report and fixes (1.29.8).

## Out of scope

- Other workflows' agents; changing an agent before the baseline shows a failure.

## Stories

| Story | What | Status |
|---|---|---|
| 1.29.1 | Eval infrastructure | Done |
| 1.29.2 | analysis-planner evals | Done |
| 1.29.3 | answer-writer evals | Done |
| 1.29.4 | Check data quality evals | Done |
| 1.29.5 | image-reader evals | Done |
| 1.29.6 | insights-analyst and result-explorer evals on Edge Cases | Done |
| 1.29.7 | Explain report evals inside Assess Data Readiness | Done |
| 1.29.8 | Baseline, inconsistency report and fixes | Done |

## Specs touched

- [agents.md](../../system/agents.md) 8 (eval sets, targets, checks); [agents-evals](../../capabilities/agents-evals/spec.md) (sets per agent); the agents' sections and prompts where 1.29.8 fixes them.

## Acceptance

- Each new set's checks unit-tested; a baseline of 3 runs per case recorded; every failure explained as an agent fault (fixed, re-run green) or a check fault (fixed).

## Dependencies, risks and open questions

- Plan: [docs/plans/m1-29-agent-evals.md](../../../docs/plans/m1-29-agent-evals.md).
- Cost: about 70 cases × 3 runs; isolated calls are one model call each.
- The judge runs on the same model as the agents (self-grading): rubrics hold one pass condition each.
