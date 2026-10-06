# BA-119 — Harness Adjustments

- **Jira:** [BA-119](https://halo-powered.atlassian.net/browse/BA-119) · **Roadmap:** Milestone 0.4 · **Status:** Confirmed

## Goal

The delivery workflow harness keeps improving after its adoption under [BA-89](../BA-89/spec.md). Each adjustment changes how work is planned, built and shipped, so the next change goes better than the last: lessons from [retrospective.md](../../../retrospective.md) become rules, and rules close the gaps that let mistakes through.

## Scope

- Changes to the conventions and gates in [CLAUDE.md](../../../CLAUDE.md): workflow steps, Epic gate, planning, branching, evidence and retrospective rules.
- The epic and story structure those conventions require, in Jira, [roadmap.md](../../../roadmap.md) and the epic spec format in [specs/README.md](../../README.md).
- Repo-local skills under `.claude/skills/` and checks such as `scripts/check-specs.py` that apply the conventions.

## Out of scope

- Product behaviour. Changes to the app belong to the product epics.
- The agent harness (prompts, tools, model routing). That is product behaviour, specified in [system/agents.md](../../system/agents.md).
- Branch rulesets and release workflows on GitHub, which stay with [BA-89](../BA-89/spec.md).

## Stories

| Story | Summary | Roadmap feature |
|---|---|---|
| [BA-120](https://halo-powered.atlassian.net/browse/BA-120) | Require research and execution plan stories in every epic | 0.4.1 |
| [BA-139](https://halo-powered.atlassian.net/browse/BA-139) | Harness Adjustments — Research | 0.4.2 |
| [BA-140](https://halo-powered.atlassian.net/browse/BA-140) | Harness Adjustments — Execution plan | 0.4.3 |

BA-120 introduces the Research and Execution plan rule, so it is the one story exempt from it. It ships before this epic's own Research and Execution plan stories.

## Specs touched

- [specs/README.md](../../README.md): the epic spec format and lifecycle.

## Acceptance

- Every adjustment is a rule in CLAUDE.md, a skill or a check, and every file it references exists.
- `python3 scripts/check-specs.py` passes after each story.

## Dependencies, risks and open questions

- **Overlap with BA-89.** BA-89 adopted the workflow; this epic adjusts it. A change to the delivery conventions after 2026-10-06 goes here unless it is about GitHub rulesets or releases.
