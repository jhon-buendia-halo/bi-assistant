---
name: readiness-scoping
description: Use when a readiness assessment starts — turn the request into the scope card assess_readiness takes (the use case, its measurable requirements and its risk level), asking only for what cannot be assumed.
---

# Scope the assessment

Tools for this skill: [[tool:ask_clarification]], [[tool:list_entities]], [[tool:describe_entity]], [[tool:assess_readiness]].

Always the first step. The card is what [[tool:assess_readiness]] measures against, and it becomes the "Scope and method" section of the report.

## Build this card
| Field | Question | Card field |
|---|---|---|
| Use case | What will the data be used for? | `useCase`, in the requester's words |
| Use type | Ad hoc analytics, a recurring dashboard or report, an ML model, or a RAG / AI agent? | `useType`: `analytics`, `dashboard`, `ml`, `rag-agent` |
| Consumer | Who or what consumes it? | `consumer` |
| Decision | Which decisions are taken with it? | `decision` |
| Critical entities and fields | What is indispensable? | `entities` (`schema.table` as [[tool:list_entities]] names it), `criticalFields` (`indispensable: true` for a field the use cannot do without) |
| Grain | What is one row? | `grainKeys`, when it is not the declared key |
| Required freshness | How old may the newest row be? | `requiredFreshnessHours` (24 for daily; omit when unknown) |
| Quality thresholds | What tolerance is there? | `maxNullRate` per field (default 5 %), `maxDuplicateRate` (default 2 %) |
| Personal data | Does it involve personal data? Is it needed? | `personalDataNeeded`, `legalBasis` when the requester documents one |
| Owners | Who owns each dataset? | `owners`, only when the requester names one: the app keeps no owner metadata |

## Risk level
| Level | Criterion | Rigour |
|---|---|---|
| `low` | Exploratory, internal use, reversible decision | Light sampling, key dimensions |
| `medium` | Recurring report, operational decision | Every dimension, standard sampling |
| `high` | Regulatory, financial, automated decisions about people, customer-facing | Every dimension, wide sampling, mandatory human review |

The engine sizes its samples by the risk (200, 1,000 or 5,000 rows).

## When to ask
Ask with [[tool:ask_clarification]] only when the use case, the required freshness, the critical fields, whether personal data is involved or the owner of the datasets are missing: at most 3 questions over the whole scoping, one per message, each with 2-4 options and a default. Batch what is missing into those three (one question can ask the freshness and the owner). Assume every other field reasonably and add each assumption to `assumptions`, in plain words ("The dashboard is internal, so the risk is medium").

Two fields decide the verdict on their own, so never leave them empty by accident:
- `requiredFreshnessHours`: without it G6 is not evaluated, and a gate not evaluated means Not ready. Ask for it, or assume it from the use type and write the assumption: `dashboard` 24 h, `analytics` 168 h, `ml` and `rag-agent` 24 h.
- `owners`: the app keeps no owner metadata, so with no owner named G2 fails and D1 is 1. Ask who owns each dataset; when the requester does not know, record "owner unknown" as an assumption and tell them this alone makes the verdict Not ready, with an escalation.

## Map before you call
Check that every entity and field on the card exists with [[tool:list_entities]] and [[tool:describe_entity]]. A critical field with no column in the data is a critical gap: name it in the report, and leave it off the card.

## Output
The scope card, passed to [[tool:assess_readiness]] as `scope`. It decides which dimensions apply (D6 only for `ml` and `rag-agent`) and the weights (reference in readiness-scoring).
