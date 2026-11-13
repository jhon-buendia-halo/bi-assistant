# Questions to Insights

Desktop application (Electron) with an Angular frontend and a NestJS backend.

```
frontend/   Angular app (Electron renderer) + Electron main process
backend/    NestJS API
specs/      the complete specification of the app
```

**What the app does and how it works is specified in [specs/](specs/README.md), not here.** Start there for any question about behaviour, endpoints, stored data, agents, UI, build or release. This file holds only what every session needs; the workflows and their steps live in project skills under [.claude/skills/](.claude/skills/), and developer tools in [.claude/tools/](.claude/tools/README.md).

> **MANDATORY FIRST ACTION — read [lessons.md](lessons.md) before doing anything else.** Before you restate the goal, ask a question, run a command or touch a file, on every task, read it. It is short on purpose.

## Choose the workflow

Right after reading `lessons.md` in a new session, settle which workflow the session follows:

- If `.context/workflow-mode` exists (`strict` or `free-style`), say in one line which mode you are continuing in and go on.
- Otherwise ask with one picker: **Strict** (the full eleven steps: roadmap, epic spec, specs, E2E, evidence, changelog, retrospective) or **Free style** (understand, clarify, implement, checks; the rest optional). Write the answer to `.context/workflow-mode`.
- Then load the skill: [`workflow-strict`](.claude/skills/workflow-strict/SKILL.md) or [`workflow-free-style`](.claude/skills/workflow-free-style/SKILL.md).
- "Switch to strict" or "switch to free style" changes the mode at any point: rewrite the file and load the other skill.

Subagents that work from a brief (`builder`, `reviewer`) skip this.

## Rules for both workflows

- **Never on `main`.** Work on a branch; nothing goes directly on `main`.
- **Specs change with the code, on the same branch.** `python3 scripts/check-specs.py` must pass. Skill: `workflow-start` (where a fact belongs).
- **Ask the target before starting the app or the Postgres stack from a worktree; check the default ports first; stop by PID.** Skill: `workflow-implement`.
- **Every local instance is ready to test.** Default LLM: CLIProxyAPI (provider `custom`, Anthropic style, `http://127.0.0.1:8317`, model `claude-sonnet-5-5`), its key in `.env.llm.local` of the main checkout (gitignored; template `.env.llm.example`). Once the app answers, run `node scripts/setup-local.mjs <url>`: it saves that LLM and loads the Testing Data fixtures, including the "World Cup PostgreSQL" datasource and "World Cup" dataset (Postgres on 55432). Never leave an instance without an LLM.
- **New or changed workflows start from Mastra's docs.** Before building a new workflow or changing an existing one, read the Mastra workflows documentation ([overview](https://mastra.ai/docs/workflows/overview) and the pages it links that apply), check which existing agents, tools and workflows can be reused or serve as a reference, then offer the user **three possible approaches** with their trade-offs and say which one you recommend and why; build only after the user picks one. Skill: `mastra-workflows`.
- **All planning lives in this repository** ([roadmap.md](roadmap.md), [specs/epics/](specs/README.md)); don't ask for or create Jira issues.
- **Read and output.** Never read a file over 500 lines whole: `grep -n` or use [specs/INDEX.md](specs/INDEX.md), then read the range. Run builds and tests quietly, to a log file, and read back only the summary or the failure block.
- **Versioning is automatic:** Conventional Commit subjects drive the bump. Never edit `version` by hand; installers and the npm package are built manually. See [delivery.md](specs/system/delivery.md).
- **Session hygiene.** Before starting a new session, write `.context/handoff.md` (template in `workflow-gate`).

New checkout or worktree: run `node scripts/bootstrap.mjs` once (installs, builds the backend and web UI, reports whether the shared Postgres on 55432 is up; never starts the app).

## Process documents

- [lessons.md](lessons.md) — rules learned the hard way. Read first, every task.
- [roadmap.md](roadmap.md) — epics (milestones) and stories (features); longer plans in [docs/plans/](docs/plans/).
- [specs/](specs/README.md) — product, system, capability and epic specs; ADRs in [specs/system/architecture.md](specs/system/architecture.md).
- [changelog.md](changelog.md) and [evidence/](evidence/) — what shipped and its test reports and demos.
- [retrospective.md](retrospective.md) — full history, one entry per epic; read an entry only when a lesson needs its context.

## Model usage: plan vs. execute

Plan an M or L change with Opus 5.5 (`claude-opus-5-5`) at high effort. An S change needs no separate plan. Execute by fanning out independent units to parallel subagents in one message; keep sequential only what depends on a previous result.

| Work | Model | Effort |
|---|---|---|
| Plans, ADRs, design, critical or risky paths | Opus | high for plans, default for code |
| UI on an existing pattern, tests, test migrations, deletions, docs | Sonnet | default or low |
| Search, inventories, "where is X" | Haiku (`Explore`) | low |

When two or more builders run in parallel, at most two use Opus. The `builder` agent defaults to Sonnet; pass `model: opus` only for a row above that calls for it.
