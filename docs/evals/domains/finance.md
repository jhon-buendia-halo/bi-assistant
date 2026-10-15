# Finance: domain brief

A synthetic eval domain (BA-185, roadmap 1.1.7): Meridian Trust Bank, a fictional US retail bank that also manages investment portfolios for wealth clients. Every customer, account, transaction, loan, portfolio, security and fee is invented. Written by Claude with no business review (decided 2026-10-13); the business rules are in [finance-policy.md](finance-policy.md). How domains are built: [README.md](README.md).

## Persona

Priya is a reporting analyst in the bank's finance team. She answers questions from the heads of retail banking and wealth management: deposits and card spend by branch, loan quality, assets under management, fee revenue by fiscal quarter, and which clients matter most. She speaks in business words (wealth clients, AUM, fee revenue, completed transactions, fiscal 2025), never in table names, and she expects test data to be left out without being asked.

## Questions she asks

1. How many wealth clients do we have, and how much do they have with us?
2. What were our assets under management at the end of the fiscal year, by segment, region and asset class?
3. What was our wealth fee revenue last quarter, by type of fee and by region?
4. How much in fees did we collect, waive and refund?
5. Which clients brought in the most fee revenue, and which securities do most portfolios hold?
6. How did deposits and card spend move, and what was the net customer flow at each branch?
7. How many loans are non-performing, and how much of what borrowers pay is interest?
8. Which branches opened the most accounts?
9. How far above cost are client holdings?
10. Who is our biggest client? (She means a measure; the assistant should ask which.)

## Glossary

| Term | Synonyms she uses | Meaning in the data |
|---|---|---|
| Wealth client | investment client, managed client | A customer with at least one open portfolio that is not a test portfolio. Not a segment: PREMIER is a banking segment. |
| Assets under management (AUM) | client assets, money we manage, book | Market value of the holdings of non-test portfolios on one quarter-end snapshot. |
| Fee revenue | wealth revenue, fees earned | Settled and accrued fees, counted in the fiscal period they cover. |
| Fees collected | fee cash, fees paid | Settled fees, counted on the day they were charged. |
| Refunded fee | fee paid back | Status `REVERSED`. |
| Earned, not yet billed | accrued, unbilled | Status `ACCRUED`, no charge date yet. |
| Completed transaction | settled, posted | Status `POSTED`. |
| Non-performing loan | bad loan, troubled loan | Status `DELINQUENT` or `DEFAULTED`. |
| Net customer flow | net flow | Completed money in minus money out, excluding internal transfers. |
| Deposit account | savings and checking | Account type category `DEPOSIT` (checking, savings, money market). |
| Fiscal year | FY | 1 July to 30 June, named by the year it ends in: fiscal 2025 is July 2024 to June 2025. |
| Equities | stocks, shares | Asset class `EQUITY`; funds are `FUND` even when they hold shares. |
| Unrealized gain | paper gain, gain on cost | Market value minus cost, on positions whose cost is known. |

## Default filters

- Leave out test accounts (`accounts.is_test`) with their cards and transactions, and test portfolios (`portfolios.is_test`) with their holdings and fees. Say so in one sentence when it changes the answer.
- Amount totals of transactions use completed (`POSTED`) transactions only.
- "Now", "currently" and "latest" mean the data's as-of date, 31 December 2025.

## Metrics

| Metric | Definition |
|---|---|
| AUM at a date | `SUM(holdings.market_value_cents) / 100` on that `as_of`, non-test portfolios |
| Fee revenue for a period | `SUM(fees.amount_cents) / 100`, status `SETTLED` or `ACCRUED`, joined to `fiscal_periods` on the period covered |
| Fees collected in a period | `SUM(fees.amount_cents) / 100`, status `SETTLED`, `charged_on` in the period |
| Effective advisory rate | advisory fee revenue of a fiscal year over AUM at its end |
| Unrealized gain | `SUM(market_value_cents - cost_basis_cents) / 100` where the cost is known |
| Net customer flow | completed credits minus debits in US cents, internal transfers excluded |

## The data

As of 2025-12-31. Schema `finance`, 15 tables and 2 views, written by `docker/postgres/generate/finance.ts` (seeds 20260929 and 20261013) into `backend/src/modules/testing-data/fixtures/007_finance.sql` (about 1.1 MB), with the planted truths in `backend/scripts/fixtures/finance/facts.json`.

- **Retail banking** (the branch's banking domain, row for row): `regions`, `branches`, `customers` (90), `account_types`, `accounts` (200, 6 test), `cards`, `fx_rates` (EUR and GBP by month), `transactions` (5,400 in 2024 and 2025), `loans` (110), `loan_payments`; views `v_accounts`, `v_transactions`.
- **Wealth management** (new): `fiscal_periods` (36 fiscal months, July 2023 to June 2026), `securities` (28: shares, bonds, funds, a cash sweep), `portfolios` (46, 3 test), `holdings` (quarter-end snapshots from 2024-03-31 to 2025-12-31), `fees` (advisory, custody, performance and trading fees covering January 2024 to December 2025).

## Planted traps

The banking traps B1 to B15 come with the branch's generator unchanged (described in `docs/evals/synthetic-domains.md` on `feat/engine-eval-loop`): ratio pairs on loans, a USD-only loan currency, a sparse merchant category, a 12-and-12 branch tie, non-performing statuses, no history before 2024, three different "most valuable" customers, test traffic in March 2025, account branch versus home branch, minor units and FX, unsettled December card spend. The wealth traps, each asserted by the generator unless marked:

| # | Planted in the data | Category | Question that exposes it |
|---|---|---|---|
| W1 | No fee charged in August 2025 (billing cut-over); July's advisory fees went out on 5 September | null | `quietest-fee-month-2025` |
| W2 | Two bonds tie at the top, held by 17 real portfolios each on 2025-06-30; a test portfolio holds one of them | ranking | `most-held-securities-fy2025-end` |
| W3 | Three test portfolios, each larger than any real one, owned by customers with no real portfolio | default-filter | `largest-portfolio-2025-end`, `portfolios-opened-2024`, `discretionary-portfolios-open` |
| W4 | "Wealth client" is in no column | business-term | `wealth-client-count` |
| W5 | AUM is a snapshot on a fiscal year end; a portfolio's branch is not its owner's home branch | business-term, join | `aum-fy2025-end`, `open-portfolios-by-region` |
| W6 | `portfolios.base_currency` is USD on every row (not asserted: written as a constant) | aggregate | `portfolios-by-base-currency` |
| W7 | About a fifth of positions have no cost basis (transferred in) | null, ratio | `unrealized-gain-fy2025-end` |
| W8 | Status codes differ from the business words: `SETTLED` collected, `REVERSED` refunded, `ACCRUED` not yet billed | encoding | `refunded-fees-2025`, `unbilled-fees-2025-end` |
| W9 | Fees are revenue in the period they cover, not the month charged; performance fees exist in both fiscal years | business-term | `fee-revenue-fy2025-by-type`, `fee-revenue-fy2026-q2` |
| W10 | Fees reach a region in four hops | join | `fee-revenue-by-region-fy2025` |
| W11 | Money in cents, fee rates in basis points, the cash sweep priced at one dollar (not asserted) | encoding, ranking | `advisory-fee-rates`, `largest-security-by-value-2025-end` |
| W12 | The client with the most assets pays no advisory fee, so "biggest" names two different clients | ambiguous | `biggest-wealth-client` |

## Question bank

`backend/src/mastra/evals/sets/finance.json`: 68 questions, 48 new and the branch's 20 banking questions (two of them now state their precision), 20 held out. Each new question carries its trap, a trap query and paraphrases in its notes, and every reference was run on 2026-10-13 and checked against `facts.json` where a fact applies: [evidence/1.1.7/references-finance.txt](../../../evidence/1.1.7/references-finance.txt).

| Category | Questions | Held out |
|---|---|---|
| business-term | 8 | 2 |
| encoding | 8 | 2 |
| default-filter, ranking, ratio | 7 each | 2 each |
| join, aggregate | 6 each | 2 each |
| null | 4 | 1 |
| ambiguous, paraphrase | 3 each | 1 each (a paraphrase takes its base question's split) |
| out-of-scope, non-existent, discovery | 2 each | 1, 1 and 1 |
| lookup, fuzzy-scope, visual | 1 each | 0 |

Business-term and default-filter questions assume the assistant knows this glossary and these filters; until the domain's knowledge is seeded, they measure what the assistant infers from the schema and its comments.
