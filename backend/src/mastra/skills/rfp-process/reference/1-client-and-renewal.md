# Stage 1 — Client and renewal

Goal: agree with the consultant which client the RFP is for and which plan
year it buys, then open the RFP record. Nothing is marketed yet.

## Read

1. `list_clients` with the words the consultant used for the client (part
   of the name or the code). Each row has `oneCode`, `name`, `headcount`
   (the latest census total employees), `latestCensusYear`, `linesOffered`
   and `nextRenewalEffectiveDate`.
   - One match: carry on with it.
   - Several matches: `ask_clarification` with the matching names and codes
     as the options. Never pick one yourself.
   - None: say so, and ask for another spelling or the client code.
2. `list_rfps` with the client's `clientOneCode`, to see whether a record
   for this client already exists.
3. `get_client_renewals` with the client's `oneCode`. It returns `planYear`
   (the current plan year) and one renewal per line: `line`, `carrier`,
   `policyNumber`, `effectiveDate`, `kickOffTiming` (`name`, `days`),
   `kickOffDate`, `locStatus`, `annualPremium`, `renewalIncreasePct`.

## Show

- The client: name, code, headcount and latest census year.
- A table of the renewals, one row per line: line, carrier, renewal
  effective date, kick-off date, status, annual premium (current plan year)
  and renewal increase. Sort by effective date, then line.
- Plans are calendar-year in this data: a line in plan year 2026 renews on
  1 January 2027. Say this once, as the data states it.
- Any existing RFP record for the client: title, plan year, status and last
  completed stage.

## Decide

- The plan year the RFP buys is the effective year of the renewal being
  marketed: lines renewing on 2027-01-01 give plan year 2027.
- When every line renews on the same date, propose that plan year and ask
  the consultant to confirm it.
- When lines renew on different dates, or the consultant names a year the
  renewals don't support, `ask_clarification` with the renewal dates found
  as the options.
- When a draft exists for the same client and plan year, offer to resume it
  instead of creating another: open it with `get_rfp` and continue from the
  stage after its last completed stage.

## Save

Only after the consultant confirms the client and the plan year:

1. `create_rfp(clientOneCode, planYear)`. Leave `title` out unless the
   consultant asked for one: the default is
   `<client name> — <plan year> benefits RFP`, and the effective date
   defaults to 1 January of the plan year.
2. `update_rfp(rfpId, stage=1)` to mark the stage completed.

Then say the record is saved under its title, and introduce stage 2: a
review of the current program.

## Avoid

- Do not show the client id or the RFP id; use names and the client code.
- Do not guess a plan year from today's date; take it from the renewals.
- Do not create a second draft for the same client and plan year without the
  consultant asking for one.
