---
name: readiness-gap-remediation
description: Use when a readiness assessment's verdict is read and the plan is next — turn its findings into a prioritised remediation plan with suggested owners, effort, verifiable closing criteria and temporary mitigations, and recommend permanent controls.
---

# Gaps and remediation

Tools for this skill: [[tool:run_readonly_sql]].

Built from the findings [[tool:assess_readiness]] returned: every gap cites the finding and evidence ids behind it. You recommend; you never run the remediation or change data.

## For each gap
| Field | Content |
|---|---|
| ID | GAP-001… |
| Dimension / gate | D2, G4… |
| Description | What is wrong, measured: "23 % of tickets without `product_id` (threshold 0 %)" |
| Impact on the use | What happens if it is not fixed |
| Severity | Blocking / High / Medium / Low, from the finding |
| Suggested owner | A role or team: Data Engineering, Analytics Engineering, the business owner, Legal / Privacy |
| Estimated effort | S (< 1 week) / M (1-4 weeks) / L (> 4 weeks) |
| Recommended action | What to do, without doing it |
| Closing criterion | A verifiable measure: "`product_id` null < 0.5 % over the last 30 days, with an automatic test" |
| Temporary mitigation | How to use the data meanwhile, when possible |

## Prioritise
1. Blocking gates first.
2. Then by impact on the use over effort: high impact and low effort first.
3. Group the gaps that share a root cause (one pipeline without monitoring) into one action.

## Common actions
| Problem | Typical action | Typical owner |
|---|---|---|
| Nulls or duplicates in key fields | Fix at the source or in the transformation; add a test | Data / Analytics Engineering |
| No SLA or no monitoring | Define the SLA; freshness and volume alerts | Data Engineering |
| No documentation | Document the critical columns; define the metrics | Analytics Engineering + business owner |
| Personal data not needed | Exclude, mask or aggregate | Data Engineering + Privacy |
| Doubtful legal basis | Legal review before use | Legal / Privacy |
| No data contract | Agree schema, SLA and quality with the producer | Producer + consumer |

## Permanent controls
So the data stays ready after the assessment, recommend: an automatic test for each critical threshold, freshness and volume alerts, data contracts with the producers, and a periodic reassessment (quarterly, or when the schema changes).

## Output
The ordered remediation plan, and the 3-5 main gaps for the report. You open no ticket: the requester takes the plan to their tracker.
