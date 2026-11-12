---
name: workflow-strict
description: Use when the session's workflow is Strict (the user picked it, or .context/workflow-mode says strict) — the full eleven-step workflow with change sizes S/M/L, the story lane, wave check, acceptance gate and Epic gate. Load it right after the workflow choice, before step 1 of any change.
---

# Strict workflow

One of the two workflows in [CLAUDE.md](../../../CLAUDE.md); the other is [`workflow-free-style`](../workflow-free-style/SKILL.md). The rules in CLAUDE.md under *Rules for both workflows* apply here too.

## Workflow

Every change follows these eleven steps, **scaled to its size** (below). They run in two stages, the **story lane** (with a wave check) and the **acceptance gate**. Within a loop the steps are sequential gates; within a step, independent units fan out to parallel subagents (see *Model usage* in CLAUDE.md). Load a step's skill before the step starts; one skill covers several steps.

1. **Understand the goal** — restate the request in your own words and judge its size (S, M or L). Skill: `workflow-start`.
2. **Clarify** — ask only what changes what you'd build, in one batch with your recommended answers; state assumptions instead of asking when the request is clear. Skill: `workflow-start`.
3. **Update roadmap** — find or add the story in [roadmap.md](../../../roadmap.md), pass the **Epic gate**, then work on the epic's branch. Skill: `workflow-start`.
4. **Update architecture** — for an architectural decision, record an ADR in [specs/system/architecture.md](../../../specs/system/architecture.md) before any code. Skill: `workflow-start`.
5. **Update specs** — before any test or code, update every spec the change affects. Skill: `workflow-start`.
6. **E2E impact analysis** — draft the list with `qa.mjs --draft-impact`, then decide per Gherkin scenario: add, update, delete or re-run. Skill: `workflow-gate`.
7. **Write the E2E** — apply the step-6 decisions to the Playwright and API-level E2E specs, each asserting what the change introduced. Skill: `workflow-gate`.
8. **Implement changes** — production code, built against the Acceptance criteria and the step-5 Gherkin. Skill: `workflow-implement`.
9. **Run checks and fix until green** — `qa.mjs --gate` (builds, unit tests, lint, `check-specs`, the impacted E2E specs) and, when an agent's input changed, its evals. Skill: `verify`.
10. **Record what shipped** — after step 9 is green: the story's evidence and roadmap `✅ Done`; once per epic, the changelog entry and the PR. Skill: `workflow-gate`.
11. **Retrospective** — once per epic, a dated entry in [retrospective.md](../../../retrospective.md), then update [lessons.md](../../../lessons.md). Skill: `workflow-gate`.

## Change sizes — pick one at step 1, say which

| Size | What it is | Steps |
|---|---|---|
| **S** — small | A bug fix, copy or style tweak, config, dependency, docs or process change: no new user flow, endpoint, persisted shape or agent input. Roughly under 50 lines of production code. | 1–3 in a few lines (the story goes under an open epic or Milestone 1.7 *Bug Fixes*; no new epic spec), 5 only for spec lines that state the changed fact, 8, then `qa.mjs <id> --fast --no-demo` and hand over. Gate: 6 (keep the drafted list), 9 (`--gate --no-demo`), 10 as one changelog bullet. 11 only if something went wrong. |
| **M** — story | A feature or behaviour change inside the current architecture. | All steps, as described here. |
| **L** — architectural | A new framework, container, external system, integration boundary or migration; or a change to what an agent receives across several stories. | All steps; step 4 is an ADR; the plan is written in [docs/plans/](../../../docs/plans/) by the planning model first. |

When in doubt between two sizes, take the larger and say so. The user can always re-size a change.

## When the steps run — decide, story lane, wave check, acceptance gate

- **Decide before you build.** For an L epic, or an M feature whose end state is unclear, first show a cheap prototype, then ask one batched confirmation per epic. Skill: `workflow-start`.
- **Story lane, every story:** steps 1–5 scaled to the size, then step 8. A story built by a `builder` agent starts from its **story pack** (`node scripts/story-pack.mjs <id>`). It writes the code, its unit tests, for a UI story **one** Playwright scenario (tagged `@demo` and `@story-<roadmap-id>`, with `scenarioStep` captions), and only the spec lines its change makes false. It runs only the related unit tests and its own Playwright file. No axe scan, screenshots, evidence, demo or `qa.mjs` unless the brief asks. Skill: `workflow-implement`.
- **Wave check, once per set of parallel stories:** the lead merges the wave's unit branches and runs `node scripts/qa.mjs --wave <id>,<id> --base <ref> [--demo <id>]`, then hands the user the running web app. A demo is recorded only for the wave's user-visible milestone. Evidence and demos are recorded per wave. Skill: `verify`.
- **Plain session without a builder agent:** a single-story change, and every S change, may run `node scripts/qa.mjs <roadmap-id> --fast` (with `--no-demo` for S) instead of a wave check, then hand over the same way. Skill: `verify`.
- **Acceptance gate, once the user accepts the change by hand:** steps 6, 7, 9 and 10 per story; then, when the epic's last story is through, the epic's changelog entry, PR and retrospective (step 11). Steps 6, 7, 9, 10 and 11 wait until then. Several accepted stories may go through the gate together.
- **No epic PR opens** while one of its stories has not passed the acceptance gate.
- **Gherkin once.** A flow's steps live in its Playwright test; the capability spec keeps the Feature heading, its `E2E:` line and one `Scenario: <title>` line per scenario. Skill: `workflow-start`.

## Epic gate — no epic in the repo, no code change

Every code change belongs to a story in [roadmap.md](../../../roadmap.md) under a milestone (the epic, ID `M<R>-<M>`) whose spec in `specs/epics/<EPIC-ID>/spec.md` is `Confirmed`. If it doesn't, write the story or the epic spec and get the user's confirmation before you branch or edit code. Every epic is built on one branch and ships as one PR. Skill: `workflow-start`.

## Coming from Free style

When the user switches to Strict partway through a change, add the roadmap story (and the epic spec, if the work has no epic) for what is already done, then continue at the first strict step not yet covered. Work already committed keeps its commits.
