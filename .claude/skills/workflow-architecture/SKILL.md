---
name: workflow-architecture
description: Use at workflow step 4, whenever a change might be architectural (framework, container split, external system, data-flow direction, integration boundary, migration-needing persistence change): record it as an ADR in specs/system/architecture.md before any code.
---

# Step 4 — Architecture decisions

Part of the workflow in [CLAUDE.md](../../../CLAUDE.md), which keeps the always-on core (the mandatory first action, the step list, the fast loop and acceptance gate, the hard gates). Load this skill before the step starts.

## The step

4. **Update architecture** — if the change involves an architectural decision, record it as an ADR in [specs/system/architecture.md](../../../specs/system/architecture.md) under the relevant C4 level *before* any code is written.

## Architecture convention — record every architectural decision

**Every architectural decision is documented in [specs/system/architecture.md](../../../specs/system/architecture.md) using the C4 model** (System Context → Containers → Components → Code), as short ADRs with `ID`, `Title`, `Status`, `Date`, `Context`, `Decision`, `Consequences`. Never edit a prior ADR's substance — supersede it with a new ADR and mark the old one `Superseded by ADR-NNNN`.

Architectural: choosing or replacing a framework, splitting/merging containers (Electron main, renderer, NestJS backend, npm CLI), introducing an external system (LLM provider, datasource type), changing data-flow direction, new integration boundaries, persistence-shape changes that need migrations. Not architectural: file moves, renames, day-to-day feature work (roadmap + changelog). The other system specs in [specs/system/](../../../specs/system/) record *how* things work; ADRs record *why*.
