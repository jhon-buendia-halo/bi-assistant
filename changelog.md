# Changelog

Running log of every meaningful change, newest first. See *Logging convention* and *Evidence convention* in [CLAUDE.md](CLAUDE.md). Release versions come from Conventional Commits (`version-on-merge.yml`); this file records what shipped and links to the evidence.

## 2026-10-01

### Changed
- Roadmap 0.2.1 ([BA-84](https://halo-powered.atlassian.net/browse/BA-84)) is now `✅ Done`. The delivery workflow, beta roadmap and branching convention shipped in **v0.20.3** via [jhon-buendia-halo/bi-assistant#43](https://github.com/jhon-buendia-halo/bi-assistant/pull/43).
- Evidence: docs-only change. The PR, its merge commit `04f0c0a` and the `v0.20.3` tag are the record, and no E2E run was needed.

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
