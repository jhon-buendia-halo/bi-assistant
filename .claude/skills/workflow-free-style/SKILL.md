---
name: workflow-free-style
description: Use when the session's workflow is Free style (the user picked it, or .context/workflow-mode says free-style) — four steps (understand, clarify, implement, checks) with every other strict step optional. Load it right after the workflow choice, before step 1 of any change.
---

# Free style workflow

One of the two workflows in [CLAUDE.md](../../../CLAUDE.md); the other is [`workflow-strict`](../workflow-strict/SKILL.md). The rules in CLAUDE.md under *Rules for both workflows* apply here too.

## Workflow

1. **Understand the goal** — restate the request in your own words and judge its size (S, M or L). Skill: `workflow-start`.
2. **Clarify** — ask only what changes what you'd build, in one batch with your recommended answers; state assumptions instead of asking when the request is clear. Skill: `workflow-start`.
3. **Implement changes** — production code, built against the goal agreed in step 2 (and the Acceptance criteria and Gherkin when an optional step wrote them). Skill: `workflow-implement`.
4. **Run checks and fix until green** — `node scripts/qa.mjs --free` (build, full unit suites, lint, `check-specs`, the Playwright specs the change touches) and, when an agent's input changed, its evals. Skill: `verify`.

Then commit and hand over. Sizes only scale how much you ask and plan; they add no steps here.

## Optional steps

Run any of these when the user asks, or when you judge it worth it and say so in one line: a roadmap story and epic spec, an ADR, the E2E impact analysis and new Playwright tests, evidence and a demo, a changelog entry, a retrospective. With a roadmap story, step 4 may run `qa.mjs <id> --fast` or `--gate` instead of `--free`.

## What Free style still keeps

- Its own branch (`<type>/<short-description>` from `main`), never `main`, and a PR when the user asks for one.
- Conventional Commit subjects: they drive the version bump.
- Specs stay true: update the spec lines the change makes false, so `check-specs` passes.

## Switching to Strict

When the user says "switch to strict", write `strict` to `.context/workflow-mode`, load [`workflow-strict`](../workflow-strict/SKILL.md) and follow its *Coming from Free style* section.
