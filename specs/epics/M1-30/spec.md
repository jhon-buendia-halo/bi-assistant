# M1-30 — Consumption Gap Analysis

- **Roadmap:** Milestone 1.30 · **Status:** Confirmed (2026-11-16, the user picked approach C, "por lo general no podemos asumir que los modelos tengan lineage definido", dashboards as images and saved artifacts, the sample in the repo; then "adelante implementa todo" after the prototype.)

## Goal

Given a medallion model (schemas tagged Landing, Normalized, Consumption), the business questions and reference dashboards, the user learns which requirements the Consumption layer supports, where every gap's data lives (through lineage inferred without declared lineage) and which fix closes it, starting in which layer.

## Scope

- The World Cup Medallion sample (1.30.1); lineage inference and gap tracing (1.30.2); the Requirements Analyst, Layer Mapper and Gap Advisor (1.30.3); the report (1.30.4); the workflow, its Confirm requirements wait and its probes as answer sources (1.30.5).

## Out of scope

- A `gap-analysis` artifact kind; several saved dashboards in one run; declared lineage hints (dbt, SQL); eval sets for the three new agents (follow-up).

## Stories

| Story | What | Status |
|---|---|---|
| 1.30.1 | World Cup Medallion sample | Done |
| 1.30.2 | Lineage inference and gap tracing | Done |
| 1.30.3 | Requirements Analyst, Layer Mapper and Gap Advisor | Done |
| 1.30.4 | The gap report | Done |
| 1.30.5 | The workflow | Done |

## Specs touched

- [agents.md](../../system/agents.md) 1.1, 2.18–2.20, 5.12, 5.20; [workflows](../../capabilities/workflows/spec.md) R1, R21, R31, R37; [testing-data](../../capabilities/testing-data/spec.md); [architecture.md](../../system/architecture.md) ADR-0051.

## Acceptance

- A run on the World Cup Medallion sample with the six example questions of the plan waits at Confirm requirements, goes on after the answer, and ends with the report: each of the six questions gets the status the plan names, and every probe opens in the query inspector.

## Dependencies, risks and open questions

- Plan: [docs/plans/m1-30-consumption-gap-analysis.md](../../../docs/plans/m1-30-consumption-gap-analysis.md).
- Name-based lineage misses renamed columns whose values do not overlap; the Layer Mapper's per-layer sources add `mapped` edges for those.
