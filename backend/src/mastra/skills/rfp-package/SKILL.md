---
name: rfp-package
description: Use when an RFP is at stage 7 (assemble and review): write the narrative sections, review the whole record and export the RFP package.
---
# Stage 7 — Assemble and review

Goal: write the remaining narrative sections, review the whole RFP with the
consultant, and export the package.

Tools for this stage: [[tool:get_rfp]], [[tool:update_rfp]],
[[tool:export_rfp_package]], [[tool:show_in_panel]], [[tool:update_workflow]].

## Start

Before anything else in this stage, call `update_workflow` with
`current` 7, `done` "1,2,3,4,5,6", a `note` saying what you need from
the consultant in this stage, a `todo` "7: <the action for this
client>" (one line, at most 120 characters) and `waiting` true.

## Read

`get_rfp(rfpId)`: the header, the sections already written (client
background, scope statement), and the four lists.

## Write the narrative sections

Write each from the saved record, in the consultant's voice, and save it
with `update_rfp(rfpId, sectionName=…, sectionText=…)`, one call per
section. Fill every bracket from the record; leave nothing as a placeholder.

- **executiveSummary**: "On behalf of [client name], Mercer invites
  proposals for the [lines in scope] coverage effective [effective date],
  for plan year [plan year]. [One sentence on why the client is going to
  market, from the scope statement.] Proposals are due [proposals due
  date]; the client expects to decide by [decision date]."
- **instructionsToBidders**: how to respond: confirm intent to bid by
  [intent date]; send questions by [questions due date], answered to every
  bidder by [answers published date]; submit the proposal by [proposals due
  date], answering every required question in the order of the
  questionnaire, with rates in the tables requested; deviations from the
  current plan designs listed separately; proposals valid for at least 120
  days. Contact: the Mercer consultant.
- **evaluationCriteria**: the factors proposals are compared on, in order:
  total cost (premium or expected claims plus fees) and rate guarantees;
  network match for the census; plan design match and deviations; service
  and implementation; financial strength; performance guarantees. Say that
  the client may shortlist finalists and ask for best-and-final offers.

## Review checklist

Check each point against the record and show the result as a short list:

- Every line in scope has plan designs or an explicit "all".
- Every line in scope has at least two carriers invited.
- Every questionnaire section has at least one question.
- The timeline ends on the effective date, and no date is out of order.
- Every narrative section is written: executive summary, client
  background, scope statement, instructions to bidders, evaluation
  criteria.

Report anything that fails and offer to fix it in its stage. Then ask the
consultant to confirm the review.

## Save and export

Only after the consultant confirms the review:

1. `update_rfp(rfpId, status='ready', stage=7)`.
2. `export_rfp_package(rfpId)`.
3. `show_in_panel(kind='file', path='rfp/<rfpId>/rfp.md')`.

Then say what the package holds: the RFP document in Markdown (`rfp.md`)
and PDF (`rfp.pdf`), four exhibits as CSV files (A census, B plan designs,
C financials, D carriers) and a manifest, and that it downloads from the
package card in this chat. Exporting again later replaces it with the
record as it then stands.

## Avoid

- Do not export before the review is confirmed.
- Do not move the status back: it only moves forward.
