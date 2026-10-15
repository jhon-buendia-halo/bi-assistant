---
name: rfp-market-scope
description: Use when an RFP is at stage 3 (what to market): decide the lines in scope, as-is or with alternates, and write the scope statement.
---
# Stage 3 — What to market

Goal: decide which lines of coverage go out to bid, and for each whether
carriers quote the current plans as they are or an alternate funding type
or plan type.

Tools for this stage: [[tool:get_marketing_history]],
[[tool:list_reference_data]], [[tool:get_client_renewals]],
[[tool:get_client_program]], [[tool:set_rfp_lines]], [[tool:update_rfp]], [[tool:update_workflow]].

## Start

Before anything else in this stage, call `update_workflow` with
`current` 3, `done` "1,2", a `note` saying what you need from
the consultant in this stage, a `todo` "3: <the action for this
client>" (one line, at most 120 characters) and `waiting` true.

## Read

1. `get_marketing_history(clientOneCode)`: past wizard runs (`line`, `type`
   such as marketing, renewal, benchmark or new plan, `status`) and the
   alternate plans they produced (`planType`, `name`, `fundingType`, `line`).
2. `list_reference_data(kind='funding-types')` and, for each line where an
   alternate is on the table, `list_reference_data(kind='plan-types', line)`.
   Only these names are valid alternates.
3. The renewals and program from stages 1 and 2 are already in the
   conversation; call `get_client_renewals` again only if they are not.

## Propose

Build a proposal from what the data shows, and say why for each line:

- Lines whose renewal increase is above the client's overall increase (the
  totals from stage 2) are candidates to market.
- Lines with an alternate plan from a past wizard can be marketed with that
  alternate as well as as-is.
- A line marketed recently (a completed marketing wizard) may not need to go
  out again; say so and let the consultant decide.
- Everything else stays as-is or out of scope.

Do not claim a line has "been with the carrier for years" or that a funding
change "would save money": the data shows neither. Say what the data shows
and let the consultant decide.

Show the proposal as a table: line, market basis (as-is or alternate), plans
in scope (plan types, or "all"), alternate funding, alternate plan type,
reason. Ask the consultant to confirm or change it.

## Save

Only after the consultant confirms (a change the consultant states outright,
such as "swap carrier A for B", is already confirmed: save it at once):

1. `set_rfp_lines(rfpId, lines)` with one row per line in scope:

   `<line> | as-is|alternate | <plan design ids, comma-separated, or all> | <alternate funding or -> | <alternate plan type or -> | <notes>`

   Example:

   ```
   Medical | alternate | all | Self-Funded | - | Quote the current PPO and HDHP plus a self-funded option
   Dental | as-is | all | - | - | -
   ```

   Use the line names exactly as the data spells them, the plan design ids
   from `get_client_program` (or `all`), and `-` for an empty field. The
   list replaces the saved one, so send every line in scope each time.
2. Write the scope statement: which lines are marketed, on what basis, and
   why, in the consultant's voice. Save it with
   `update_rfp(rfpId, sectionName='scopeStatement', sectionText=…)`.
3. `update_rfp(rfpId, stage=3)`.

A validation error that names a line or a plan design id means it isn't the
client's: fix the row from the data and retry, without asking the consultant.

Then introduce stage 4: the carriers to invite for these lines.
