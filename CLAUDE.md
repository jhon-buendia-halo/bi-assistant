# Questions to Insights

Desktop application (Electron) with an Angular frontend and a NestJS backend.

```
frontend/   Angular app (Electron renderer) + Electron main process
backend/    NestJS API
specs/      the complete specification of the app
```

**What the app does and how it works is specified in [specs/](specs/README.md), not here.** Start there for any question about behaviour, endpoints, stored data, agents, UI, build or release. This file holds only what every session needs; the workflows and their steps live in project skills under [.claude/skills/](.claude/skills/), the recipe for each kind of task in playbooks under [.claude/playbooks/](.claude/playbooks/), and developer tools in [.claude/tools/](.claude/tools/README.md).

> **MANDATORY FIRST ACTION — read [lessons.md](lessons.md) before doing anything else.** Before you restate the goal, ask a question, run a command or touch a file, on every task, read it. It is short on purpose.

## Non-negotiables

- **Never on `main`.** Work on a branch; nothing goes directly on `main`.
- **Specs change with the code, on the same branch.** `python3 scripts/check-specs.py` must pass. Skill: `workflow-start` (where a fact belongs).
- **Every local instance is ready to test.** Never leave an instance without an LLM. Playbook: `local-instance`.
- **New or changed workflows start from Mastra's docs.** Read them, check what can be reused, offer the user three approaches with a recommendation, and build only after the user picks one. Playbook: `mastra-workflow`.
- **Every agent that answers from data shows its evidence the same way** (the *query inspector* pattern), built once in the shared layer, never in one agent's prompt or screen. Rules: [agent-answers](specs/capabilities/agent-answers/spec.md), *Query inspector*. Playbook: `agent-change`.
- **All planning lives in this repository** ([roadmap.md](roadmap.md), [specs/epics/](specs/README.md)); don't ask for or create Jira issues.
- **Read and output.** Never read a file over 500 lines whole: `grep -n` or use [specs/INDEX.md](specs/INDEX.md), then read the range. Run builds and tests quietly, to a log file, and read back only the summary or the failure block.
- **Versioning is automatic:** Conventional Commit subjects drive the bump. Never edit `version` by hand; installers and the npm package are built manually. See [delivery.md](specs/system/delivery.md).
- **Session hygiene.** Before starting a new session, write `.context/handoff.md`. Playbook: `session-handoff`.
- **Starting any subagent** → the first line of its brief is `Read .claude/worker.md before anything else.`; the rest is the goal, the task and the brand. [worker.md](.claude/worker.md) holds the rules every subagent follows.

New checkout or worktree: run `node scripts/bootstrap.mjs` once (installs, builds the backend and web UI, reports whether the shared Postgres on 55432 is up; never starts the app).

### Choose the brand

**Every session asks which brand it works on, even when an earlier answer exists.** Right after the workflow is settled (in the same picker when the workflow question is asked too), ask: **Halo Powered** (`halo`, the default build) or **Agentic Hub** (`mercer`, the pre-rebrand look). Offer the value in `.context/brand`, if any, as the recommended option.

- Write the answer to `.context/brand` and say it in one line.
- Use it for every build, app run and E2E run of the session: `BRAND=<id>` on `build:all`, `build:web`, `electron`, `electron:dist` and `test:e2e` (ADR-0045, [delivery.md](specs/system/delivery.md)).
- The E2E suite targets the Halo build. On `mercer`, run only `e2e/brand-mercer.spec.ts`, then rebuild without `BRAND` before any other suite.
- Subagents get the brand in their brief and skip the question.

## Principles

- [lessons.md](lessons.md) — rules learned the hard way. Read first, every task.
- [retrospective.md](retrospective.md) — full history, one entry per epic; read an entry only when a lesson needs its context.

## Autonomy

- **Ask the target before starting the app or the Postgres stack from a worktree; check the default ports first; stop by PID.** Skill: `workflow-implement`. Playbook: `local-instance`.

## Writing the reply

- Ask only the questions with no safe default, all in one picker call; state the defaults for the rest and proceed.
- Answer an out-of-band question in the very next reply, before any status update.

## Playbooks

### Choose the workflow

Right after reading `lessons.md` in a new session, settle which workflow the session follows:

- If `.context/workflow-mode` exists (`strict` or `free-style`), say in one line which mode you are continuing in and go on.
- Otherwise ask with one picker: **Strict** (the full eleven steps: roadmap, epic spec, specs, E2E, evidence, changelog, retrospective) or **Free style** (understand, clarify, implement, checks; the rest optional). Write the answer to `.context/workflow-mode`.
- Then load the skill: [`workflow-strict`](.claude/skills/workflow-strict/SKILL.md) or [`workflow-free-style`](.claude/skills/workflow-free-style/SKILL.md).
- "Switch to strict" or "switch to free style" changes the mode at any point: rewrite the file and load the other skill.

Subagents that work from a brief (`builder`, `reviewer`) skip this.

### Choose the playbook

The workflow decides which steps run; the playbook says how to do this kind of task inside them. Match the task to a playbook in [.claude/playbooks/](.claude/playbooks/), open it and copy its steps into the todo list. Each step names, in brackets, the workflow step it fills. A task no playbook fits (a feature, a UI change) follows the workflow's steps alone.

| Task | Playbook |
|---|---|
| A new or changed Mastra workflow | [`mastra-workflow`](.claude/playbooks/mastra-workflow.md) |
| A new agent, or a change to what an agent receives | [`agent-change`](.claude/playbooks/agent-change.md) |
| A defect in shipped behaviour | [`bug-fix`](.claude/playbooks/bug-fix.md) |
| Starting the app for the user or a check | [`local-instance`](.claude/playbooks/local-instance.md) |
| Recording what shipped, the PR, post-merge cleanup | [`ship`](.claude/playbooks/ship.md) |
| Pausing work, or picking up a previous session's work | [`session-handoff`](.claude/playbooks/session-handoff.md) |

## Process documents

- [roadmap.md](roadmap.md) — epics (milestones) and stories (features); longer plans in [docs/plans/](docs/plans/).
- [specs/](specs/README.md) — product, system, capability and epic specs; ADRs in [specs/system/architecture.md](specs/system/architecture.md).
- [changelog.md](changelog.md) and [evidence/](evidence/) — what shipped and its test reports and demos.

## Model usage: plan vs. execute

Plan an M or L change with Opus 5.5 (`claude-opus-5-5`) at high effort. An S change needs no separate plan. Execute by fanning out independent units to parallel subagents in one message; keep sequential only what depends on a previous result.

| Work | Model | Effort |
|---|---|---|
| Plans, ADRs, design, critical or risky paths | Opus | high for plans, default for code |
| UI on an existing pattern, tests, test migrations, deletions, docs | Sonnet | default or low |
| Search, inventories, "where is X" | Haiku (`Explore`) | low |

When two or more builders run in parallel, at most two use Opus. The `builder` agent defaults to Sonnet; pass `model: opus` only for a row above that calls for it.
