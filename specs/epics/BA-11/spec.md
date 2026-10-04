# BA-11 — Bug Fixes

- **Jira:** [BA-11](https://halo-powered.atlassian.net/browse/BA-11) · **Roadmap:** Milestone 1.7 · **Status:** Draft — confirmation waived by the user on 2026-10-04 (one-time exception); work on its stories may start

## Goal
Fix the bugs and blockers found during user testing ([BA-10](../BA-10/spec.md)) and the golden-dataset evals ([BA-9](../BA-9/spec.md)), and stabilize the build for the 1.0 Beta release on 2026-10-31.

## Scope
- Bugs filed under this epic, each with a regression test (E2E where it is a UI flow).
- Release stabilization: blockers cleared, full E2E suite green, installers built and published.

## Out of scope
- New features; anything not a bug or blocker goes to the backlog.

## Stories
| Story | Summary | Roadmap feature |
|---|---|---|
| [BA-83](https://halo-powered.atlassian.net/browse/BA-83) | Session thread is empty after navigating away and back until the page is refreshed (Bug) | 1.7.1 |
| — | Release stabilization (not a Jira issue) | 1.7.2 |
| [BA-101](https://halo-powered.atlassian.net/browse/BA-101) | Datasource credentials stored in plaintext (Bug) | 1.7.3 |
| [BA-102](https://halo-powered.atlassian.net/browse/BA-102) | Desktop backend reachable from the network (Bug) | 1.7.4 |
| [BA-91](https://halo-powered.atlassian.net/browse/BA-91) | Bearer tokens survive diagnostics redaction (Bug) | 1.7.5 |
| [BA-103](https://halo-powered.atlassian.net/browse/BA-103) | Assistant SQL not limited to session datasets (Bug) | 1.7.6 |
| [BA-104](https://halo-powered.atlassian.net/browse/BA-104) | Read-only SQL guard is a keyword blacklist (Bug) | 1.7.7 |
| [BA-105](https://halo-powered.atlassian.net/browse/BA-105) | PostgreSQL SSL skips certificate checks (Bug) | 1.7.8 |
| [BA-106](https://halo-powered.atlassian.net/browse/BA-106) | Fixed default APP_SECRET fallback (Bug) | 1.7.9 |
| [BA-107](https://halo-powered.atlassian.net/browse/BA-107) | Web-mode diagnostics export not redacted (Bug) | 1.7.10 |
| [BA-92](https://halo-powered.atlassian.net/browse/BA-92) | Tailoring after a revert overwrites a version (Bug) | 1.7.11 |
| [BA-93](https://halo-powered.atlassian.net/browse/BA-93) | Interrupted eval runs stay running (Bug) | 1.7.12 |
| [BA-94](https://halo-powered.atlassian.net/browse/BA-94) | Auto-repair rebuilds from stale data (Bug) | 1.7.13 |
| [BA-95](https://halo-powered.atlassian.net/browse/BA-95) | Verified query id rotates on re-approval (Bug) | 1.7.14 |
| [BA-96](https://halo-powered.atlassian.net/browse/BA-96) | Testing data clobbers same-name datasources (Bug) | 1.7.15 |
| [BA-97](https://halo-powered.atlassian.net/browse/BA-97) | Dataset rename duplicates; delete unconfirmed (Bug) | 1.7.16 |
| [BA-98](https://halo-powered.atlassian.net/browse/BA-98) | Datasource-scoped knowledge is never used (Bug) | 1.7.17 |
| [BA-99](https://halo-powered.atlassian.net/browse/BA-99) | Stale application-shell visual baseline (Bug) | 1.7.18 |
| [BA-100](https://halo-powered.atlassian.net/browse/BA-100) | Sidebar session order goes stale (Bug) | 1.7.19 |
| [BA-109](https://halo-powered.atlassian.net/browse/BA-109) | Desktop renderer ignores a non-default `BACKEND_PORT` (Bug; moved from roadmap 0.1.1) | 1.7.20 |

## Specs touched
Decided per bug. Known so far: [sessions-chat](../../capabilities/sessions-chat/spec.md) for BA-83 (history shown on return, same-id refresh must not abort a stream); [delivery](../../system/delivery.md) for release stabilization. The spec-backfill bugs (BA-91 to BA-107) each name their spec in Jira and in [evidence/0.2.2/findings.md](../../../evidence/0.2.2/findings.md).

## Acceptance
- BA-83: returning to a session always shows its messages without a refresh, including after leaving mid-stream; same-id refreshes do not abort an in-flight stream; an E2E test covers it.
- Release: tag created, installers attached, no open blocker bugs in BA (roadmap).

## Dependencies, risks and open questions
- BA-83 root cause is a hypothesis (session id effect in `session-chat.ts`); verify before fixing.
- Feature 1.7.2 has no Jira issue; should it be created so the epic matches the roadmap?
- Scope is open-ended until [BA-10](../BA-10/spec.md) reports; a cut-off rule for what makes the beta is To be agreed.
- No assignee or fix version in Jira.
