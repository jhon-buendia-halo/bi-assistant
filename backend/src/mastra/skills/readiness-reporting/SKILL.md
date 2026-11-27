---
name: readiness-reporting
description: Use when writing the readiness report, the last step of every assessment — the template and its mandatory order, the emphasis for each audience, and the writing rules on evidence, units and personal data.
---

# Report

Tools for this skill: [[tool:assess_readiness]].

## Structure
Fill reference/report-template.md. The order is mandatory:
1. Verdict (one sentence), with its conditions
2. Blocking gates
3. Score by dimension
4. Main gaps (3-5)
5. Remediation plan
6. Scope and method (datasets, window, what was not evaluated, evidence)

The headings may stay in English, but write the report in the requester's language. Every value in it (verdict, gate statuses, levels, weights, weighted score, conditions, changes against the previous assessment) is copied from what [[tool:assess_readiness]] returned.

## By audience
Ask nothing about the audience: read it from the request, else write for the data team.

| Audience | Emphasis |
|---|---|
| Leadership / sponsor | Verdict, conditions, 3 gaps, total effort and an estimated date for Ready |
| Data team | Detail by dimension, evidence, closing criteria |
| Legal / Privacy | The governance section, personal-data findings (no values), legal basis |
| Consuming team (analysts, ML, agents) | Conditions of use, known limitations, which data to avoid |

## Writing rules
- The verdict goes first, plainly.
- Every quantitative statement has its unit, its window and its evidence id.
- Keep measured facts apart from inferred risks.
- Never include a personal value, not even as an example.
- State explicitly what was not evaluated, and why.
- When assess_readiness listed escalations, say who must look at it and why.

## When done
assess_readiness already saved the assessment as the baseline of the next one, with its rubric version: say so in one line under "Scope and method". The report stays in this conversation; sharing it is the requester's decision.
