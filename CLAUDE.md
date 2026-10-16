# Questions to Insights

Desktop application (Electron) with an Angular frontend and a NestJS backend.

```
frontend/   Angular app (Electron renderer) + Electron main process
backend/    NestJS API
specs/      the complete specification of the app
```

**What the app does and how it works is specified in [specs/](specs/README.md), not here.** Start there for any question about behaviour, endpoints, stored data, agents, UI, build or release. This file holds the always-on rules for working in the repo; each workflow stage's conventions live in a project skill under [.claude/skills/](.claude/skills/), loaded when that stage starts.

Process documents (see **Workflow** below):

- [roadmap.md](roadmap.md) — pre-implementation plan for all work. Skill `workflow-plan`. Longer-form phase plans live in [docs/plans/](docs/plans/); roadmap features link to them rather than duplicating them.
- [changelog.md](changelog.md) — running log of every change. Skill `workflow-ship`.
- [specs/](specs/README.md) — the product, system, capability and epic specs; an LLM given only this folder can rebuild the app. Architecture and ADRs are in [specs/system/architecture.md](specs/system/architecture.md); user flows in Gherkin are in each capability spec. Skills `workflow-specs`, `workflow-architecture` and `workflow-plan` (Epic gate).
- [retrospective.md](retrospective.md) — what went well and wrong on each completed change. Skill `workflow-retrospective`.
- [evidence/](evidence/) — verifiable artifacts for each shipped change, linked from the changelog. Skill `workflow-ship`.

## Workflow — order of operations

> **MANDATORY FIRST ACTION — read [retrospective.md](retrospective.md) before doing anything else.** Before you restate the goal, ask a question, run a command, or touch a file — on *every* task, not just large ones — open [retrospective.md](retrospective.md) and read the lessons. They are recorded specifically so past mistakes are not repeated. This precedes step 1.

Every meaningful change follows this eleven-step workflow. Do not skip a step. The steps run in two loops, a **fast loop** and an **acceptance gate** (see **When the steps run** below the list). Within each loop the steps are sequential gates; *within* a step, independent units still fan out to parallel subagents per **Model usage** below.

**Load a step's skill before you start that step, and follow it**: it holds the conventions, commands and checks for that step, as the RFP Builder loads a stage's skill before that stage. One skill may cover two steps.

1. **Understand the goal** — restate the request in your own words before touching anything. Skill: `workflow-understand`.
2. **Ask clarifying questions until the goal is 100% understood** — scope, behaviour, edge cases, acceptance criteria. Skill: `workflow-understand`.
3. **Update roadmap** — find or add the feature in [roadmap.md](roadmap.md), pass the **Epic gate**, then work on the epic's branch and worktree. Skill: `workflow-plan`.
4. **Update architecture** — if the change involves an architectural decision, record it as an ADR in [specs/system/architecture.md](specs/system/architecture.md) *before* any code is written. Skill: `workflow-architecture`.
5. **Update specs** — before any test or code, update every spec the change affects. Skill: `workflow-specs`.
6. **Component impact-based analysis on E2E** — for every component, page, service or backend module touched, decide per Gherkin scenario: *add / update / delete / re-run-as-is*. Skill: `workflow-e2e`.
7. **Implement / update / delete E2E** — apply the step-6 decisions to the Playwright and API-level E2E specs, each asserting what the change introduced. Skill: `workflow-e2e`.
8. **Implement changes** — production code, built against the Acceptance criteria and the step-5 Gherkin. Skill: `workflow-implement`.
9. **Run E2E and fix until green** — the impacted E2E specs, `check-specs`, unit tests, lint, builds and, when an agent's input changed, its evals at 100%. Skill: `verify`.
10. **Update changelog with evidence** — only after step 9 is green, add a dated changelog entry, capture the evidence and mark the roadmap entry `✅ Done`. Skill: `workflow-ship`.
11. **Retrospective** — add a dated entry to [retrospective.md](retrospective.md): what went well, what went wrong, what to do differently. Skill: `workflow-retrospective`.

**When the steps run — fast loop, then acceptance gate.** Adopted 2026-10-14 so the user can test a change by hand before the slow steps run, instead of the whole workflow running from scratch for every request.

- **Fast loop, every change the user requests:** steps 1–5 scaled to the change, then step 8, then quick checks: the unit tests of the code touched, the builds, `python3 scripts/check-specs.py`, and the existing Playwright specs of the Features the change touches. Then hand the user the running web app to test by hand. Steps 6, 7, 9, 10 and 11 wait. A follow-up request on the same story goes round the fast loop again.
- **Acceptance gate, once the user accepts the change by hand:** steps 6, 7, 9, 10 and 11, in order, once per story. Several accepted stories may go through the gate together before the epic PR opens.
- **No epic PR opens** while one of its stories has not passed the acceptance gate.

Versioning stays automatic (see **Versioning** below): the changelog is the human-readable record of *what* shipped, Conventional Commit subjects still drive the version bump.

## Hard gates — they apply in every turn, inside a step or not

Each gate's details are in the skill named after it.

- **Epic gate — no Jira epic, no code change.** Every new code change must map to a Jira epic in project BA, and the epic must have a confirmed spec. If it does not, do not branch, edit code or open a PR. Checked before step 3. Skill: `workflow-plan`.
- **Never on `main`.** Every epic is built on one branch, in one worktree, and ships as one PR; nothing goes directly on `main`. Skill: `workflow-plan` (branching), `workflow-ship` (PR and cleanup).
- **Specs change with the code, on the same branch.** Skill: `workflow-specs`.
- **Ask the target before starting the app or the Postgres stack from a worktree; check the default ports first; stop by PID.** Skill: `workflow-implement` (Worktree deploy convention).

### Versioning

Never edit `version` by hand. Conventional Commit subjects drive the automatic bump on merge; installers and the npm package are built manually. See [delivery.md](specs/system/delivery.md).

## Model usage: plan vs. execute

For planning purposes, Fable creates the plan.

For execution, do not pin a fixed model. Once the execution plan is well defined, the session LLM picks whichever model version it judges best for the work at hand (capability vs. speed vs. cost for that plan) and runs the plan with it.

Execute by fanning out: split the plan into independent units of work and dispatch them to parallel subagents (all agent calls for independent units go out in a single message so they run concurrently). Keep sequential only what genuinely depends on a previous result. The session LLM chooses the model per subagent the same way — cheap/fast models for mechanical or narrow-scope units, stronger models for units needing design judgment or cross-file reasoning.
