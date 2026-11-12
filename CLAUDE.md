# Questions to Insights

Desktop application (Electron) with an Angular frontend and a NestJS backend.

```
frontend/   Angular app (Electron renderer) + Electron main process
backend/    NestJS API
specs/      the complete specification of the app
```

**What the app does and how it works is specified in [specs/](specs/README.md), not here.** Start there for any question about behaviour, endpoints, stored data, agents, UI, build or release. This file holds the always-on rules for working in the repo; the workflow's conventions live in four project skills under [.claude/skills/](.claude/skills/), loaded when their steps start. Developer tools live in [.claude/tools/](.claude/tools/README.md).

**All planning lives in this repository.** Jira is no longer used (since 2026-11-11): epics are roadmap milestones with a spec in [specs/epics/](specs/README.md), stories are roadmap features. Don't ask for or create Jira issues.

Process documents:

- [lessons.md](lessons.md) — the short list of rules learned the hard way. Read first, every task.
- [roadmap.md](roadmap.md) — the plan for all work: epics (milestones) and stories (features). Longer plans live in [docs/plans/](docs/plans/), linked from the roadmap.
- [specs/](specs/README.md) — the product, system, capability and epic specs; an LLM given only this folder can rebuild the app. ADRs are in [specs/system/architecture.md](specs/system/architecture.md); user flows in Gherkin are in each capability spec.
- [changelog.md](changelog.md) — what shipped, one entry per epic. [evidence/](evidence/) — each story's test report and demo, linked from it.
- [retrospective.md](retrospective.md) — the full history of what went well and wrong, one entry per epic. Read an entry only when a lesson needs its context.

## Workflow — order of operations

> **MANDATORY FIRST ACTION — read [lessons.md](lessons.md) before doing anything else.** Before you restate the goal, ask a question, run a command or touch a file, on every task, read it. It is short on purpose.

Every change follows these eleven steps, **scaled to its size** (below). They run in two stages, the **story lane** (with a wave check) and the **acceptance gate**. Within a loop the steps are sequential gates; within a step, independent units fan out to parallel subagents (see **Model usage**). Load a step's skill before the step starts; one skill covers several steps.

1. **Understand the goal** — restate the request in your own words and judge its size (S, M or L). Skill: `workflow-start`.
2. **Clarify** — ask only what changes what you'd build, in one batch with your recommended answers; state assumptions instead of asking when the request is clear. Skill: `workflow-start`.
3. **Update roadmap** — find or add the story in [roadmap.md](roadmap.md), pass the **Epic gate**, then work on the epic's branch. Skill: `workflow-start`.
4. **Update architecture** — for an architectural decision, record an ADR in [specs/system/architecture.md](specs/system/architecture.md) before any code. Skill: `workflow-start`.
5. **Update specs** — before any test or code, update every spec the change affects. Skill: `workflow-start`.
6. **E2E impact analysis** — draft the list with `qa.mjs --draft-impact`, then decide per Gherkin scenario: add, update, delete or re-run. Skill: `workflow-gate`.
7. **Write the E2E** — apply the step-6 decisions to the Playwright and API-level E2E specs, each asserting what the change introduced. Skill: `workflow-gate`.
8. **Implement changes** — production code, built against the Acceptance criteria and the step-5 Gherkin. Skill: `workflow-implement`.
9. **Run checks and fix until green** — `qa.mjs --gate` (builds, unit tests, lint, `check-specs`, the impacted E2E specs) and, when an agent's input changed, its evals. Skill: `verify`.
10. **Record what shipped** — after step 9 is green: the story's evidence and roadmap `✅ Done`; once per epic, the changelog entry and the PR. Skill: `workflow-gate`.
11. **Retrospective** — once per epic, a dated entry in [retrospective.md](retrospective.md), then update [lessons.md](lessons.md). Skill: `workflow-gate`.

### Change sizes — pick one at step 1, say which

| Size | What it is | Steps |
|---|---|---|
| **S** — small | A bug fix, copy or style tweak, config, dependency, docs or process change: no new user flow, endpoint, persisted shape or agent input. Roughly under 50 lines of production code. | 1–3 in a few lines (the story goes under an open epic or Milestone 1.7 *Bug Fixes*; no new epic spec), 5 only for spec lines that state the changed fact, 8, then `qa.mjs <id> --fast --no-demo` and hand over. Gate: 6 (keep the drafted list), 9 (`--gate --no-demo`), 10 as one changelog bullet. 11 only if something went wrong. |
| **M** — story | A feature or behaviour change inside the current architecture. | All steps, as described here. |
| **L** — architectural | A new framework, container, external system, integration boundary or migration; or a change to what an agent receives across several stories. | All steps; step 4 is an ADR; the plan is written in [docs/plans/](docs/plans/) by the planning model first. |

When in doubt between two sizes, take the larger and say so. The user can always re-size a change.

### When the steps run — decide, story lane, wave check, acceptance gate

- **Decide before you build.** For an L epic, or an M feature whose end state is unclear, first show a cheap prototype (an HTML mock or an ASCII/Markdown sketch, at most 10 minutes, no spec, no ADR). Then ask **one batched confirmation per epic**: spec, ADR, open questions with recommendations, and branch, in one message. A direction change after it is re-planned once, not story by story. Skill: `workflow-start`.
- **Story lane, every story:** steps 1–5 scaled to the size, then step 8. A story built by a `builder` agent starts from its **story pack** (`node scripts/story-pack.mjs <id>`). It writes the code, its unit tests, for a UI story **one** Playwright scenario (tagged `@demo` and `@story-<roadmap-id>`, with `scenarioStep` captions), and only the spec lines its change makes false. It runs only the related unit tests and its own Playwright file. No axe scan, screenshots, evidence, demo or `qa.mjs` unless the brief asks. Skill: `workflow-implement`.
- **Wave check, once per set of parallel stories:** the lead merges the wave's unit branches and runs `node scripts/qa.mjs --wave <id>,<id> --base <ref> [--demo <id>]`, then hands the user the running web app and tells them to hard-reload any open tab. A demo is recorded only for the wave's user-visible milestone. Evidence and demos are recorded per wave. Skill: `verify`.
- **Plain session without a builder agent:** a single-story change, and every S change, may run `node scripts/qa.mjs <roadmap-id> --fast` (with `--no-demo` for S) instead of a wave check, then hand over the same way. Skill: `verify`.
- **Acceptance gate, once the user accepts the change by hand:** steps 6, 7, 9 and 10 per story; then, when the epic's last story is through, the epic's changelog entry, PR and retrospective (step 11). Steps 6, 7, 9, 10 and 11 wait until then. Several accepted stories may go through the gate together.
- **No epic PR opens** while one of its stories has not passed the acceptance gate.
- **Gherkin once.** A flow's steps live in its Playwright test. The capability spec keeps the Feature heading, its `E2E:` line and one `Scenario: <title>` line per scenario. Skill: `workflow-start`.
- **Read and output rules, every agent.** Never read a file over 500 lines whole: `grep -n` or use the section index `specs/INDEX.md`, then read the range. Keep output quiet: Playwright `--reporter=dot`, Jest `--silent`, builds and test runs to a log file, and read back only the summary or the failure block.
- **Session hygiene.** One lead session per epic wave. Before starting a new session, write `.context/handoff.md` (template in `workflow-gate`).

Versioning stays automatic: the changelog is the human-readable record of what shipped; Conventional Commit subjects drive the version bump. Never edit `version` by hand; installers and the npm package are built manually. See [delivery.md](specs/system/delivery.md).

## Hard gates — they apply in every turn, inside a step or not

- **Epic gate — no epic in the repo, no code change.** Every code change belongs to a story in [roadmap.md](roadmap.md) under a milestone (the epic, ID `M<R>-<M>`) whose spec in `specs/epics/<EPIC-ID>/spec.md` is `Confirmed`. If it doesn't, write the story or the epic spec and get the user's confirmation before you branch or edit code. Skill: `workflow-start`.
- **Never on `main`.** Every epic is built on one branch and ships as one PR; nothing goes directly on `main`. Skills: `workflow-start` (branching), `workflow-gate` (PR and cleanup).
- **Specs change with the code, on the same branch.** Skill: `workflow-start`.
- **Ask the target before starting the app or the Postgres stack from a worktree; check the default ports first; stop by PID.** Skill: `workflow-implement` (Worktree deploy convention).

## New workspace

Run `node scripts/bootstrap.mjs` once in a fresh checkout or worktree: it installs both packages from their lockfiles, builds the backend and the web UI, and reports whether the shared Postgres on 55432 is up. It never starts the app.

## Model usage: plan vs. execute

Plan an M or L change with Opus 5.5 (`claude-opus-5-5`) at high effort. An S change needs no separate plan.

Execute by fanning out: split the plan into independent units and dispatch them to parallel subagents (all calls for independent units in a single message). Keep sequential only what depends on a previous result. Pick the model per unit from this table. Subagents that work from a brief (`builder`, `reviewer`) don't load this file.

| Work | Model | Effort |
|---|---|---|
| Plans, ADRs, design, critical or risky paths | Opus | high for plans, default for code |
| UI on an existing pattern, tests, test migrations, deletions, docs | Sonnet | default or low |
| Search, inventories, "where is X" | Haiku (`Explore`) | low |

When two or more builders run in parallel, at most two use Opus.
