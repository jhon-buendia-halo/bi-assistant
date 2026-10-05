# Changelog

Running log of every meaningful change, newest first. See *Logging convention* and *Evidence convention* in [CLAUDE.md](CLAUDE.md). Release versions come from Conventional Commits (`version-on-merge.yml`); this file records what shipped and links to the evidence.

## 2026-10-05

### Added
- **Learn from reviewer feedback, business expert mode and the eval loop, integrated on one branch** (roadmap 1.3.5, epic [BA-4](https://halo-powered.atlassian.net/browse/BA-4); Jira story pending, Epic gate waived by the user for this branch). `feat/knowledge-learning-evals` merges three branches that were built on the same base and never reached `main`:
  - `docs/eval-suites-specs`: eval suites as data files, failure categories, token and cost accounting, CLI runner.
  - `feat/engine-eval-loop`: engine levers in Settings, eval arms, pass^k repeats, fixed-model judge, `answer-review` agent, Databricks Model Serving, supply-chain and banking fixtures (ADR-0011, ADR-0012).
  - `feat/business-expert-learning`: business expert mode (reasoning trace, measured confidence, per-block feedback), lessons distilled from reviewer comments into Knowledge with provenance, answer pinning, HR and retail fixtures (ADR-0008 to ADR-0010).

  The 30 conflicted files were resolved keeping both sides:
  - The business flow runs inside the engine's single production turn (`runTurn`).
  - Evals never replay or save a pinned answer.
  - Knowledge keeps strict tiers (default filters, lessons, the rest) with the 8,000-character skip-and-continue budget; the `rankedKnowledge` lever re-orders only inside each tier (knowledge R33).
  - The CLI eval harness keeps arms and pass^k and gains `--expert` scoring.
  - `fixtures:register` covers all seven fixture domains.

  The user's existing profile (World Cup, Health Insurance and Genomics datasets, 6 sessions, 27 Knowledge snippets) opens unchanged on the merged build. The merge only adds the `reasoning_feedback` and `answer_pins` collections, with no renames. Evidence: [evidence/1.3.5/](evidence/1.3.5/) (24/24 E2E, 2008 backend tests, screenshots of the existing data). No eval or LLM call was run.

## 2026-10-04

### Changed
- Roadmap 0.1.1 (the renderer ignoring a non-default `BACKEND_PORT`) is now **1.7.20** under Bug Fixes. It is tracked as Jira bug [BA-109](https://halo-powered.atlassian.net/browse/BA-109) under epic BA-11, because Milestone 0.1 has no epic and the Epic gate would block it. 0.1.1 is marked `🚫 Cut` with a pointer to the new entry. References in CLAUDE.md, the BA-11 epic spec and the specs (`non-functional.md`, `delivery.md`, `api.md`) are updated. Evidence: docs only; `python3 scripts/check-specs.py` passes and the spec check is green on the PR.

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
