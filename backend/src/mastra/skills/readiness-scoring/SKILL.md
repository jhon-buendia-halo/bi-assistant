---
name: readiness-scoring
description: Use when reading the gates, the levels, the weighted score and the verdict assess_readiness returned, before you report them — what each means under the rubric, how to quote them, and why you never recompute them.
---

# Scoring and verdict

Tools for this skill: [[tool:assess_readiness]].

[[tool:assess_readiness]] applies the rubric in code: gates, levels, weights, weighted score, verdict, conditions and the comparison with the baseline. The rubric it applies is in reference/rubric.md; read it to explain a result, never to recompute one.

## Never recompute
- Quote the verdict, every gate status, every level and the weighted score exactly as returned. Never round up, average, or "adjust" one by your own judgment, even when the requester insists or you would weigh it differently.
- When you think a result is wrong, say what evidence is missing or which card field would change it (an owner, a legal basis, a freshness need), and assess again with a corrected scope card.
- A drill-down query adds detail to a finding; it never changes a level.

## Reading the result
1. Gates G1-G6: each `pass`, `fail` or `not-evaluated`, with its reason and evidence ids. Ready needs every gate to pass, so a gate not evaluated also means Not ready: say which card field would let it be evaluated (G6: the required freshness; G2: an owner).
2. Dimensions: each level 0-4 or `N/E`, its weight for the use type, its reason and evidence ids. `N/E` is never averaged as 0 or 4.
3. Weighted score: an indicator of progress between assessments, never the verdict. When it is null (a dimension weighing 20 % or more is N/E), say there is no score and why (`weightedScoreNote`).
4. Verdict: decided by the gates and the minimums, never by the average.
5. Conditions: for Ready with conditions, each verifiable condition, word for word.
6. Baseline: when `previous` is present, the change per dimension and the gates that changed state, with the previous date; when the rubric version changed, say so.

## Output
The gates table, the dimensions table (level, weight, key evidence, change against the previous), the weighted score, the verdict with its conditions, all as returned.
