# Meridian Trust Bank: reporting policy

The business rules every figure from the finance data follows. Synthetic, written for the finance eval domain ([finance.md](finance.md)); the bank, its clients and its rules are invented.

## 1. What the data covers

- The data is as of **31 December 2025**. "Now", "currently", "today" and "latest" mean that date.
- Transactions and loan payments cover calendar 2024 and 2025 only. Accounts and loans may be older (from 2019), but no transaction history exists before 1 January 2024.
- Portfolio holdings are quarter-end snapshots, from 31 March 2024 to 31 December 2025. There are no holdings before March 2024.
- Wealth fees cover the months January 2024 to December 2025.
- A question about a period outside these ranges is answered by saying what the data covers, never with an estimate.

## 2. The fiscal year

- The fiscal year runs from **1 July to 30 June** and is named by the calendar year in which it ends: fiscal 2025 runs from 1 July 2024 to 30 June 2025.
- Fiscal quarters: Q1 July to September, Q2 October to December, Q3 January to March, Q4 April to June. Fiscal 2026 Q2 is October to December 2025.
- The fiscal calendar is the `fiscal_periods` table, one row per fiscal month. Use it rather than computing quarters from calendar dates.
- "Last quarter" or "the latest quarter" means the latest complete quarter in the data: October to December 2025. Answer for it and say so; do not ask.

## 3. What is always excluded

- **Test accounts** (`is_test` on accounts) and everything booked on them: their transactions and cards.
- **Test portfolios** (`is_test` on portfolios) and everything recorded on them: their holdings and fees. They are the largest portfolios in the data, so leaving them in changes most wealth figures.
- When an exclusion changes the answer, say so in one business sentence ("Excluding the bank's internal test portfolios, …").

## 4. Transactions

- A transaction is **completed** when its status is `POSTED`. `PENDING` transactions are still settling and `REVERSED` ones were cancelled; both are recorded but not completed.
- Money totals (deposits, card spend, net flow) count completed transactions only. A count of the transactions "recorded" or "processed" includes every status unless the question asks for completed ones.
- **Net customer flow** is completed money in minus money out, in US dollars, excluding internal transfers between the bank's own accounts. A transfer's two legs can sit at different branches, so they do not cancel out per branch.
- A transaction belongs to the branch of its **account**, not to the customer's home branch.

## 5. Money

- Banking amounts are in minor units of the account's currency (cents, euro cents, pence). `amount_usd_minor` holds the same amount in US cents at the booking month's rate; use it for any figure in dollars, and `amount_minor` for a figure in the account's own currency.
- Every wealth amount (market value, cost, fees) is in **US cents**. Divide by 100 for dollars.
- Fee rates are in **basis points**: 100 basis points is 1%.

## 6. Wealth clients and assets under management

- A **wealth client** is a customer with at least one open portfolio that is not a test portfolio. It is not a customer segment: PREMIER is a banking segment, and many wealth clients are not premier.
- **Assets under management (AUM)** at a date is the market value of the holdings of non-test portfolios on that quarter-end snapshot. AUM "at the end of fiscal 2025" is the 30 June 2025 snapshot.
- Snapshots are balances, not flows: never add snapshots of different dates together.
- A portfolio belongs to the branch that books and services it (`portfolios.branch_id`), which can differ from the client's home branch. Regions follow the branch.
- Asset classes: `EQUITY` is individual shares; funds are `FUND` even when they hold shares; `CASH` is the cash sweep, priced at one dollar a unit. Compare holdings by market value, never by number of units.

## 7. Fees

Four fee types, all charged to portfolios:

| Type | How it is charged |
|---|---|
| Advisory | Monthly in arrears on the 5th of the next month, at the portfolio's annual rate in basis points on its last snapshot value. Execution-only portfolios pay none. |
| Custody | Quarterly on the 10th after each quarter-end, 0.02% of the snapshot value, at least $25. |
| Performance | 10% of a discretionary portfolio's gain over the fiscal year, charged on 15 July after the year ends. |
| Trading | Per trade, on the trade day. |

Statuses, and the words people use for them:

| Status | Business word | Revenue? |
|---|---|---|
| `SETTLED` | collected, paid | yes |
| `ACCRUED` | earned but not yet billed; no charge date yet | yes |
| `WAIVED` | waived: charged, then forgiven | no |
| `REVERSED` | refunded: collected, then paid back | no |

- **Fee revenue** for a period counts `SETTLED` and `ACCRUED` fees by the **fiscal period the fee covers** (`fees.fiscal_period_id`), not by the day it was charged. June's advisory fee, charged on 5 July, is June's revenue.
- **Fees collected** in a period are `SETTLED` fees whose charge date falls in it: a cash view.
- Fees **charged** or **billed** in a month are counted on their charge date, whatever happened to them afterwards.
- **August 2025**: the billing platform was replaced and no fee was charged that month. July's advisory fees were charged on 5 September with August's, and trading was suspended for the month. A month-by-month view shows August at zero.

## 8. Gains on holdings

- **Unrealized gain** is market value minus cost, on positions whose cost is known. Positions transferred in from another firm arrive without a cost (`cost_basis_cents` is empty); leave them out of the gain and say how many there are.

## 9. Loans

- Loans are in US dollars only.
- A loan is **non-performing** when its status is `DELINQUENT` or `DEFAULTED`. `PAID_OFF` and `CHARGED_OFF` loans are closed and owe nothing.
