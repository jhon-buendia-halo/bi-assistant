---
name: rfp-carriers
description: Use when an RFP is at stage 4 (carriers to invite): propose the incumbents and the carriers writing each line in scope, and save the bid list.
---
# Stage 4 — Carriers to invite

Goal: agree the bid list for every line in scope: the incumbents, plus the
carriers that write the line.

Tools for this stage: [[tool:get_rfp]], [[tool:list_carriers]],
[[tool:get_client_commercials]], [[tool:set_rfp_carriers]],
[[tool:update_rfp]], [[tool:update_workflow]].

## Start

Before anything else in this stage, call `update_workflow` with
`current` 4, `done` "1,2,3", a `note` saying what you need from
the consultant in this stage, a `todo` "4: <the action for this
client>" (one line, at most 120 characters) and `waiting` true.

## Read

1. The lines in scope come from the saved record: `get_rfp(rfpId)` if they
   are not already in the conversation.
2. `list_carriers(line, clientOneCode)` once per line in scope. Each carrier
   has `name`, `code`, `lines` (the lines it writes), `incumbentFor` (the
   lines where it holds this client's live policy) and `finalCredits` (final
   carrier credits for this client that have not expired).
3. The carrier credits with their `expirationDate` from stage 2
   (`get_client_commercials`) when they are not in the conversation.

## Propose

For each line in scope:

- The incumbent, from `incumbentFor`. Always invite it, so the bid shows
  whether staying is competitive.
- The other carriers that write the line, from the list returned. When the
  list is long, propose the ones that write the most of the lines in scope
  (one carrier quoting several lines keeps the bid simple), and show the
  rest as optional.
- Flag an incumbent with final credits that expire at or before the renewal
  effective date: moving carriers may forfeit them, and the consultant will
  want that in view.

Aim for at least two carriers per line, so every line gets a real
comparison. If a line has only one carrier writing it in the data, say so.

Show a table: carrier, lines invited for, incumbent (yes or no), final
credits, notes. Name only carriers the tool returned; never add a carrier
from general knowledge. Ask the consultant to confirm, add contact emails
if they have them, or remove carriers.

## Save

Only after the consultant confirms (a change the consultant states outright,
such as "swap carrier A for B", is already confirmed: save it at once):

1. `set_rfp_carriers(rfpId, carriers)` with one row per carrier:

   `<carrier name> | <lines, comma-separated> | incumbent yes|no | <contact email or -> | <notes>`

   Example:

   ```
   Delta Dental | Dental, Vision | incumbent yes | - | Final credits expire 2026-12-31
   MetLife | Dental | incumbent no | - | -
   ```

   Spell each carrier exactly as `list_carriers` returned it. The list
   replaces the saved one, so send every carrier each time. An error
   `Unknown carrier "<x>". Known: …` means the name is misspelled: fix it
   from the list and retry.
2. `update_rfp(rfpId, stage=4)`.

Then introduce stage 5: the requirements and questionnaire.
