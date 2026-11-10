# 1.21.9 — Ontology suggestions from the data

Ships the `knowledge-bootstrap` agent (key kept, shown as Ontology Bootstrap) drafting concepts with column mappings, relations, constraints and instructions from the dataset's schema, samples, relationships and metrics. Drafts arrive disabled in Pending suggestions; bad mappings and unresolved relations are dropped in post-processing. Fix on the branch: the first live run failed with `Structured output validation failed: drafts: Too big` because the output format capped drafts at 15; the cap now applies after post-processing.

## Gherkin scenarios and the specs that cover them

Specs: [dataset-ontology](../../specs/capabilities/dataset-ontology/spec.md), [agents.md](../../specs/system/agents.md) 2.5.

| Scenario | Playwright spec |
|---|---|
| Generate suggestions from the dataset | `frontend/e2e/dataset-ontology.spec.ts` ("generates suggestions, then accepts and rejects them", 14 passed) |
| Accept a pending suggestion | same test |
| Reject a pending suggestion | same test |
| Generation fails | `frontend/e2e/dataset-ontology.spec.ts` ("generation fails without adding suggestions") |

Post-processing is covered by backend unit tests. The Ontology Bootstrap has no eval set (agents.md 8); the live World Cup run (15 drafts) and the `dataset-ontology.spec.ts` generate/failure scenarios with the LLM stub cover it.

## Artifacts

- [generated-suggestions-pending.png](generated-suggestions-pending.png): generated suggestions in Pending suggestions.

Desktop: not run (web target only).
