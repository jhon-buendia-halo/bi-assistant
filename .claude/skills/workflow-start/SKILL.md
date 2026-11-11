---
name: workflow-start
description: Use at workflow steps 1–5 of any change in this repo (after reading lessons.md): restate the goal and clarify, size the change, find or add the roadmap feature, pass the Epic gate (roadmap milestone + confirmed epic spec in the repo), branch, record an ADR when the change is architectural, and update the specs. Also when writing Gherkin, an epic spec, or deciding which spec file a fact belongs in.
---

# Steps 1–5 — Understand, plan, architecture, specs

Part of the workflow in [CLAUDE.md](../../../CLAUDE.md), which keeps the always-on core (the mandatory first action, the step list, the change sizes, the fast loop and acceptance gate, the hard gates). Load this skill once, before step 1; it covers every step up to the code.

Scale each step to the change's size (**S / M / L**, defined in CLAUDE.md). The S column of each step says what a small change does.

## 1–2. Understand the goal and clarify

1. **Restate the goal** in your own words: the user-observable outcome and how we'll know it's done. Apply the [lessons.md](../../../lessons.md) lines that bear on the task. Say which size you judge the change to be.
2. **Clarify** scope, behaviour, edge cases and acceptance until nothing material is open. Ask only what changes what you'd build; batch questions in one message, each with your recommended answer. When the request is clear, state your assumptions and go on instead of asking.
   - **S:** one-line restatement; ask only when blocked.

## 3. Roadmap, Epic gate, branch

### Planning convention

**Every feature is in [roadmap.md](../../../roadmap.md) before code is written for it.** Hierarchy **Release → Milestone → Feature** with numeric IDs (`R`, `R.M`, `R.M.F`), statuses `📋 Planned`, `🚧 In progress`, `✅ Done`, `🚫 Cut`. A feature is ready when Intent, Scope and Acceptance are filled in.

1. **Classify, don't append.** Find the milestone the work belongs to (read the milestone descriptions). Extend an existing feature when the work fits it; otherwise add a feature under the right milestone, in dependency order; if no milestone fits, propose one before adding the feature.
2. Write the entry (Intent / Scope / Out of scope / Acceptance / Notes) and set it `🚧 In progress`. It becomes `✅ Done` at step 10. A cut feature stays, `🚫 Cut` with a one-line reason.
3. Longer plans go in [docs/plans/](../../../docs/plans/), linked from the feature, never copied into it.
4. Backlog items are promoted into a milestone before work starts.

- **S:** one feature entry with a one-line Intent, Scope and Acceptance, under the epic it touches, or under Milestone 1.7 *Bug Fixes* for a fix to shipped work.

### Epic gate — no epic in the repo, no code change

Planning lives only in this repository (Jira is no longer used, since 2026-11-11, roadmap 0.5.1).

- **An epic is a roadmap milestone.** Its ID is `M<R>-<M>` (Milestone 1.22 → `M1-22`), written at the end of the milestone heading: `### Milestone 1.22 — Sampled profiling and synthetic data (M1-22)`. Milestones created before 2026-11-11 keep their former key (`BA-<n>`) as their epic ID; links to the old Jira issues are history only.
- **A story is a roadmap feature** (`R.M.F`). A bug is a feature under the epic it affects, or under Milestone 1.7 *Bug Fixes*.
- **Every epic has a spec** at `specs/epics/<EPIC-ID>/spec.md` in the format in [specs/README.md](../../../specs/README.md), listed in its epic table. Before any code for its stories it is `Status: Confirmed`: written or finished, then confirmed by the user. `check-specs.py` fails when a milestone's epic has no spec or a spec has no status.
- The user's explicit go-ahead in the session ("make the changes", "go") confirms a spec you just showed them; record the date.
- Keep the epic spec high level: story detail in the roadmap, behaviour in capability specs, decisions in ADRs. Link, don't copy.
- **S:** no new epic or spec. The change goes under an existing epic whose spec is confirmed (or confirmation-waived), or Milestone 1.7.

### Branching convention — one epic, one branch, one PR

- **Branch:** `<type>/<EPIC-ID>-<short-description>`, e.g. `feat/M1-22-synthetic-data`. `<type>` is a Conventional Commit type (`feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`, `ci`, `build`), the highest-impact one among the epic's commits. `<short-description>` is lowercase kebab-case ASCII.
- **One open branch per epic.** Before starting a story, look for the epic's branch (`git branch -a --list '*/<EPIC-ID>-*'`) and worktree (`git worktree list`); continue there if they exist. Stories of an epic don't get their own branches or PRs.
- **S changes** to shipped work whose epic has no open branch get their own branch `fix/<roadmap-id>-<short-description>` and PR.
- **Worktree:** one per epic, `.claude/worktrees/<EPIC-ID>-<short-description>` (the branch name without the type) when you create it yourself. A worktree created by a host tool (Conductor, the Claude desktop app) keeps its folder; work in it, and give the branch the convention name before the PR opens (ask the user first when the tool says not to rename).
- **Unit worktrees (agent org):** a `builder` agent's temporary worktree on `unit/<EPIC-ID>-<roadmap-id>`, cut from the epic branch, exempt from the naming rule, never a PR, removed once merged into the epic branch ([delivery.md](../../../specs/system/delivery.md) section 12).
- **Traceability:** each commit is scoped to its story: `feat(1.22.3): …` (older branches used `feat(BA-115): …`). The PR description lists every story with its roadmap ID.
- Nothing goes directly on `main`.

## 4. Architecture decisions (L changes)

**Every architectural decision is an ADR in [specs/system/architecture.md](../../../specs/system/architecture.md)**, under the right C4 level (System Context → Containers → Components → Code), *before* any code: `ID`, `Title`, `Status`, `Date`, `Context`, `Decision`, `Consequences`. Never edit a prior ADR's substance; supersede it with a new ADR and mark the old one `Superseded by ADR-NNNN`.

Architectural: choosing or replacing a framework, splitting or merging containers (Electron main, renderer, NestJS backend, npm CLI), a new external system (LLM provider, datasource type), changing data-flow direction, a new integration boundary, a persisted-shape change that needs a migration. Not architectural: file moves, renames, day-to-day feature work. Skip this step when none applies.

## 5. Specs

**[specs/](../../../specs/README.md) is the single source of truth for what the app does and how it is built**, complete enough that an LLM given only that folder could rebuild the app. Before any test or code, update every spec the change affects.

- **Specs change with the code, on the same branch.** A PR that changes behaviour, an endpoint, a persisted shape, an agent prompt or tool, the UI, or the build and release process without the matching spec change is incomplete.
- **Where things go:** behaviour rules and user flows → `specs/capabilities/<capability>/spec.md`; endpoints, IPC and CLI → `system/api.md`; collections, document shapes, files on disk and migrations → `system/data-model.md`; agents, prompts, tools and model routing → `system/agents.md`; layout, screens, tokens and copy → `system/ui.md`; frameworks, versions and code layout → `system/tech-stack.md`; build, packaging, release and developer tooling → `system/delivery.md`; terms → `product/glossary.md`. A new capability gets a folder and a row in the [specs/README.md](../../../specs/README.md) table.
- **Each fact lives in one file.** Link to it; never copy it.
- **CI enforces coverage:** `python3 scripts/check-specs.py` runs on every PR and is a required check. It fails when a route, collection, agent, Playwright spec, capability or roadmap epic has no spec, or a link breaks. It proves coverage, not correctness. Run it before pushing.
- **Gherkin:** every user-facing flow is a `Scenario:` under a `Feature:` in the Flows section of the capability spec that owns it (`Given / When / Then / And`), written from the user's point of view (`When I click "New session"`). It covers navigation, dialogs, panels, toasts, form submits, chat and stream behaviour and visual tailoring, not purely visual tweaks or refactors. Each Feature names its Playwright spec file, or says `E2E: none yet`.
- **S:** update only the spec lines that state the fact you changed; a change no spec describes needs none.
