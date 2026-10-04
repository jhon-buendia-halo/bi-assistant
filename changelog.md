# Changelog

Running log of every meaningful change, newest first. See *Logging convention* and *Evidence convention* in [CLAUDE.md](CLAUDE.md). Release versions come from Conventional Commits (`version-on-merge.yml`); this file records what shipped and links to the evidence.

## 2026-10-04

### Added
- **The spec check is now required on `main`** (roadmap 0.2.3, [BA-108](https://halo-powered.atlassian.net/browse/BA-108)):
  - A repository ruleset requires "Specs match the code" before a PR can merge. Direct pushes without that status are rejected.
  - [`version-on-merge.yml`](.github/workflows/version-on-merge.yml) still pushes its release commit straight to `main`. Before pushing, it runs `scripts/check-specs.py` on the bump commit, stages the commit on `release-staging/<sha>` and reports the status itself.
  - Documented under *Branch ruleset on `main`* in [specs/system/delivery.md](specs/system/delivery.md).
  - Evidence: [evidence/0.2.3/](evidence/0.2.3/).
- **Rebuildable system specs** (roadmap 0.2.2, [BA-90](https://halo-powered.atlassian.net/browse/BA-90), epic [BA-89](https://halo-powered.atlassian.net/browse/BA-89)). New [specs/](specs/README.md) tree, written so an LLM given only that folder can rebuild the app:
  - product specs: vision, glossary, non-functional requirements;
  - system specs: architecture, tech stack, data model, API (all 52 routes, the chat stream, IPC, CLI), agents (every prompt, tool and model rule), UI and delivery;
  - 13 capability specs, each with rules, edge cases, contracts and Gherkin;
  - epic specs for all BA epics. The existing ones are `Status: Draft` until their owners confirm them.

  [specs/README.md](specs/README.md) defines the formats, the stack-neutrality rule, the lifecycle, the files a rebuild copies verbatim, and the rebuild prompt. Evidence: [evidence/0.2.2/](evidence/0.2.2/).
- CLAUDE.md **Epic gate**: no code change without a Jira epic. Every epic gets a spec at `specs/epics/<EPIC-ID>/spec.md`, confirmed before its stories start.
- CLAUDE.md **Spec convention**: specs change on the same branch as the code, so `main` always describes the shipped app.
- **Spec checks in CI:** [`.github/workflows/spec-checks.yml`](.github/workflows/spec-checks.yml) runs [`scripts/check-specs.py`](scripts/check-specs.py) on every PR and every push to `main`. It fails when a backend route, collection, agent, Playwright spec, capability or roadmap epic has no spec, or a link breaks. It is the repo's first pull-request check. A drift test with 7 faults injected failed all 7 matching checks: [evidence/0.2.2/check-specs-negative-test.txt](evidence/0.2.2/check-specs-negative-test.txt).
- Roadmap Milestone 0.2 now mirrors the new Jira epic BA-89 (Delivery Process). BA-84 is linked to it in Jira.
- The user waived confirmation, as a one-time exception, for the eight draft epic specs (BA-2, BA-4, BA-5, BA-9, BA-10, BA-11, BA-12, BA-82). Their stories, including the new bugs, can start. The exception is recorded under *Epic gate* in [CLAUDE.md](CLAUDE.md) and in each spec's status line.
- Filed the backfill's 10 likely bugs and 7 security gaps as Jira bugs BA-91 to BA-107 under BA-11. They are mirrored in roadmap Milestone 1.7 as features 1.7.3 to 1.7.19, security first. Details: [evidence/0.2.2/findings.md](evidence/0.2.2/findings.md).

### Changed
- `architecture.md` moved to [specs/system/architecture.md](specs/system/architecture.md).
- The five Gherkin Features moved verbatim from `gherkin.md` into their capability specs. The *Gherkin convention* became part of the *Spec convention*, and the E2E convention now mirrors the capability specs.
- CLAUDE.md went from 329 to about 170 lines. Its how-it-works sections (Electron delivery, versioning, npm package, folder layout, datastore, Mastra, visuals) moved into `specs/system/` and were checked against the code. A short *Code rules* list replaces them. Workflow steps 3, 4, 5, 9 and 10 and the worktree deploy convention were updated. Drift fixed:
  - Docker is started by the E2E global setup.
  - Only the Electron main process reads `BACKEND_PORT`.
  - Desktop isolation uses `QUESTIONS_TO_INSIGHTS_USER_DATA_DIR`.
- README.md now links to `specs/` instead of CLAUDE.md for packaging and architecture details.
- Roadmap 0.2.1 (BA-84) marked `✅ Done`; it merged in PR #43.

### Removed
- `gherkin.md`. Every scenario now lives in exactly one capability spec.

## 2026-10-01

### Added
- Adopted the eleven-step delivery workflow in [CLAUDE.md](CLAUDE.md) (retrospective-first, roadmap → ADR → Gherkin → E2E impact analysis → tests-first → implement → green → changelog + evidence → retrospective) and seeded [roadmap.md](roadmap.md), [architecture.md](architecture.md), [gherkin.md](gherkin.md), [retrospective.md](retrospective.md), [evidence/](evidence/).
- Filled in the harness resources that were still missing: C4 Mermaid diagrams for all four levels in [architecture.md](architecture.md) (system context, containers, backend + frontend components, visual tailoring loop); Given/When/Then steps for all 20 scenarios in [gherkin.md](gherkin.md).
- Corrected [CLAUDE.md](CLAUDE.md) where it had drifted from the code:
  - The frontend is not routed yet. Features have no `pages/`, routes or store, and some `core/` folders are empty placeholders.
  - Lists every registered Mastra agent, plus the DuckDB observability store and the `infrastructure/crypto` key encryption.
  - Visuals: spec-first designer with a freeform fallback, the full version-folder file list inside the session workspace, and the tailor/refresh/repair endpoints.
  - The chat stream is `POST …/messages/stream` read with `fetch`.
  - Flags the hardcoded renderer port as a known gap.
- Added the **Branching convention** to [CLAUDE.md](CLAUDE.md): every PR is built in its own `<type>/<US-ID>-<short-description>` feature branch and git worktree, tied to an existing Jira user story.
- Roadmap: imported the **1.0 Beta** plan from Jira BA (target 2026-10-31) as Release 1. There are 7 milestones (one per epic: Evals, Data Model DSL, Knowledge Store, Reliability Signals, Data Connectors, User Testing, Bug Fixes) and 13 features, linked to the BA issues. Agent Routines (BA-82) is in the Backlog.
- Roadmap: added Release 0 / Milestone 0.1 with 0.1.1, the renderer ignoring `BACKEND_PORT` (`📋 Planned`).
- Evidence: process/docs-only change, no code or UI change. Diagrams rendered cleanly with `@mermaid-js/mermaid-cli` v12.
