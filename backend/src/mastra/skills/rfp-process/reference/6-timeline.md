# Stage 6 — Timeline

Goal: agree the milestones from issuing the RFP to the effective date.

## Read

- The effective date E from the RFP record (`get_rfp`): by default
  1 January of the plan year.
- The kick-off date K: the earliest `kickOffDate` among the renewals of the
  lines in scope (`get_client_renewals`), which is E minus the policy's
  kick-off days. When no line has one, K = E − 120 days.
- Today's date, from the session context.

## Default milestones

Compute each date from K and E, as `YYYY-MM-DD`:

| Milestone | Date | Owner |
|---|---|---|
| RFP issued to carriers | K | Mercer consultant |
| Carrier intent to bid | K+5 | Carriers |
| Carrier questions due | K+10 | Carriers |
| Answers published | K+14 | Mercer consultant |
| Proposals due | K+30 | Carriers |
| Clarifications | K+37 | Mercer consultant |
| Analysis and shortlist | K+45 | Mercer consultant |
| Finalist presentations | K+55 | Carriers |
| Best-and-final offers | K+62 | Carriers |
| Decision | K+70 | Client HR |
| Carrier notification | K+72 | Mercer consultant |
| Implementation kick-off | K+80 | Carriers |
| Open enrollment materials | E−45 | Carriers |
| Open enrollment | E−30 to E−16 | Client HR |
| Effective date | E | Client HR |

Open enrollment is one milestone dated at its start (E−30), with the end
date (E−16) in its notes.

## Adjust

- No milestone before today unless the consultant says so. When K is in
  the past, move K to the next business day after today and keep the
  intervals, then check that implementation kick-off still lands before
  open enrollment materials; if it doesn't, compress the analysis steps and
  say which ones moved.
- When a date falls on a weekend, move it to the next Monday.
- Keep the order: every milestone on or after the one above it, the
  effective date last.

Show the table with the computed dates, and say how K was found. Ask the
consultant to confirm or move dates.

## Save

Only after the consultant confirms:

1. `set_rfp_timeline(rfpId, milestones)` with one row per milestone:

   `<milestone> | <YYYY-MM-DD> | <owner> | <notes>`

   Example:

   ```
   RFP issued to carriers | 2026-09-03 | Mercer consultant | -
   Open enrollment | 2026-12-02 | Client HR | Ends 2026-12-16
   Effective date | 2027-01-01 | Client HR | -
   ```

   Send every milestone each time: the list replaces the saved one. A date
   the API cannot read is refused; fix it and retry.
2. `update_rfp(rfpId, stage=6)`.

Then introduce stage 7: assembling and reviewing the RFP.
