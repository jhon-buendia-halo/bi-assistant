# BA-82 — Agent Routines

- **Jira:** [BA-82](https://halo-powered.atlassian.net/browse/BA-82) · **Roadmap:** Backlog · **Status:** Draft — confirmation waived by the user on 2026-10-04 (one-time exception); work on its stories may start

## Goal
To be agreed. The Jira epic has an empty description, no dates, no fix version, no stories and no assignee. The title suggests agents running repeatable, possibly scheduled, tasks, but this is an inference, not a decision.

## Scope
To be agreed.

## Out of scope
To be agreed. Not sequenced into the 1.0 Beta.

## Stories
Jira lists only the Research and Execution plan stories, added on 2026-10-06.

| Story | Summary | Roadmap feature |
|---|---|---|
| [BA-135](https://halo-powered.atlassian.net/browse/BA-135) | Agent Routines — Research | — |
| [BA-136](https://halo-powered.atlassian.net/browse/BA-136) | Agent Routines — Execution plan | — |
| — | — | none (Backlog entry only) |

## Specs touched
To be agreed. Likely candidates once defined: [agents-evals](../../capabilities/agents-evals/spec.md), [deep-analysis](../../capabilities/deep-analysis/spec.md), [sessions-chat](../../capabilities/sessions-chat/spec.md); system [agents](../../system/agents.md) and [api](../../system/api.md).

## Acceptance
To be agreed.

## Dependencies, risks and open questions
- What is a "routine"? A saved, re-runnable prompt, a scheduled agent run, or a multi-step workflow? Code search found no scheduler or routine concept in `backend/src/modules` or `frontend/src/app/features`, but Deep Analysis (`modules/deep-analysis`) and eval runs are adjacent and may overlap.
- The Electron app is local-first and only runs while open; scheduled execution would need a decision (ADR) on where it runs.
- Must be defined (Intent, Scope, Acceptance) and promoted into a release before work starts, per the roadmap Backlog rule.
