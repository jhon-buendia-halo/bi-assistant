# BA-10 — User Testing

- **Jira:** [BA-10](https://halo-powered.atlassian.net/browse/BA-10) · **Roadmap:** Milestone 1.6 · **Status:** Draft (to be confirmed by the user)

## Goal
Find what breaks or confuses real users before release: they install the beta build, connect a source, ask questions and build visuals. Issues, confusing flows and wrong answers are captured as bugs or feedback to feed the Bug Fixes week ([BA-11](../BA-11/spec.md)).

## Scope
- A testing round on a release-candidate installer with real users and their data.
- Capture every finding in Jira under BA-11 and triage into 1.7 or the backlog.

## Out of scope
- Fixing the findings (BA-11).

## Stories
Jira lists **no child issues**; the roadmap has one feature.

| Story | Summary | Roadmap feature |
|---|---|---|
| — | Beta user testing round | 1.6.1 |

## Specs touched
None expected: this is a process epic. Findings may later change any capability spec through their own bugs. Evidence layout and the build workflow are in [delivery](../../system/delivery.md).

## Acceptance
Every finding is filed in Jira and triaged into 1.7 or the backlog (roadmap). Number of testers, session protocol and success measures: To be agreed.

## Dependencies, risks and open questions
- Needs an installer build of the release-candidate tag (Actions, Build desktop installers); timing Oct 19 to Oct 23 depends on [BA-2](../BA-2/spec.md), [BA-4](../BA-4/spec.md), [BA-5](../BA-5/spec.md) and [BA-12](../BA-12/spec.md) being usable.
- No assignee, fix version or stories in Jira. Who recruits testers, and are real customer data and credentials allowed on their machines?
- Where is structured feedback collected (Jira form, template)? Not defined.
