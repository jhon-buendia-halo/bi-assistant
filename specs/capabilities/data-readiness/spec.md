# Data readiness

**Removed (2026-11-26).** The user removed the Data Readiness Agent (Sarah, `data-readiness`), the **Assess Data Readiness** workflow (`data-readiness-assessment`), the deterministic DMBOK readiness engine, saved readiness reports, the readiness scorecard and the rows behind findings, together with the `backend/src/modules/data-readiness` module and its routes. This file stays so that links and history resolve; it holds no rule. The decision, what was kept and what happens to stored data are in [workflows](../workflows/spec.md) R51 and [agents.md](../../system/agents.md) 2.10. The sampled profile of the dataset editor (**Profile & synthesize**) is a different feature and stays: [synthetic-data](../synthetic-data/spec.md).

## Concepts

Nothing is defined here any more. The glossary keeps the retired terms marked as removed ([the glossary](../../product/glossary.md)).

## Rules

- R1. The app SHALL NOT offer the Data Readiness Agent, the Assess Data Readiness workflow, a readiness report, a readiness scorecard or the readiness routes. Stored data of the removed feature is handled as [workflows](../workflows/spec.md) R51 and [data-model.md](../../system/data-model.md) M17 and M18 say.

## Edge cases and errors

- A past chat of the removed agent keeps its transcript and its agent chip, continues on the Assistant and shows no readiness card.

## Contracts

- None. The readiness assess and report routes no longer exist ([api.md](../../system/api.md)).

## UI

- No readiness screen, panel item or card.

## Flows

None.

## Acceptance

- The Agent Hub lists no Data Readiness Agent, the Workflows area lists no Assess Data Readiness, and `GET /workflows/data-readiness-assessment` answers 404 ([workflows](../workflows/spec.md) R51).
