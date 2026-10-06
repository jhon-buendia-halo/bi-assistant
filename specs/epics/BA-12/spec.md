# BA-12 — Response Reliability Signals

- **Jira:** [BA-12](https://halo-powered.atlassian.net/browse/BA-12) · **Roadmap:** Milestone 1.4 · **Status:** Draft — confirmation waived by the user on 2026-10-04 (one-time exception); work on its stories may start

## Goal
Show users how much to trust each answer, so beta users can tell a solid answer from one that needs checking. Signals: whether the SQL was verified or auto-corrected, a match with a verified query, empty or suspicious results, and the knowledge and data the answer relied on.

## Scope
- Per-answer trust signals built on SQL self-correction, verified queries and answer feedback.
- Surfacing them in the chat answer (and the knowledge/data the answer relied on).

## Out of scope
- New verification techniques beyond what the plans below already define; the knowledge provenance UI itself ([BA-81](../BA-4/spec.md)).

## Stories
Jira lists only the Research and Execution plan stories, added on 2026-10-06; the rest of the epic is one roadmap feature.

| Story | Summary | Roadmap feature |
|---|---|---|
| [BA-133](https://halo-powered.atlassian.net/browse/BA-133) | Response Reliability Signals — Research | 1.4.2 |
| [BA-134](https://halo-powered.atlassian.net/browse/BA-134) | Response Reliability Signals — Execution plan | 1.4.3 |
| — | Answer trust signals | 1.4.1 |

## Specs touched
- Capabilities: [sessions-chat](../../capabilities/sessions-chat/spec.md) (signals on assistant messages, feedback), [verified-queries](../../capabilities/verified-queries/spec.md) (match and promotion), [knowledge](../../capabilities/knowledge/spec.md) (knowledge the answer used).
- System: [data-model](../../system/data-model.md) (message fields), [api](../../system/api.md) (feedback endpoint, stream events), [ui](../../system/ui.md) (answer badges and detail).

## Acceptance
To be agreed (the Jira epic has only a description). Starting point: each signal in Scope is visible per answer and derived deterministically, not from model output.

## Dependencies, risks and open questions
- **Largely built already.** The persisted answer message carries `verified`, `interpretation`, `feedback`, `crossCheck` (careful mode) and tool data with a `truncated` flag; `POST /sessions/:id/messages/feedback`, `sql-fixer` repair with corrected-SQL notes, empty-result notes, and `session-chat` thumbs and badges exist. Open: which signals are still missing (suspicious results, knowledge relied on, a consolidated trust indicator)?
- Plans: [phase-1-answer-reliability](../../../docs/plans/phase-1-answer-reliability.md), [phase-2-trust-ux](../../../docs/plans/phase-2-trust-ux.md); research in [competitive-research](../../../docs/research/competitive-research-and-improvement-plan.md). Their completion status is unconfirmed (see retrospective 2026-10-01).
- "Knowledge relied on" depends on [BA-4](../BA-4/spec.md) retrieval logging.
- Jira: no stories, and no `1.0 Beta` fix version although it sits in the beta window. Assignee: Sergio Berrospi.
