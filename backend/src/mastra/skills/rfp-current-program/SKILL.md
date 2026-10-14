---
name: rfp-current-program
description: Use when reviewing a client's current program for an RFP, at stage 2 (current program): plans, premiums, census and commercials per line, and the client background.
---
# Stage 2 — Current program

Goal: lay out what the client has in place today, line by line, so the
consultant can confirm the picture carriers will be quoting against. This
stage decides nothing new; it checks the facts and writes the client
background.

Tools for this stage: [[tool:get_client_program]],
[[tool:get_client_financials]], [[tool:get_client_census]],
[[tool:get_client_commercials]], [[tool:get_plan_design]],
[[tool:update_rfp]].

## Read

1. `get_client_program(clientOneCode)`: per line, the plans with
   `planType`, `carrier`, `fundingType`, `state`, `policyNumber`,
   `eligibility.workflowStatus`, `censusMapping` (`mapped`, `unmapped`) and
   `financials` (`planYear`, `enrolledEmployees`, `coveredLives`,
   `annualPremium`, `priorYearAnnualPremium`, `renewalIncreasePct`,
   `employerPct`).
2. `get_client_financials(clientOneCode)`: the rates by tier
   (`rateEmployeeOnly` … `rateFamily`), enrolment by tier, `adminFeePepm`,
   `stopLossPepm`, `ratePer1000` and the `totals`.
3. `get_client_census(clientOneCode)` with no year (the latest): headcount,
   eligible and enrolled employees, participation rate, average age, gender
   split, full-time and part-time, states, tier mix, and the census plans
   with what each is mapped to.
4. `get_client_commercials(clientOneCode)`: contribution periods, carrier
   credits (`expirationDate`, `isFinal`), fees and point solutions.

Use `get_plan_design` only when the consultant asks about one plan in depth.

## Show

- One table per line: plan type, carrier, funding, enrolled employees,
  annual premium, renewal increase. Name the plan year above each table.
- The line totals: annual premium this year, prior year and the increase.
- Census headline: total employees, eligible, enrolled, participation rate,
  average age, number of states, the tier mix.
- The employer contribution share per line where `employerPct` is given.
- Carrier credits that expire before the RFP's effective date, flagged.
- Census plans not mapped to a plan design (`censusMapping.unmapped`, and
  census plans whose `mappedTo` is null): list them as a data-quality note,
  because carriers will price from the census.

Money is annual and in USD. Leave out a column the data doesn't fill for a
line (ancillary lines often have no tier rates).

## Decide

Ask only: "Is anything missing or wrong in this picture?" If the consultant
corrects something the data shows, note it in the client background as the
consultant's correction; do not change the numbers.

## Save

1. Write the client background: two or three short paragraphs in the
   consultant's voice covering the client, its workforce (from the census),
   the lines and carriers in place, the premium and the renewal increase.
   Use only figures shown above.
2. `update_rfp(rfpId, sectionName='clientBackground', sectionText=…)`.
3. `update_rfp(rfpId, stage=2)`.

Then introduce stage 3: which lines to take to market.

## Avoid

- No benchmark, market-average or "typical" figure: the data has none.
- No plan design ids in the answer; use plan type and carrier.
