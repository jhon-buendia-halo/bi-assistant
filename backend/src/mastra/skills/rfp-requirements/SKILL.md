---
name: rfp-requirements
description: Use when an RFP is at stage 5 (requirements and questionnaire): tailor the standard bidder questionnaire to the lines in scope and save it.
---
# Stage 5 — Requirements and questionnaire

Goal: agree what every bidder must answer. Start from the standard
questionnaire below, tailor it to the lines and funding in scope, then add
the consultant's client-specific asks.

Tools for this stage: [[tool:get_rfp]], [[tool:get_client_commercials]],
[[tool:set_rfp_requirements]], [[tool:update_rfp]], [[tool:update_workflow]].

## Start

Before anything else in this stage, call `update_workflow` with
`current` 5, `done` "1,2,3,4", a `note` saying what you need from
the consultant in this stage, a `todo` "5: <the action for this
client>" (one line, at most 120 characters) and `waiting` true.

## Read

`get_rfp(rfpId)` for the lines in scope, their market basis and alternate
funding, and the carriers invited. Use `get_client_commercials` when point
solutions or contribution periods matter to a question.

## The standard questionnaire

Pick 3 to 6 questions per section that fit the lines in scope; drop a
section that doesn't apply.

- **Company and financials**: financial strength ratings; years writing the
  line; book of business in the client's states; references from clients of
  similar size.
- **Network and access**: network match for the client's census by state
  (attach a disruption report); provider counts within access standards;
  out-of-network terms.
- **Plan design match**: confirm the quote matches each current plan design
  as-is; list every deviation; for alternates, the proposed design in full.
- **Pricing and rate guarantees**: rates by tier for the plan year; rate
  guarantee length; renewal caps; commissions and fees included.
- **Funding and stop-loss** (self-funded lines, or an alternate to
  self-funding, only): administrative fee PEPM; specific and aggregate
  stop-loss terms; claims run-out; laser policy.
- **Administration and service**: account team; claims turnaround; member
  service hours; eligibility file formats and frequency.
- **Implementation**: implementation plan and timeline to the effective
  date; implementation credits; open enrollment support.
- **Data and reporting**: standard reports and frequency; claims data
  access; reporting for the employer contribution strategy.
- **Point solutions and wellness**: integration with the client's current
  point solutions; wellness funds.
- **Legal and compliance**: contract terms; performance guarantees with
  fees at risk; HIPAA and data security attestations.

Mark as required what every bid must answer to be comparable (pricing,
plan design match, network, rate guarantees); the rest optional.
Answer types: `text`, `yes_no`, `number`, `table` (rates, census-based
grids) or `attachment` (reports, contracts).

## Propose

Show the questionnaire grouped by section, numbered, with required or
optional and the answer type. Ask the consultant what to add, remove or
reword, and for any client-specific asks.

## Save

Only after the consultant confirms (a change the consultant states outright,
such as "swap carrier A for B", is already confirmed: save it at once):

1. `set_rfp_requirements(rfpId, requirements)` with one row per question:

   `<section> | <question> | required yes|no | text|yes_no|number|table|attachment`

   Example:

   ```
   Pricing and rate guarantees | Provide monthly rates by tier for 2027 | required yes | table
   Network and access | Attach a provider disruption report for the census | required yes | attachment
   ```

   A question must not contain " | ". Send every question each time: the
   list replaces the saved one.
2. `update_rfp(rfpId, stage=5)`.

Then introduce stage 6: the timeline.
