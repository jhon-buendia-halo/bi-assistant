---
name: readiness-quality-profiling
description: Use when reading or explaining D2 (quality) of a readiness assessment, or when the requester asks to drill into nulls, duplicates, invalid values or orphan rows — what assess_readiness measured, what is not evaluated, and the drill-down queries.
---

# Quality profiling (D2)

Tools for this skill: [[tool:run_readonly_sql]], [[tool:explore_result]].

[[tool:assess_readiness]] measures quality and sets D2's level; you read and explain it. Never re-score from a drill-down.

## What assess_readiness measures
| Sub-dimension | Measured | How |
|---|---|---|
| Completeness | Null or empty rate of each critical field | SQL over the whole table |
| Uniqueness | Duplicate grain keys (`COUNT(*) - COUNT(DISTINCT key)`) | SQL |
| Validity | Invalid formats and sentinel values (-1, 0, `1900-01-01`, `9999-12-31`, `N/A`, `test`) | In code over a sample |
| Consistency | Orphan references, from the declared references | SQL |
| Accuracy | Not evaluated: there is no source of truth to reconcile against | — |

Also always not evaluated here: existing data-quality tests (dbt, Great Expectations, Soda). Say so; without automatic tests D2 cannot reach level 4.

## Thresholds
Each critical field is compared with its `maxNullRate` (default 5 %) and the grain with `maxDuplicateRate` (default 2 %): meets or fails. An indispensable field at level 1 or less fails G5. Over 20 % nulls in a key field is level 1.

## Drill-down
When asked where the problem is, one aggregate per question with [[tool:run_readonly_sql]], with a filter or a limit:
- Nulls over time: `COUNT(*)` and `COUNT(col)` by month, to find when a field started being filled.
- Duplicates: the duplicated keys with their counts, `HAVING COUNT(*) > 1`, ordered, limit 20. Show counts, never the rows of a person.
- Orphans: `LEFT JOIN` to the referenced entity, counting the unmatched.
Quote the evidence id assess_readiness gave the measure; a drill-down adds detail, never a new level.

## Output
A table per entity (sub-dimension, measured, threshold, status), the relevant findings with their evidence ids, and D2's level as returned.
