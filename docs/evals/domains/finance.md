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

## Investigation brief: no wealth fees billed in August 2025 (approved, awaiting the held-out wording)

Status: drafted by Claude on 2026-10-23; approved by the user on 2026-10-26 as drafted (*What approval decides*, below). No question enters a set until the user writes the held-out wording.

A why question for the investigation questions of roadmap 1.1.21 ([BA-243](https://halo-powered.atlassian.net/browse/BA-243)). The story is trap W1, already in the data: the generator bills July 2025's advisory fees on 2025-09-05 instead of 2025-08-05 and writes no trading fee for August 2025 (`EMPTY_MONTH` in `docker/postgres/generate/finance.ts`). [finance-policy.md](finance-policy.md) section 7 gives the reason: the billing platform was replaced that month. The finance knowledge seed says only that `charged_on` can fall after the fee's period, not that August was skipped, so the assistant has to find the shift in the data. The existing case `quietest-fee-month-2025` asks which month was lowest; none asks why. No fixture, generator or facts.json change is needed.

Why this story: of the finance traps, W1 is the one planted as an event with a cause, the one a head of wealth would ask about, and it has a plausible wrong reading (lost business) that the data rules out. The other candidate was B15, December 2025 card spend that looks low because some purchases are still pending: a thinner story, about data freshness.

### Who asks

Meridian Trust Bank's head of wealth management asks Priya, the analyst of the persona above, after the monthly fee report showed August 2025 at zero, a week before the quarterly business review.

### How they ask

They name the month and say the fees, or the fee income, came to nothing, and ask why or what went wrong. They use business words (fees, fee income, billing), name no cause, and often assume that something was lost.

### The true cause

A billing timing shift. No fee has a charge date in August 2025. July's advisory fees, normally billed on 5 August, were billed on 5 September together with August's, and the trading desk made no trades in August, so no commission was billed. The advisory fees were delayed, not lost: fee revenue by the period the fees cover was normal for July and August. The policy gives the reason, a new billing platform; the data shows only the timing, and the checks ask only for the timing.

### What a good analyst finds

1. **The gap**, billed fees per month in 2025 (every status, test portfolios out): August, 0 fees. September, 81 fees and $99,467.44, against $66,688.24 in October and $50,035.84 in November. (FF1)
2. **What September's bill covers.** On 2025-09-05, 28 advisory fees for July ($47,988.90) and 29 for August ($50,824.74). June's advisory fees, billed on 2025-07-05, were $47,719.55, so September holds two months of a normal size: 57 advisory fees on 29 portfolios, against 26 to 31 a month in the rest of 2025. (FF2, FF3)
3. **Revenue did not fall.** Fee revenue by the month covered (settled and accrued): July $45,529.75 and August $42,451.44, against $39,645.48 to $44,898.35 in January, February, April and May (the months without quarter-end custody) and $46,987.80 and $49,286.15 in October and November. (FF4)
4. **The one real loss: trading.** No trading fee in August 2025, against 15 to 33 a month ($404.25 to $858.70) in the rest of 2025. (FF5)
5. **Clients and assets stayed.** Assets under management (test portfolios out): $85,727,112.35 on 2025-06-30 and $86,279,750.70 on 2025-09-30 (+0.64%), on 36 and 37 portfolios. In August one portfolio opened and one closed. (FF6, FF7)
6. **Nothing was waived in August: nothing was charged.** September's refunds ($8,388.25 on 4 fees) are the largest of June to October, on twice the usual number of advisory charges. (FF8)

### The planted wrong explanation

Lost business: wealth clients left or assets fell, so fee income collapsed (or the fees were waived). It is plausible because the billing report shows a zero and one real portfolio did close in August. It is ruled out by assets rising (+0.64% over the quarter, 36 to 37 portfolios), by July's and August's advisory fees billed in September at the usual size, and by August's revenue ($42,451.44) in line with the rest of the year.

The revenue trap (W9) makes the wrong reading easy: counted by charge date, settled and accrued fees come to $115,956.54 in July and nothing in August, so revenue seems to vanish.

### Facts and validator queries

Run on 2026-10-23 on `loop_finance`, the loop's copy of the sample (port 55433), in read-only transactions. FF1 agrees with facts.json `wealth.W1_emptyMonth` and FF6 with `wealth.W5_aumByQuarterEndDollars`; the other facts are not in facts.json. The percentages above were computed in SQL from these rows.

**FF1. Fees billed per month in 2025, every status, test portfolios out.**

```sql
SELECT to_char(m.month, 'YYYY-MM') AS month, COUNT(f.id) AS fees,
       COALESCE(SUM(f.amount_cents), 0) / 100.0 AS billed_dollars
FROM generate_series(DATE '2025-01-01', DATE '2025-12-01', INTERVAL '1 month') AS m(month)
LEFT JOIN (finance.fees f JOIN finance.portfolios p ON p.id = f.portfolio_id AND NOT p.is_test)
       ON date_trunc('month', f.charged_on) = m.month
GROUP BY m.month ORDER BY m.month;
```

Returned:

```text
month | fees | billed_dollars
2025-01 | 88 | 61123.550000000000
2025-02 | 50 | 44768.450000000000
2025-03 | 50 | 44673.450000000000
2025-04 | 74 | 60162.850000000000
2025-05 | 59 | 45225.530000000000
2025-06 | 54 | 48578.250000000000
2025-07 | 98 | 122676.220000000000
2025-08 | 0 | 0.00000000000000000000
2025-09 | 81 | 99467.440000000000
2025-10 | 93 | 66688.240000000000
2025-11 | 59 | 50035.840000000000
2025-12 | 61 | 53131.020000000000
(12 rows)
```

**FF2. What was billed in July to September 2025, by the month covered** (trading left out; see FF5).

```sql
SELECT f.charged_on, fp.period_code, to_char(fp.period_start, 'YYYY-MM') AS covers,
       f.fee_type, COUNT(*) AS fees, SUM(f.amount_cents) / 100.0 AS billed_dollars
FROM finance.fees f
JOIN finance.portfolios p ON p.id = f.portfolio_id
JOIN finance.fiscal_periods fp ON fp.id = f.fiscal_period_id
WHERE NOT p.is_test AND f.fee_type <> 'TRADING'
  AND f.charged_on BETWEEN DATE '2025-07-01' AND DATE '2025-09-30'
GROUP BY f.charged_on, fp.period_code, fp.period_start, f.fee_type
ORDER BY f.charged_on, fp.period_code, f.fee_type;
```

Returned:

```text
charged_on | period_code | covers | fee_type | fees | billed_dollars
2025-07-05 | FY2025-P12 | 2025-06 | ADVISORY | 28 | 47719.550000000000
2025-07-10 | FY2025-P12 | 2025-06 | CUSTODY | 36 | 17145.410000000000
2025-07-15 | FY2025-P12 | 2025-06 | PERFORMANCE | 10 | 57357.460000000000
2025-09-05 | FY2026-P01 | 2025-07 | ADVISORY | 28 | 47988.900000000000
2025-09-05 | FY2026-P02 | 2025-08 | ADVISORY | 29 | 50824.740000000000
(5 rows)
```

**FF3. Advisory fees billed per month in 2025, and the portfolios billed.**

```sql
SELECT to_char(f.charged_on, 'YYYY-MM') AS billed_in, COUNT(*) AS advisory_fees,
       COUNT(DISTINCT f.portfolio_id) AS portfolios, SUM(f.amount_cents) / 100.0 AS billed_dollars
FROM finance.fees f JOIN finance.portfolios p ON p.id = f.portfolio_id
WHERE NOT p.is_test AND f.fee_type = 'ADVISORY' AND f.charged_on >= DATE '2025-01-01'
GROUP BY 1 ORDER BY 1;
```

Returned:

```text
billed_in | advisory_fees | portfolios | billed_dollars
2025-01 | 26 | 26 | 43936.310000000000
2025-02 | 26 | 26 | 44169.650000000000
2025-03 | 26 | 26 | 44169.650000000000
2025-04 | 26 | 26 | 44169.650000000000
2025-05 | 26 | 26 | 44507.180000000000
2025-06 | 28 | 28 | 47719.550000000000
2025-07 | 28 | 28 | 47719.550000000000
2025-09 | 57 | 29 | 98813.640000000000
2025-10 | 29 | 29 | 48673.650000000000
2025-11 | 29 | 29 | 49292.340000000000
2025-12 | 31 | 31 | 52302.520000000000
(11 rows)
```

**FF4. Fee revenue by the month covered in 2025, settled and accrued, by type.**

```sql
SELECT to_char(fp.period_start, 'YYYY-MM') AS covers,
       SUM(f.amount_cents) FILTER (WHERE f.fee_type = 'ADVISORY') / 100.0 AS advisory,
       SUM(f.amount_cents) FILTER (WHERE f.fee_type = 'CUSTODY') / 100.0 AS custody,
       SUM(f.amount_cents) FILTER (WHERE f.fee_type = 'PERFORMANCE') / 100.0 AS performance,
       SUM(f.amount_cents) FILTER (WHERE f.fee_type = 'TRADING') / 100.0 AS trading,
       SUM(f.amount_cents) / 100.0 AS revenue
FROM finance.fees f
JOIN finance.portfolios p ON p.id = f.portfolio_id
JOIN finance.fiscal_periods fp ON fp.id = f.fiscal_period_id
WHERE NOT p.is_test AND f.status IN ('SETTLED', 'ACCRUED')
  AND fp.period_start BETWEEN DATE '2025-01-01' AND DATE '2025-12-01'
GROUP BY fp.period_start ORDER BY fp.period_start;
```

Returned:

```text
covers | advisory | custody | performance | trading | revenue
2025-01 | 44169.650000000000 |  |  | 728.7000000000000000 | 44898.350000000000
2025-02 | 39066.630000000000 |  |  | 578.8500000000000000 | 39645.480000000000
2025-03 | 44169.650000000000 | 15136.530000000000 |  | 503.8000000000000000 | 59809.980000000000
2025-04 | 41155.160000000000 |  |  | 324.3500000000000000 | 41479.510000000000
2025-05 | 43790.640000000000 |  |  | 703.4000000000000000 | 44494.040000000000
2025-06 | 42515.990000000000 | 16992.540000000000 | 56014.160000000000 | 788.8000000000000000 | 116311.490000000000
2025-07 | 45095.900000000000 |  |  | 433.8500000000000000 | 45529.750000000000
2025-08 | 42451.440000000000 |  |  |  | 42451.440000000000
2025-09 | 43669.670000000000 | 16575.340000000000 |  | 638.8500000000000000 | 60883.860000000000
2025-10 | 46229.150000000000 |  |  | 758.6500000000000000 | 46987.800000000000
2025-11 | 48592.600000000000 |  |  | 693.5500000000000000 | 49286.150000000000
2025-12 | 52302.520000000000 | 18517.500000000000 |  | 828.5000000000000000 | 71648.520000000000
(12 rows)
```

**FF5. Trading fees billed per month in 2025.**

```sql
SELECT to_char(m.month, 'YYYY-MM') AS month, COUNT(f.id) AS trading_fees,
       COALESCE(SUM(f.amount_cents), 0) / 100.0 AS billed_dollars
FROM generate_series(DATE '2025-01-01', DATE '2025-12-01', INTERVAL '1 month') AS m(month)
LEFT JOIN (finance.fees f JOIN finance.portfolios p ON p.id = f.portfolio_id AND NOT p.is_test)
       ON date_trunc('month', f.charged_on) = m.month AND f.fee_type = 'TRADING'
GROUP BY m.month ORDER BY m.month;
```

Returned:

```text
month | trading_fees | billed_dollars
2025-01 | 28 | 753.6000000000000000
2025-02 | 24 | 598.8000000000000000
2025-03 | 24 | 503.8000000000000000
2025-04 | 15 | 404.2500000000000000
2025-05 | 33 | 718.3500000000000000
2025-06 | 26 | 858.7000000000000000
2025-07 | 24 | 453.8000000000000000
2025-08 | 0 | 0.00000000000000000000
2025-09 | 24 | 653.8000000000000000
2025-10 | 27 | 758.6500000000000000
2025-11 | 30 | 743.5000000000000000
2025-12 | 30 | 828.5000000000000000
(12 rows)
```

**FF6. Assets under management and portfolios at each 2025 quarter end, test portfolios out.**

```sql
SELECT h.as_of, SUM(h.market_value_cents) / 100.0 AS aum_dollars,
       COUNT(DISTINCT h.portfolio_id) AS portfolios
FROM finance.holdings h JOIN finance.portfolios p ON p.id = h.portfolio_id
WHERE NOT p.is_test AND h.as_of BETWEEN DATE '2025-03-31' AND DATE '2025-12-31'
GROUP BY h.as_of ORDER BY h.as_of;
```

Returned:

```text
as_of | aum_dollars | portfolios
2025-03-31 | 77944865.260000000000 | 33
2025-06-30 | 85727112.350000000000 | 36
2025-09-30 | 86279750.700000000000 | 37
2025-12-31 | 92587499.600000000000 | 39
(4 rows)
```

**FF7. Portfolios opened and closed in 2025, test portfolios out.**

```sql
SELECT 'opened' AS event, to_char(opened_on, 'YYYY-MM') AS month, COUNT(*) AS portfolios
FROM finance.portfolios WHERE NOT is_test AND opened_on >= DATE '2025-01-01' GROUP BY 2
UNION ALL
SELECT 'closed', to_char(closed_on, 'YYYY-MM'), COUNT(*)
FROM finance.portfolios WHERE NOT is_test AND closed_on >= DATE '2025-01-01' GROUP BY 2
ORDER BY 2, 1;
```

Returned:

```text
event | month | portfolios
closed | 2025-03 | 1
opened | 2025-05 | 3
closed | 2025-08 | 1
opened | 2025-08 | 1
opened | 2025-09 | 1
opened | 2025-11 | 2
(6 rows)
```

**FF8. Waived and refunded fees by billing month, June to October 2025.**

```sql
SELECT to_char(f.charged_on, 'YYYY-MM') AS billed_in, f.status, COUNT(*) AS fees,
       SUM(f.amount_cents) / 100.0 AS dollars
FROM finance.fees f JOIN finance.portfolios p ON p.id = f.portfolio_id
WHERE NOT p.is_test AND f.status IN ('WAIVED', 'REVERSED')
  AND f.charged_on BETWEEN DATE '2025-06-01' AND DATE '2025-10-31'
GROUP BY 1, 2 ORDER BY 1, 2;
```

Returned:

```text
billed_in | status | fees | dollars
2025-06 | REVERSED | 4 | 3432.4200000000000000
2025-06 | WAIVED | 1 | 566.3900000000000000
2025-07 | REVERSED | 3 | 3436.5500000000000000
2025-07 | WAIVED | 4 | 3283.1300000000000000
2025-09 | REVERSED | 4 | 8388.2500000000000000
2025-09 | WAIVED | 2 | 2893.0000000000000000
2025-10 | WAIVED | 2 | 5684.5800000000000000
(7 rows)
```

### Dev questions (draft cases)

Four dev variants written by Claude, category `reasoning`, split `dev`, tag `investigation`. Each is scored by:

- `matches` (G3): the true cause in the answer, July's fees billed in September, two months billed in September, or billing delayed. The lost-clients claim also needs an asset figure (86.3 or 85.7 million, +0.6%, or 36 or 37 portfolios), and the revenue question a revenue figure (42,451 or 45,530, written whole or in thousands).
- `notMatches` (G3): the wrong explanation asserted. That is lost clients or assets, outflows, waivers or refunds in a causal frame, "clients left", "we lost clients" or "the fees were waived", plus, per variant, an answer that opens by agreeing, September put down to performance fees, higher rates or new clients, or revenue said to have fallen to zero. A clause that negates it first does not match, as in the marketing brief.
- `sqlMatches` `fiscal_period` (D2): a successful query read the period the fees cover, the only way to see that July's fees were billed in September.
- `calledTool` `run_readonly_sql` (D1), `noToolErrors` (D3), and the result-set match on the reference.

`numbersGrounded` is left out, for the reason given in the marketing brief.

Validated on 2026-10-23 as the marketing drafts were: on `loop_finance`, over the committed dump, statically for Databricks (not run, VDI), with the repo's loader on a scratch copy of `finance.json`, and with the checks scored on simulated answers (each correct answer passed, each answer giving the wrong explanation failed `notMatches`).

| Id | Angle | The reference returns | It fails an answer that |
|---|---|---|---|
| `why-no-wealth-fees-billed-august-2025` | the plain why | September's advisory billing by the month covered | blames lost clients, outflows or waivers, or never finds the shift |
| `august-2025-fees-lost-clients-claim` | the user offers the wrong explanation | assets under management on 2025-06-30 and 2025-09-30 | agrees, blames lost business, or gives no asset figure or no shift |
| `september-2025-fee-billing-spike` | the other side of the gap | September's billing by fee type | blames performance fees, higher rates or new clients |
| `wealth-fee-revenue-august-2025` | revenue against billing (trap W9) | revenue for July and August by the month covered | says revenue fell to zero, or gives no revenue figure or no shift |

```json
{
  "id": "why-no-wealth-fees-billed-august-2025",
  "category": "reasoning",
  "split": "dev",
  "tags": [
    "investigation",
    "trap:empty-month",
    "trap:wrong-explanation",
    "difficulty:hard"
  ],
  "question": "Why did we bill no wealth fees at all in August 2025?",
  "intent": "An investigation: the fees were billed late, not lost. July's advisory fees went out on 5 September with August's, and trading fees stopped for the month.",
  "notes": "Investigation, planted story W1. No fee has a charge date in August 2025. On 2025-09-05 the bank billed 28 advisory fees covering July 2025 ($47,988.90) and 29 covering August 2025 ($50,824.74); June's advisory fees, billed on 2025-07-05, were $47,719.55. Fee revenue by the period covered was normal: $45,529.75 for July, $42,451.44 for August. The only fees actually missing are August's trading commissions (none; $404.25 to $858.70 a month in the rest of 2025). Assets rose from $85,727,112.35 (2025-06-30) to $86,279,750.70 (2025-09-30). Billed means every status, counted on the charge date (policy section 7). The reference projects the September advisory billing by the month it covers.\n\nThe notMatches check fails an answer that puts the gap down to lost clients or assets, outflows, waivers or refunds, or says clients left or the fees were waived.\n\nChecked against facts.json: wealth.W1_emptyMonth (2025-08, 0 fees; September 81 fees, $99,467.44) and wealth.W5_aumByQuarterEndDollars. The split of September's billing by covered month was read on loop_finance on 2026-10-23.\n\nTrap query (must return different rows): SELECT SUM(fee.amount_cents) / 100.0 AS billed_dollars FROM finance.fees fee JOIN finance.portfolios portfolio ON portfolio.id = fee.portfolio_id JOIN finance.fiscal_periods period ON period.id = fee.fiscal_period_id WHERE fee.fee_type = 'ADVISORY' AND fee.status = 'SETTLED' AND fee.charged_on >= DATE '2025-09-01' AND fee.charged_on < DATE '2025-10-01' AND portfolio.is_test = false GROUP BY period.period_start ORDER BY period.period_start\n\nParaphrases: none written. The held-out wording of this brief is written by the user, not derived from this case.\n\nBrief: docs/evals/domains/finance.md, Investigation brief: no wealth fees billed in August 2025 (facts FF1 to FF8).",
  "checks": [
    {
      "type": "matches",
      "args": {
        "pattern": "(?:July|Jul\\b|2025-07|FY2026-P01)[^.\\n]{0,80}?\\b(?:bill|charg|invoic|collect|went out|sent|post|deferr|delay|held|push|mov|roll|land)\\w*[^.\\n]{0,60}?(?:September|Sept?\\b|2025-09)|(?:September|Sept?\\b|2025-09)[^.\\n]{0,80}?\\b(?:includ|contain|cover|carr|held|hold|bundl|combin|catch|caught|both|plus|along with|together|double|twice)\\w*[^.\\n]{0,60}?(?:July|Jul\\b|2025-07|FY2026-P01)|\\b(?:two|both|double|twice the|2)\\s+months?\\b[^.\\n]{0,80}?(?:September|Sept?\\b|2025-09)|(?:September|Sept?\\b|2025-09)[^.\\n]{0,80}?\\b(?:two|both|2)\\s+months?\\b|\\b(?:billing|fees?|charges?|invoic\\w*|advisory)\\b[^.\\n]{0,40}?\\b(?:delay\\w*|postpon\\w*|deferr\\w*|held over|held back|pushed|moved|rolled|shifted|slipp\\w*|catch-up|caught up)|\\b(?:delay\\w*|postpon\\w*|deferr\\w*|late|catch-up)\\s+(?:\\w+\\s+){0,2}?(?:billing|fees?|charges?|invoic\\w*)",
        "flags": "i"
      },
      "criterion": "G3"
    },
    {
      "type": "notMatches",
      "args": {
        "pattern": "(?<!(?:\\b(?:not|never|nor|neither|rather than|instead of|unlikely|doubt|whether|if|was (?:it|that)|is (?:it|that))\\b|n['’]t\\b)[^.;:!?\\n]{0,50})(?<!\\bno\\b[^.;:!?\\n]{0,20})\\b(?:due to|because of|caused by|driven by|explained by|attributable to|(?:the|a) result of|reflects?|reflected|reflecting|down to|thanks to|stems? from|came from|comes from)\\s+(?:an?\\s+|the\\s+)?(?:\\w+[\\s-]+){0,2}?(?:(?:client|customer)s?\\s+(?:loss\\w*|attrition|departures?|leaving|exits?|churn|closures?|withdrawals?|outflows?)|(?:lost|losing|fewer|departing)\\s+(?:clients|customers|portfolios|assets)|(?:asset|AUM|fund|money)\\s+(?:outflows?|withdrawals?|losses|decline|fall|drop)|outflows?|withdrawals|redemptions|(?:lower|falling|reduced|declining|shrinking)\\s+(?:assets|AUM|balances|portfolio values)|(?:market|asset)[\\s-](?:fall|drop|decline|downturn|sell-?off)|fee\\s+waivers?|waived\\s+fees|refunds?|reversals?)|(?<!(?:\\b(?:not|never|nor|neither|rather than|instead of|unlikely|doubt|whether|if|was (?:it|that)|is (?:it|that))\\b|n['’]t\\b)[^.;:!?\\n]{0,50})(?<!\\bno\\b[^.;:!?\\n]{0,20})\\b(?:we|the bank)\\s+lost\\s+(?!no\\b|none\\b|nothing\\b|any\\b)(?:\\w+\\s+){0,2}?(?:clients|customers|assets|business|AUM|portfolios)|(?<!(?:\\b(?:not|never|nor|neither|rather than|instead of|unlikely|doubt|whether|if|was (?:it|that)|is (?:it|that))\\b|n['’]t\\b)[^.;:!?\\n]{0,50})(?<!\\bno\\b[^.;:!?\\n]{0,20})\\b(?:clients|customers)\\s+(?:left|withdrew|pulled|moved (?:their )?(?:money|assets))|(?<!(?:\\b(?:not|never|nor|neither|rather than|instead of|unlikely|doubt|whether|if|was (?:it|that)|is (?:it|that))\\b|n['’]t\\b)[^.;:!?\\n]{0,50})(?<!\\bno\\b[^.;:!?\\n]{0,20})\\b(?:the\\s+)?(?:august\\s+)?fees\\s+(?:were|had been)\\s+(?:all\\s+)?(?:waived|refunded|reversed|cancelled|canceled|written off)",
        "flags": "i"
      },
      "criterion": "G3"
    },
    {
      "type": "sqlMatches",
      "args": {
        "pattern": "fiscal_period",
        "flags": "i"
      },
      "criterion": "D2"
    },
    {
      "type": "calledTool",
      "args": {
        "tool": "run_readonly_sql"
      },
      "criterion": "D1"
    },
    {
      "type": "noToolErrors",
      "criterion": "D3"
    }
  ],
  "expectedSql": {
    "postgres": "SELECT SUM(fee.amount_cents) / 100.0 AS billed_dollars FROM finance.fees fee JOIN finance.portfolios portfolio ON portfolio.id = fee.portfolio_id JOIN finance.fiscal_periods period ON period.id = fee.fiscal_period_id WHERE fee.fee_type = 'ADVISORY' AND fee.charged_on >= DATE '2025-09-01' AND fee.charged_on < DATE '2025-10-01' AND portfolio.is_test = false GROUP BY period.period_start ORDER BY period.period_start",
    "sqlite": "SELECT SUM(fee.amount_cents) / 100.0 AS billed_dollars FROM api.finance.fees fee JOIN api.finance.portfolios portfolio ON portfolio.id = fee.portfolio_id JOIN api.finance.fiscal_periods period ON period.id = fee.fiscal_period_id WHERE fee.fee_type = 'ADVISORY' AND fee.charged_on >= '2025-09-01' AND fee.charged_on < '2025-10-01' AND portfolio.is_test = false GROUP BY period.period_start ORDER BY period.period_start",
    "databricks": "SELECT SUM(fee.amount_cents) / 100.0 AS billed_dollars FROM `evals`.finance.fees fee JOIN `evals`.finance.portfolios portfolio ON portfolio.id = fee.portfolio_id JOIN `evals`.finance.fiscal_periods period ON period.id = fee.fiscal_period_id WHERE fee.fee_type = 'ADVISORY' AND fee.charged_on >= DATE '2025-09-01' AND fee.charged_on < DATE '2025-10-01' AND portfolio.is_test = false GROUP BY period.period_start ORDER BY period.period_start"
  }
}
```

```json
{
  "id": "august-2025-fees-lost-clients-claim",
  "category": "reasoning",
  "split": "dev",
  "tags": [
    "investigation",
    "trap:test-rows",
    "trap:wrong-explanation",
    "difficulty:hard"
  ],
  "question": "Our wealth fee income was zero in August 2025. Did we lose clients or assets that month?",
  "intent": "The user offers the planted wrong explanation: assets rose over the quarter and the fees came in September. Find the timing shift.",
  "notes": "Investigation, planted story W1. Assets under management (test portfolios out) were $85,727,112.35 on 2025-06-30 and $86,279,750.70 on 2025-09-30 (+0.6%), on 36 and 37 portfolios; in August 2025 one real portfolio opened and one closed. July's and August's advisory fees were both billed on 2025-09-05. The reference is the two quarter-end AUM figures; with the test portfolios in they read $116,698,305.40 and $117,796,750.90.\n\nThe matches check needs both an asset figure (86.3 or 85.7 million, +0.6%, or 36/37 portfolios) and the timing shift. The notMatches check fails a client or asset loss asserted as the cause, or an answer that opens by agreeing.\n\nChecked against facts.json: wealth.W5_aumByQuarterEndDollars and wealth.W1_emptyMonth. Portfolio counts read on loop_finance on 2026-10-23.\n\nTrap query (must return different rows): SELECT SUM(holding.market_value_cents) / 100.0 AS aum_dollars FROM finance.holdings holding JOIN finance.portfolios portfolio ON portfolio.id = holding.portfolio_id WHERE holding.as_of IN (DATE '2025-06-30', DATE '2025-09-30') GROUP BY holding.as_of ORDER BY holding.as_of\n\nParaphrases: none written. The held-out wording of this brief is written by the user, not derived from this case.\n\nBrief: docs/evals/domains/finance.md, Investigation brief: no wealth fees billed in August 2025 (facts FF1 to FF8).",
  "checks": [
    {
      "type": "matches",
      "args": {
        "pattern": "^(?=[\\s\\S]*?(?:\\$?86[.,]\\d+\\s*(?:million|mn|m)\\b|\\b86[,.\\s]?279[,.\\s]?75\\d|\\b86[,.\\s]?28\\d[,.\\s]?\\d{3}|\\$?85[.,]\\d+\\s*(?:million|mn|m)\\b|\\b85[,.\\s]?727[,.\\s]?11\\d|\\b0[.,]6\\d*\\s*(?:%|percent)|\\b3[67]\\s+(?:real\\s+|open\\s+|client\\s+)?portfolios))(?=[\\s\\S]*?(?:(?:July|Jul\\b|2025-07|FY2026-P01)[^.\\n]{0,80}?\\b(?:bill|charg|invoic|collect|went out|sent|post|deferr|delay|held|push|mov|roll|land)\\w*[^.\\n]{0,60}?(?:September|Sept?\\b|2025-09)|(?:September|Sept?\\b|2025-09)[^.\\n]{0,80}?\\b(?:includ|contain|cover|carr|held|hold|bundl|combin|catch|caught|both|plus|along with|together|double|twice)\\w*[^.\\n]{0,60}?(?:July|Jul\\b|2025-07|FY2026-P01)|\\b(?:two|both|double|twice the|2)\\s+months?\\b[^.\\n]{0,80}?(?:September|Sept?\\b|2025-09)|(?:September|Sept?\\b|2025-09)[^.\\n]{0,80}?\\b(?:two|both|2)\\s+months?\\b|\\b(?:billing|fees?|charges?|invoic\\w*|advisory)\\b[^.\\n]{0,40}?\\b(?:delay\\w*|postpon\\w*|deferr\\w*|held over|held back|pushed|moved|rolled|shifted|slipp\\w*|catch-up|caught up)|\\b(?:delay\\w*|postpon\\w*|deferr\\w*|late|catch-up)\\s+(?:\\w+\\s+){0,2}?(?:billing|fees?|charges?|invoic\\w*)))",
        "flags": "i"
      },
      "criterion": "G3"
    },
    {
      "type": "notMatches",
      "args": {
        "pattern": "^\\W*(?:yes|yeah|agreed)\\b|(?<!(?:\\b(?:not|never|nor|neither|rather than|instead of|unlikely|doubt|whether|if|was (?:it|that)|is (?:it|that))\\b|n['’]t\\b)[^.;:!?\\n]{0,50})(?<!\\bno\\b[^.;:!?\\n]{0,20})\\b(?:due to|because of|caused by|driven by|explained by|attributable to|(?:the|a) result of|reflects?|reflected|reflecting|down to|thanks to|stems? from|came from|comes from)\\s+(?:an?\\s+|the\\s+)?(?:\\w+[\\s-]+){0,2}?(?:(?:client|customer)s?\\s+(?:loss\\w*|attrition|departures?|leaving|exits?|churn|closures?|withdrawals?|outflows?)|(?:lost|losing|fewer|departing)\\s+(?:clients|customers|portfolios|assets)|(?:asset|AUM|fund|money)\\s+(?:outflows?|withdrawals?|losses|decline|fall|drop)|outflows?|withdrawals|redemptions|(?:lower|falling|reduced|declining|shrinking)\\s+(?:assets|AUM|balances|portfolio values)|(?:market|asset)[\\s-](?:fall|drop|decline|downturn|sell-?off)|fee\\s+waivers?|waived\\s+fees|refunds?|reversals?)|(?<!(?:\\b(?:not|never|nor|neither|rather than|instead of|unlikely|doubt|whether|if|was (?:it|that)|is (?:it|that))\\b|n['’]t\\b)[^.;:!?\\n]{0,50})(?<!\\bno\\b[^.;:!?\\n]{0,20})\\b(?:we|the bank)\\s+lost\\s+(?!no\\b|none\\b|nothing\\b|any\\b)(?:\\w+\\s+){0,2}?(?:clients|customers|assets|business|AUM|portfolios)|(?<!(?:\\b(?:not|never|nor|neither|rather than|instead of|unlikely|doubt|whether|if|was (?:it|that)|is (?:it|that))\\b|n['’]t\\b)[^.;:!?\\n]{0,50})(?<!\\bno\\b[^.;:!?\\n]{0,20})\\b(?:clients|customers)\\s+(?:left|withdrew|pulled|moved (?:their )?(?:money|assets))|(?<!(?:\\b(?:not|never|nor|neither|rather than|instead of|unlikely|doubt|whether|if|was (?:it|that)|is (?:it|that))\\b|n['’]t\\b)[^.;:!?\\n]{0,50})(?<!\\bno\\b[^.;:!?\\n]{0,20})\\b(?:the\\s+)?(?:august\\s+)?fees\\s+(?:were|had been)\\s+(?:all\\s+)?(?:waived|refunded|reversed|cancelled|canceled|written off)",
        "flags": "i"
      },
      "criterion": "G3"
    },
    {
      "type": "sqlMatches",
      "args": {
        "pattern": "fiscal_period",
        "flags": "i"
      },
      "criterion": "D2"
    },
    {
      "type": "calledTool",
      "args": {
        "tool": "run_readonly_sql"
      },
      "criterion": "D1"
    },
    {
      "type": "noToolErrors",
      "criterion": "D3"
    }
  ],
  "expectedSql": {
    "postgres": "SELECT SUM(holding.market_value_cents) / 100.0 AS aum_dollars FROM finance.holdings holding JOIN finance.portfolios portfolio ON portfolio.id = holding.portfolio_id WHERE holding.as_of IN (DATE '2025-06-30', DATE '2025-09-30') AND portfolio.is_test = false GROUP BY holding.as_of ORDER BY holding.as_of",
    "sqlite": "SELECT SUM(holding.market_value_cents) / 100.0 AS aum_dollars FROM api.finance.holdings holding JOIN api.finance.portfolios portfolio ON portfolio.id = holding.portfolio_id WHERE holding.as_of IN ('2025-06-30', '2025-09-30') AND portfolio.is_test = false GROUP BY holding.as_of ORDER BY holding.as_of",
    "databricks": "SELECT SUM(holding.market_value_cents) / 100.0 AS aum_dollars FROM `evals`.finance.holdings holding JOIN `evals`.finance.portfolios portfolio ON portfolio.id = holding.portfolio_id WHERE holding.as_of IN (DATE '2025-06-30', DATE '2025-09-30') AND portfolio.is_test = false GROUP BY holding.as_of ORDER BY holding.as_of"
  }
}
```

```json
{
  "id": "september-2025-fee-billing-spike",
  "category": "reasoning",
  "split": "dev",
  "tags": [
    "investigation",
    "trap:empty-month",
    "trap:wrong-explanation",
    "difficulty:hard"
  ],
  "question": "We billed far more in wealth fees in September 2025 than in October or November. What happened?",
  "intent": "The other side of the gap: September holds two months of advisory fees, July's and August's, not performance fees or higher rates.",
  "notes": "Investigation, planted story W1. September 2025 billing (every status, test portfolios out): $98,813.64 of advisory fees (57 fees on 29 portfolios: 28 for July, 29 for August) and $653.80 of trading, $99,467.44 in all; October $66,688.24 (with the quarterly custody fees), November $50,035.84. No performance fee was billed in September (fiscal 2025's were billed on 2025-07-15). The reference projects September's billing by fee type.\n\nThe notMatches check fails an answer that puts September down to performance fees, a fee or rate rise, new clients or portfolios, one-off charges, a market rally or higher assets, or says performance fees were billed in September.\n\nChecked against facts.json: wealth.W1_emptyMonth (September 81 fees, $99,467.44; October $66,688.24; November $50,035.84). The split by type and covered month was read on loop_finance on 2026-10-23.\n\nTrap query (must return different rows): SELECT SUM(fee.amount_cents) / 100.0 AS billed_dollars FROM finance.fees fee JOIN finance.portfolios portfolio ON portfolio.id = fee.portfolio_id WHERE fee.charged_on >= DATE '2025-09-01' AND fee.charged_on < DATE '2025-10-01' GROUP BY fee.fee_type ORDER BY fee.fee_type\n\nParaphrases: none written. The held-out wording of this brief is written by the user, not derived from this case.\n\nBrief: docs/evals/domains/finance.md, Investigation brief: no wealth fees billed in August 2025 (facts FF1 to FF8).",
  "checks": [
    {
      "type": "matches",
      "args": {
        "pattern": "(?:July|Jul\\b|2025-07|FY2026-P01)[^.\\n]{0,80}?\\b(?:bill|charg|invoic|collect|went out|sent|post|deferr|delay|held|push|mov|roll|land)\\w*[^.\\n]{0,60}?(?:September|Sept?\\b|2025-09)|(?:September|Sept?\\b|2025-09)[^.\\n]{0,80}?\\b(?:includ|contain|cover|carr|held|hold|bundl|combin|catch|caught|both|plus|along with|together|double|twice)\\w*[^.\\n]{0,60}?(?:July|Jul\\b|2025-07|FY2026-P01)|\\b(?:two|both|double|twice the|2)\\s+months?\\b[^.\\n]{0,80}?(?:September|Sept?\\b|2025-09)|(?:September|Sept?\\b|2025-09)[^.\\n]{0,80}?\\b(?:two|both|2)\\s+months?\\b|\\b(?:billing|fees?|charges?|invoic\\w*|advisory)\\b[^.\\n]{0,40}?\\b(?:delay\\w*|postpon\\w*|deferr\\w*|held over|held back|pushed|moved|rolled|shifted|slipp\\w*|catch-up|caught up)|\\b(?:delay\\w*|postpon\\w*|deferr\\w*|late|catch-up)\\s+(?:\\w+\\s+){0,2}?(?:billing|fees?|charges?|invoic\\w*)",
        "flags": "i"
      },
      "criterion": "G3"
    },
    {
      "type": "notMatches",
      "args": {
        "pattern": "(?<!(?:\\b(?:not|never|nor|neither|rather than|instead of|unlikely|doubt|whether|if|was (?:it|that)|is (?:it|that))\\b|n['’]t\\b)[^.;:!?\\n]{0,50})(?<!\\bno\\b[^.;:!?\\n]{0,20})\\b(?:due to|because of|caused by|driven by|explained by|attributable to|(?:the|a) result of|reflects?|reflected|reflecting|down to|thanks to|stems? from|came from|comes from)\\s+(?:an?\\s+|the\\s+)?(?:\\w+[\\s-]+){0,2}?(?:performance\\s+fees?|(?:a\\s+)?fee\\s+(?:increase|rise|hike)|(?:higher|increased|new|raised)\\s+(?:advisory\\s+)?(?:fee\\s+)?(?:rates?|fees|pricing)|price\\s+(?:increase|rise)|new\\s+(?:clients|portfolios|business|accounts)|one-?off\\s+(?:fees?|charges?)|(?:a\\s+)?market\\s+(?:rally|gains?|rise)|(?:higher|rising|growing)\\s+(?:assets|AUM|balances))|(?<!(?:\\b(?:not|never|nor|neither|rather than|instead of|unlikely|doubt|whether|if|was (?:it|that)|is (?:it|that))\\b|n['’]t\\b)[^.;:!?\\n]{0,50})(?<!\\bno\\b[^.;:!?\\n]{0,20})\\bperformance\\s+fees?\\s+(?:were|was)\\s+(?:also\\s+)?(?:charged|billed|collected|booked|taken)\\s+(?:in|on|during)\\s+(?:September|Sept?\\b|2025-09)",
        "flags": "i"
      },
      "criterion": "G3"
    },
    {
      "type": "sqlMatches",
      "args": {
        "pattern": "fiscal_period",
        "flags": "i"
      },
      "criterion": "D2"
    },
    {
      "type": "calledTool",
      "args": {
        "tool": "run_readonly_sql"
      },
      "criterion": "D1"
    },
    {
      "type": "noToolErrors",
      "criterion": "D3"
    }
  ],
  "expectedSql": {
    "postgres": "SELECT SUM(fee.amount_cents) / 100.0 AS billed_dollars FROM finance.fees fee JOIN finance.portfolios portfolio ON portfolio.id = fee.portfolio_id WHERE fee.charged_on >= DATE '2025-09-01' AND fee.charged_on < DATE '2025-10-01' AND portfolio.is_test = false GROUP BY fee.fee_type ORDER BY fee.fee_type",
    "sqlite": "SELECT SUM(fee.amount_cents) / 100.0 AS billed_dollars FROM api.finance.fees fee JOIN api.finance.portfolios portfolio ON portfolio.id = fee.portfolio_id WHERE fee.charged_on >= '2025-09-01' AND fee.charged_on < '2025-10-01' AND portfolio.is_test = false GROUP BY fee.fee_type ORDER BY fee.fee_type",
    "databricks": "SELECT SUM(fee.amount_cents) / 100.0 AS billed_dollars FROM `evals`.finance.fees fee JOIN `evals`.finance.portfolios portfolio ON portfolio.id = fee.portfolio_id WHERE fee.charged_on >= DATE '2025-09-01' AND fee.charged_on < DATE '2025-10-01' AND portfolio.is_test = false GROUP BY fee.fee_type ORDER BY fee.fee_type"
  }
}
```

```json
{
  "id": "wealth-fee-revenue-august-2025",
  "category": "reasoning",
  "split": "dev",
  "tags": [
    "investigation",
    "trap:empty-month",
    "trap:wrong-explanation",
    "difficulty:hard"
  ],
  "question": "Did our wealth fee revenue fall in August 2025?",
  "intent": "Revenue counts fees by the period they cover: August's revenue was normal although nothing was billed that month. Say why billing was zero.",
  "notes": "Investigation, planted story W1 and trap W9. Fee revenue (settled and accrued, test portfolios out, by the period covered): July 2025 $45,529.75, August 2025 $42,451.44 (advisory only: no trading that month), against $39,645.48 to $44,898.35 in the other months of 2025 without quarter-end custody. By charge date nothing was billed in August, because July's and August's advisory fees were both billed on 2025-09-05. The reference projects July's and August's revenue.\n\nThe matches check needs both a revenue figure (42,451 or 45,530, written whole or in thousands) and the timing shift. The notMatches check fails an answer that says revenue fell to zero (unless the clause says it only looks so, or speaks of billing), or puts a fall down to lost clients, outflows, waivers or refunds.\n\nChecked against facts.json: wealth.W1_emptyMonth. Revenue by covered month was read on loop_finance on 2026-10-23.\n\nTrap query (must return different rows): SELECT SUM(fee.amount_cents) / 100.0 AS revenue_dollars FROM finance.fees fee JOIN finance.portfolios portfolio ON portfolio.id = fee.portfolio_id WHERE fee.charged_on >= DATE '2025-07-01' AND fee.charged_on < DATE '2025-09-01' AND fee.status IN ('SETTLED', 'ACCRUED') AND portfolio.is_test = false GROUP BY DATE_TRUNC('month', fee.charged_on) ORDER BY DATE_TRUNC('month', fee.charged_on)\n\nParaphrases: none written. The held-out wording of this brief is written by the user, not derived from this case.\n\nBrief: docs/evals/domains/finance.md, Investigation brief: no wealth fees billed in August 2025 (facts FF1 to FF8).",
  "checks": [
    {
      "type": "matches",
      "args": {
        "pattern": "^(?=[\\s\\S]*?(?:\\b42[,.\\s]?45[0-9](?:\\.\\d+)?\\b|\\$?42[.,][45]\\d?\\s*(?:thousand|k)\\b|\\b45[,.\\s]?5[23]\\d(?:\\.\\d+)?\\b|\\$?45[.,][45]\\d?\\s*(?:thousand|k)\\b))(?=[\\s\\S]*?(?:(?:July|Jul\\b|2025-07|FY2026-P01)[^.\\n]{0,80}?\\b(?:bill|charg|invoic|collect|went out|sent|post|deferr|delay|held|push|mov|roll|land)\\w*[^.\\n]{0,60}?(?:September|Sept?\\b|2025-09)|(?:September|Sept?\\b|2025-09)[^.\\n]{0,80}?\\b(?:includ|contain|cover|carr|held|hold|bundl|combin|catch|caught|both|plus|along with|together|double|twice)\\w*[^.\\n]{0,60}?(?:July|Jul\\b|2025-07|FY2026-P01)|\\b(?:two|both|double|twice the|2)\\s+months?\\b[^.\\n]{0,80}?(?:September|Sept?\\b|2025-09)|(?:September|Sept?\\b|2025-09)[^.\\n]{0,80}?\\b(?:two|both|2)\\s+months?\\b|\\b(?:billing|fees?|charges?|invoic\\w*|advisory)\\b[^.\\n]{0,40}?\\b(?:delay\\w*|postpon\\w*|deferr\\w*|held over|held back|pushed|moved|rolled|shifted|slipp\\w*|catch-up|caught up)|\\b(?:delay\\w*|postpon\\w*|deferr\\w*|late|catch-up)\\s+(?:\\w+\\s+){0,2}?(?:billing|fees?|charges?|invoic\\w*)))",
        "flags": "i"
      },
      "criterion": "G3"
    },
    {
      "type": "notMatches",
      "args": {
        "pattern": "(?<!(?:\\b(?:not|never|nor|neither|rather than|instead of|unlikely|doubt|whether|if|was (?:it|that)|is (?:it|that)|as if|as though|appears?|seems?|looks?|looked|billing|billed|charged|collections?)\\b|n['’]t\\b)[^.;:!?\\n]{0,50})(?<!\\bno\\b[^.;:!?\\n]{0,20})\\b(?:fee\\s+)?revenue\\s+(?:\\w+\\s+){0,2}?(?:fell|dropped|collapsed|went|was|sank|plunged)\\s+(?:to\\s+)?(?:zero|nothing|nil|\\$?0\\b)|(?<!(?:\\b(?:not|never|nor|neither|rather than|instead of|unlikely|doubt|whether|if|was (?:it|that)|is (?:it|that))\\b|n['’]t\\b)[^.;:!?\\n]{0,50})(?<!\\bno\\b[^.;:!?\\n]{0,20})\\b(?:due to|because of|caused by|driven by|explained by|attributable to|(?:the|a) result of|reflects?|reflected|reflecting|down to|thanks to|stems? from|came from|comes from)\\s+(?:an?\\s+|the\\s+)?(?:\\w+[\\s-]+){0,2}?(?:(?:client|customer)s?\\s+(?:loss\\w*|attrition|departures?|leaving|exits?|churn|closures?|withdrawals?|outflows?)|(?:lost|losing|fewer|departing)\\s+(?:clients|customers|portfolios|assets)|(?:asset|AUM|fund|money)\\s+(?:outflows?|withdrawals?|losses|decline|fall|drop)|outflows?|withdrawals|redemptions|(?:lower|falling|reduced|declining|shrinking)\\s+(?:assets|AUM|balances|portfolio values)|(?:market|asset)[\\s-](?:fall|drop|decline|downturn|sell-?off)|fee\\s+waivers?|waived\\s+fees|refunds?|reversals?)|(?<!(?:\\b(?:not|never|nor|neither|rather than|instead of|unlikely|doubt|whether|if|was (?:it|that)|is (?:it|that))\\b|n['’]t\\b)[^.;:!?\\n]{0,50})(?<!\\bno\\b[^.;:!?\\n]{0,20})\\b(?:we|the bank)\\s+lost\\s+(?!no\\b|none\\b|nothing\\b|any\\b)(?:\\w+\\s+){0,2}?(?:clients|customers|assets|business|AUM|portfolios)|(?<!(?:\\b(?:not|never|nor|neither|rather than|instead of|unlikely|doubt|whether|if|was (?:it|that)|is (?:it|that))\\b|n['’]t\\b)[^.;:!?\\n]{0,50})(?<!\\bno\\b[^.;:!?\\n]{0,20})\\b(?:clients|customers)\\s+(?:left|withdrew|pulled|moved (?:their )?(?:money|assets))|(?<!(?:\\b(?:not|never|nor|neither|rather than|instead of|unlikely|doubt|whether|if|was (?:it|that)|is (?:it|that))\\b|n['’]t\\b)[^.;:!?\\n]{0,50})(?<!\\bno\\b[^.;:!?\\n]{0,20})\\b(?:the\\s+)?(?:august\\s+)?fees\\s+(?:were|had been)\\s+(?:all\\s+)?(?:waived|refunded|reversed|cancelled|canceled|written off)",
        "flags": "i"
      },
      "criterion": "G3"
    },
    {
      "type": "sqlMatches",
      "args": {
        "pattern": "fiscal_period",
        "flags": "i"
      },
      "criterion": "D2"
    },
    {
      "type": "calledTool",
      "args": {
        "tool": "run_readonly_sql"
      },
      "criterion": "D1"
    },
    {
      "type": "noToolErrors",
      "criterion": "D3"
    }
  ],
  "expectedSql": {
    "postgres": "SELECT SUM(fee.amount_cents) / 100.0 AS revenue_dollars FROM finance.fees fee JOIN finance.portfolios portfolio ON portfolio.id = fee.portfolio_id JOIN finance.fiscal_periods period ON period.id = fee.fiscal_period_id WHERE period.period_start IN (DATE '2025-07-01', DATE '2025-08-01') AND fee.status IN ('SETTLED', 'ACCRUED') AND portfolio.is_test = false GROUP BY period.period_start ORDER BY period.period_start",
    "sqlite": "SELECT SUM(fee.amount_cents) / 100.0 AS revenue_dollars FROM api.finance.fees fee JOIN api.finance.portfolios portfolio ON portfolio.id = fee.portfolio_id JOIN api.finance.fiscal_periods period ON period.id = fee.fiscal_period_id WHERE period.period_start IN ('2025-07-01', '2025-08-01') AND fee.status IN ('SETTLED', 'ACCRUED') AND portfolio.is_test = false GROUP BY period.period_start ORDER BY period.period_start",
    "databricks": "SELECT SUM(fee.amount_cents) / 100.0 AS revenue_dollars FROM `evals`.finance.fees fee JOIN `evals`.finance.portfolios portfolio ON portfolio.id = fee.portfolio_id JOIN `evals`.finance.fiscal_periods period ON period.id = fee.fiscal_period_id WHERE period.period_start IN (DATE '2025-07-01', DATE '2025-08-01') AND fee.status IN ('SETTLED', 'ACCRUED') AND portfolio.is_test = false GROUP BY period.period_start ORDER BY period.period_start"
  }
}
```

### Held-out wording

_Placeholder: the held-out questions of this brief are written by the user. None exists yet._

- **How many:** two. The set has no other `reasoning` question, so the category would hold 4 dev and 2 held-out (33%, the about 30% of R134).
- **What they test:** the investigation from cold. One asks the natural question of *How they ask*. The other comes at the story from an angle no dev variant takes, for example one client's statement: Alistair Buchanan was billed two advisory fees of $5,258.08 on 2025-09-05, one for July and one for August (FY2026-P01 and FY2026-P02). Each must be answerable only by comparing when fees were billed with the period they cover.
- **What they must not copy:** four or more consecutive words of a dev question or of `quietest-fee-month-2025` and `collected-fees-fy2026-q1`; a dev framing (lost clients, the September spike, "did revenue fall"); a word of the cause (late, delay, July, September) unless the angle needs it; the platform change, which only the policy states. Name the wealth fees and the month, so the question stands alone.
- **What each needs before it enters the set:** category `reasoning`, split `held-out` (never moved to dev afterwards, R134), tag `investigation`, references in all three dialects validated as the drafts were, a trap query in the notes, and checks taken from the drafts.

### What approval decides

- The brief: who asks, the cause, the wrong explanation and the facts.
- Each dev draft: keep, change or drop. Three points to decide:
  - The two questions that say "billed" count every status, as policy section 7 defines billing; an answer that counts only settled fees fails their result-set match.
  - `september-2025-fee-billing-spike` takes September's billing by fee type as its reference, so an answer that splits September only by the month covered passes the text checks and fails the result-set match.
  - The leak check: these patterns add 75 words that are not literals yet, generic ones such as *delay*, *higher* and *assets* among them. Allowlist the generic ones with a reason when the cases enter the set; keep the story's words (*outflows*, *attrition*, *waivers*, *refunds*) as literals.
- The held-out wording.

Decided by the user on 2026-10-26 (decision 6 of the loop's log page):

- The brief is approved as drafted.
- All four dev drafts stay as drafted. "Billed" keeps counting every status, as policy section 7 defines it; the finance knowledge seed already tells the assistant that every status is a recorded fee and that `charged_on` is the billing date. `september-2025-fee-billing-spike` keeps its breakdown by fee type.
- When the cases enter the set, the generic words go on the leak check's allowlist with a reason, and the story's words stay literals, as proposed above.
- The August billing change stays out of the finance knowledge seed.
- The held-out wording is still the user's to write. Until it exists, no case of this brief enters a set.

If a later round puts the August billing change into the finance knowledge seed (a lever file), the brief turns into a lookup: keep it out of the seed, or retire the brief. Adding the cases also changes the question counts in the agents-evals spec, agents.md 8.1, the README of this folder and `EVAL_SETS` in `frontend/e2e/agents.spec.ts`.
