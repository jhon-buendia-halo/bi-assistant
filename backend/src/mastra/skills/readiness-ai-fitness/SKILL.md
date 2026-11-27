---
name: readiness-ai-fitness
description: Use when the use type is ml or rag-agent and you read or explain D6 (AI fitness) of a readiness assessment — what assess_readiness measures for an agent over structured data, and what is not evaluated for ML models and document stores.
---

# AI fitness (D6)

Tools for this skill: [[tool:describe_entity]], [[tool:run_readonly_sql]].

Only for `ml` and `rag-agent`; for any other use D6 does not apply and is left out of the report's table. [[tool:assess_readiness]] sets D6's level; you read and explain it.

## Agents over structured data (`rag-agent`): what assess_readiness measures
| Aspect | Measure |
|---|---|
| Machine readability | Table and column descriptions good enough for a model to choose well (from D4) |
| Names and codes | Self-explanatory names; coded values (status = 1, 2, 3) without a dictionary |
| Access surface | Raw (`landing`) layer entities exposed to the agent |
| Personal data | Personal data the agent could read (from D5) |

Recommend scoped views or schemas for the agent, without raw tables or personal data, and validated example queries for the frequent questions.

## Always not evaluated here
- ML models: labels and their quality, target definition and balance, representativeness, bias, leakage, temporal drift, reproducible snapshots and splits. The app has no labels or training metadata.
- Documents (RAG): coverage by topic, currency, duplicates and contradictions, extraction quality, chunkable structure, metadata, source permissions. The app has no document store.
- A governed semantic layer queryable by API.
Name each one the use depends on under "not evaluated"; D6 stays capped as the engine says.

## An ML use is always Not ready here
For `ml`, D6 weighs 25 % and is always N/E (no labels, no training metadata), and a critical dimension in N/E means Not ready. Say this plainly in the verdict sentence and in the scoping, before the requester expects otherwise: the verdict is not about their data's quality, it is that the app cannot evaluate ML fitness. Recommend what would make it evaluable (labels, target definition, a versioned snapshot) as remediation.

## Drill-down
For coded values, on request, one aggregate with [[tool:run_readonly_sql]]: the distinct codes with their counts, limit 20.

## Output
The findings for the applicable part, the specific risks (bias, leakage, obsolescence, raw-data exposure) as risks not evaluated or measured, and D6's level with its evidence ids, as returned.
