/**
 * Knowledge seed of the Finance sample (schema `finance`, seed
 * `007_finance.sql`), testing-data R26.
 *
 * The banking rules of `feat/engine-eval-loop` (`backend/scripts/semantics/
 * banking.ts`, written 2026-09-28 for schema `banking`), moved onto the
 * finance schema: its retail-banking tables are the branch's banking tables
 * row for row (docs/evals/domains/finance.md), with the same table and column
 * names, so only the schema changed. Every non-obvious fact was checked again
 * on 2026-10-16 against the seed loaded into its own database (`finance` on an
 * isolated PostgreSQL server, `psql`); the query and its result sit in a
 * `Verified:` comment next to the fact. Rules from types.ts; consistent with
 * docs/evals/domains/finance-policy.md.
 *
 * The wealth-management entries (fiscal_periods, portfolios, holdings, fees,
 * and the test-portfolio half of the default filter) were added in eval-loop
 * round r7 from what the assistant's own tool results showed in that round's
 * failure export; each fact carries a `Seen:` comment saying where, and a
 * `Verified:` comment with the query the lead ran against the database before
 * the round was measured (accepted by the user). The banking entries
 * were tightened in the same round to fit the 7,000-character knowledge
 * block, their facts unchanged. Nothing here settles the "most valuable
 * customer", "biggest wealth client" or "best performing portfolio"
 * ambiguity the question bank asks the assistant to notice.
 */
import type { KnowledgeSeed } from './types';

export const FINANCE_KNOWLEDGE: KnowledgeSeed = {
  knowledge: [
    {
      kind: 'default_filter',
      title: 'Exclude test accounts and portfolios',
      // Verified: `SELECT count(*) FILTER (WHERE is_test), count(*) FROM
      // finance.accounts` → 6 of 200 (3.0%); transactions on them → 36 of
      // 5400; cards on them → 1 of 150. `SELECT table_name FROM
      // information_schema.columns WHERE table_schema = 'finance' AND
      // column_name = 'is_test'` → accounts, portfolios and the two views:
      // customers, branches, loans and loan_payments have no flag.
      // Seen (r7 export): portfolios.is_test splits holdings and fees into a
      // real and a test group (holdings and fees join on portfolio_id), and
      // test portfolios carry a large share of advisory fee amounts. Verified 2026-10-22 on the loop's copy of the sample (loop_finance):
      // `SELECT p.is_test, count(DISTINCT p.id), count(h.id) FROM
      // finance.portfolios p LEFT JOIN finance.holdings h ON h.portfolio_id =
      // p.id GROUP BY 1`, and the same on finance.fees → both groups exist,
      // with holdings and fees on test portfolios as well as real ones.
      body:
        'Unless the question explicitly asks about test data, keep is_test = ' +
        'false on accounts and on portfolios, and leave out what belongs to a ' +
        'test one: its cards and transactions (join on account_id), its ' +
        'holdings and fees (join on portfolio_id). Test rows are synthetic ' +
        'sandbox data. Customers, branches, loans and loan payments carry no ' +
        'test flag.',
      entities: ['finance.accounts', 'finance.portfolios'],
    },
    {
      kind: 'term',
      title: 'Fiscal calendar',
      // Seen (r7 export): fiscal_periods rows where fiscal_month 1 of a
      // fiscal_year starts on 1 July of the year before, fiscal_quarter 1
      // spans July–September and quarter 2 October–December, and the latest
      // period_end of a fiscal_year is 30 June of that year. Verified 2026-10-22 on the loop's copy of the sample (loop_finance):
      // `SELECT fiscal_year, fiscal_quarter, min(period_start),
      // max(period_end) FROM finance.fiscal_periods GROUP BY 1, 2 ORDER BY 1,
      // 2` → every fiscal year from 1 July to 30 June, quarter 1 July to
      // September; the end of fiscal N is 30 June N (finance-policy.md 2).
      body:
        'The fiscal year runs July to June and is named for the year it ends ' +
        'in: fiscal_year N is 1 July N-1 to 30 June N, fiscal_quarter 1 is ' +
        'July–September. Fiscal years, quarters and year-ends mean ' +
        'fiscal_periods, not calendar ones: the end of fiscal N is 30 June N.',
      synonyms: ['FY'],
      entities: ['finance.fiscal_periods'],
    },
    {
      kind: 'term',
      title: 'Wealth fee status and revenue',
      // Seen (r7 export): fee_type values ADVISORY, CUSTODY, PERFORMANCE,
      // TRADING and status values ACCRUED, SETTLED, WAIVED, REVERSED in
      // GROUP BY results; every row with charged_on null is ACCRUED, and the
      // ACCRUED rows sit in the latest fee period only; advisory fees of a
      // fiscal year are charged from the month after its first period to the
      // month after its last. Revenue = SETTLED + ACCRUED, net of test
      // portfolios, is what the round's reference results add up to (the
      // settled amount plus the unbilled amount of the same quarter).
      // Verified 2026-10-22 on the loop's copy of the sample (loop_finance): `SELECT fee_type, status,
      // count(*), count(charged_on) FROM finance.fees GROUP BY 1, 2` → the
      // four types and four statuses above, no other; every ACCRUED row has
      // no charged_on and every other row has one. Revenue = SETTLED +
      // ACCRUED by the period covered is finance-policy.md's definition (7).
      body:
        'fees.fee_type is ADVISORY, CUSTODY, PERFORMANCE or TRADING. ' +
        'fees.status is ACCRUED (owed for its period, not invoiced yet: ' +
        'charged_on is null), SETTLED (billed and paid), WAIVED (forgiven) or ' +
        'REVERSED (refunded after billing). Fee revenue is SETTLED plus ' +
        'ACCRUED, though every status is still a recorded fee. charged_on is ' +
        "the billing date and can fall after the fee's period: use it for " +
        'when fees were billed, fiscal_period_id for when they were earned.',
      entities: ['finance.fees'],
    },
    {
      kind: 'term',
      title: 'Portfolios and wealth clients',
      // Seen (r7 export): `GROUP BY status, base_currency` on portfolios
      // returns OPEN and CLOSED only (no ACTIVE), all in USD;
      // advisory_fee_bps / 100.0 gives annual rates under 2%; customers
      // segments are RETAIL, PREMIER and BUSINESS. The wealth-client
      // definition is inferred from the round's reference result (fewer
      // clients than customers with any non-test portfolio). Verified 2026-10-22 on the loop's copy of the sample (loop_finance):
      // statuses OPEN and CLOSED only, all USD, advisory_fee_bps from 0 to
      // 100, and fewer customers with an OPEN non-test portfolio than with
      // any non-test one; finance-policy.md 6 defines a wealth client so and
      // says PREMIER is a banking segment, not a wealth one.
      body:
        "portfolios.status is OPEN or CLOSED, and every portfolio's " +
        'base_currency is USD. advisory_fee_bps is the annual advisory fee in ' +
        'basis points (divide by 100 for a percentage). A wealth client is a ' +
        'customer with at least one OPEN portfolio; customers.segment (RETAIL, ' +
        'PREMIER, BUSINESS) has no wealth value.',
      entities: ['finance.portfolios', 'finance.customers'],
    },
    {
      kind: 'term',
      title: 'Holdings are dated snapshots',
      // Seen (r7 export): holdings rows keyed by portfolio_id, security_id
      // and as_of, with as_of on quarter-end dates; cost_basis_cents null on
      // some rows and never 0. "Never carry forward" is inferred from the
      // round's reference result (a count below the latest-row-per-position
      // count). Verified 2026-10-22 on the loop's copy of the sample (loop_finance): `SELECT as_of,
      // count(*), count(cost_basis_cents) FROM finance.holdings GROUP BY 1
      // ORDER BY 1` → the eight quarter ends of 2024 and 2025,
      // some rows with no cost basis on every date and none at 0;
      // finance-policy.md 6: snapshots are balances, never added across dates.
      body:
        'Each holdings row is one position (portfolio_id, security_id) on the ' +
        'snapshot date as_of, a quarter end. The positions held on a date are ' +
        'the rows with that as_of; never carry an older row forward. ' +
        'market_value_cents and cost_basis_cents are US cents; ' +
        'cost_basis_cents is null when the cost basis is missing.',
      entities: ['finance.holdings'],
    },
    {
      kind: 'term',
      title: 'Amounts are stored in minor units',
      // Verified: `SELECT table_name, column_name, data_type FROM
      // information_schema.columns WHERE table_schema = 'finance' AND
      // (column_name LIKE '%minor' OR column_name LIKE '%cents')` → every money
      // column is bigint (the banking *_minor columns named below, and the
      // wealth *_cents columns, US cents); `SELECT currency, count(*) FROM
      // finance.accounts GROUP BY 1` → EUR 14, GBP 10, USD 176.
      body:
        'Money columns are integers in minor units: banking *_minor columns in ' +
        'cents, euro cents or pence of their currency (USD, EUR, GBP); wealth ' +
        '*_cents columns (fees, holdings) in US cents. Divide by 100 in the ' +
        'query for dollars, euros or pounds.',
      synonyms: ['cents', 'pence', 'dollars', 'minor units'],
      entities: ['finance.transactions', 'finance.fees'],
    },
    {
      kind: 'term',
      title: 'Account currency and the USD reporting amount',
      // Verified: `SELECT count(*) FROM finance.transactions t LEFT JOIN
      // finance.fx_rates r ON r.currency = t.currency AND r.rate_month =
      // date_trunc('month', t.booked_on)::date WHERE t.amount_usd_minor <> CASE
      // WHEN t.currency = 'USD' THEN t.amount_minor ELSE round(t.amount_minor *
      // r.usd_per_unit) END` → 0; transaction currency equals the account
      // currency on 5400 of 5400 rows; fx_rates holds 48 rows (EUR, GBP),
      // 2024-01-01 .. 2025-12-01.
      body:
        "accounts.currency is USD, EUR or GBP; a transaction is in its account's " +
        'currency. amount_usd_minor is amount_minor converted to US cents at ' +
        'the fx_rates rate (usd_per_unit) of the booking month (equal on USD ' +
        'accounts): use it for US-dollar totals, never add amount_minor across ' +
        'currencies. current_balance_minor is the 2025-12-31 balance in the ' +
        'account currency; convert EUR and GBP ones with fx_rates before adding ' +
        'them to USD.',
      synonyms: ['currency', 'exchange rate', 'fx'],
      entities: ['finance.transactions', 'finance.fx_rates'],
    },
    {
      kind: 'term',
      title: 'Transaction status',
      // Verified: `SELECT status, count(*) FROM finance.transactions GROUP BY
      // 1` → PENDING 144, POSTED 5070, REVERSED 186.
      body:
        'transactions.status is POSTED, PENDING (not settled by 2025-12-31) or ' +
        'REVERSED (undone). Only POSTED money counts in any amount, spend, ' +
        'flow or balance figure, though every status is still a recorded ' +
        'transaction.',
      synonyms: ['settled', 'cleared'],
      entities: ['finance.transactions'],
    },
    {
      kind: 'term',
      title: 'Transaction type and direction',
      // Verified: `SELECT type, direction, count(*) FROM finance.transactions
      // GROUP BY 1, 2` → DEPOSIT/TRANSFER_IN/INTEREST always CREDIT, the other
      // four always DEBIT (also a CHECK); CHECK (amount_minor > 0). Every
      // TRANSFER_OUT has exactly one TRANSFER_IN on its
      // counterparty_account_id with the same booked_on, amount_minor and
      // status, and the reverse (unpaired legs → 0; 300 of each). `SELECT
      // t.type, at.category, count(*) ... WHERE t.type IN ('INTEREST', 'FEE')
      // GROUP BY 1, 2` → INTEREST only on DEPOSIT accounts (1019); FEE on
      // CREDIT (306) and DEPOSIT (346) accounts.
      body:
        'transactions.type is DEPOSIT, WITHDRAWAL, CARD_PURCHASE, TRANSFER_IN, ' +
        'TRANSFER_OUT, FEE or INTEREST. amount_minor is always positive; ' +
        'direction gives the sign: CREDIT (DEPOSIT, TRANSFER_IN, INTEREST) ' +
        'adds money, DEBIT takes it out. INTEREST is paid to depositors; ' +
        'interest charged on credit accounts is booked as FEE. Transfers are ' +
        'internal: a TRANSFER_OUT leg on one account and a TRANSFER_IN leg on ' +
        'its counterparty_account_id, same day and amount (see ' +
        'net_customer_flow_usd_minor).',
      synonyms: ['inflow', 'outflow', 'internal transfer'],
      entities: ['finance.transactions'],
    },
    {
      kind: 'term',
      title: 'Deposit accounts versus credit accounts',
      // Verified: `SELECT code, name, category FROM finance.account_types` →
      // CHK Everyday Checking, SAV High-Yield Savings, MMA Money Market
      // Account DEPOSIT; CC Rewards Credit Card, LOC Personal Line of Credit
      // CREDIT. CREDIT accounts not in USD → 0.
      body:
        'account_types.category is DEPOSIT (CHK Everyday Checking, SAV ' +
        'High-Yield Savings, MMA Money Market Account) or CREDIT (CC Rewards ' +
        'Credit Card, LOC Personal Line of Credit, always USD). On a CREDIT ' +
        'account current_balance_minor is what the customer owes the bank.',
      synonyms: ['checking', 'savings', 'money market'],
      entities: ['finance.account_types'],
    },
    {
      kind: 'term',
      title: 'Account status vocabulary',
      // Verified: `SELECT status, count(*), count(closed_on) FROM
      // finance.accounts GROUP BY 1` → ACTIVE 178, CLOSED 12 (all with
      // closed_on, balance 0; also CHECKs), DORMANT 7, FROZEN 3. DORMANT
      // accounts: 0 non-INTEREST transactions in 2025, 48 INTEREST ones.
      body:
        'accounts.status is ACTIVE, DORMANT (no customer activity in 2025; ' +
        'interest still posts), FROZEN or CLOSED, as of 2025-12-31. Only ' +
        'CLOSED accounts have a closed_on date, and their ' +
        'current_balance_minor is 0.',
      synonyms: ['open accounts', 'closed accounts', 'dormant', 'frozen'],
      entities: ['finance.accounts'],
    },
    {
      kind: 'term',
      title: 'Loan status vocabulary',
      // Verified: `SELECT status, count(*), sum(outstanding_minor) FROM
      // finance.loans GROUP BY 1` → CHARGED_OFF 3 (outstanding 0), CURRENT 56,
      // DEFAULTED 4, DELINQUENT 8, PAID_OFF 39 (outstanding 0); CHECK (status
      // NOT IN ('PAID_OFF','CHARGED_OFF') OR outstanding_minor = 0); CHECK
      // (currency = 'USD').
      body:
        'loans.status is CURRENT, DELINQUENT (payments overdue), DEFAULTED ' +
        '(payments stopped), PAID_OFF or CHARGED_OFF (written off as a loss, ' +
        'not a repayment). Non-performing loans are those DELINQUENT or ' +
        'DEFAULTED. PAID_OFF and CHARGED_OFF loans have outstanding_minor = 0. ' +
        'Every loan is in USD.',
      synonyms: ['non-performing', 'delinquent', 'defaulted'],
      entities: ['finance.loans'],
    },
    {
      kind: 'term',
      title: 'Merchant category is recorded on card purchases only',
      // Verified: `SELECT type, count(merchant_category), count(card_id),
      // count(*) FROM finance.transactions GROUP BY 1` → 803 of 803 on
      // CARD_PURCHASE, 0 on every other type (803 of 5400 rows, 14.9%);
      // CHECKs ((type = 'CARD_PURCHASE') = (merchant_category IS NOT NULL))
      // and the same for card_id; the eight values are the CHECK's.
      body:
        'transactions.merchant_category (GROCERY, RESTAURANTS, FUEL, ' +
        'ONLINE_RETAIL, TRAVEL, UTILITIES, ENTERTAINMENT, HEALTH) and card_id ' +
        'are set on every CARD_PURCHASE and null on every other type (CHECK ' +
        'constraints).',
      synonyms: ['merchant', 'spend category'],
      entities: ['finance.transactions'],
    },
    {
      kind: 'instruction',
      title: 'Join transactions to customers, branches and regions',
      // Verified: `SELECT count(*) FILTER (WHERE a.branch_id <>
      // c.home_branch_id), count(*) FROM finance.accounts a JOIN
      // finance.customers c ON c.id = a.customer_id` → 38 of 200 (19%).
      // `pg_get_viewdef` of v_transactions and v_accounts join account →
      // customers, branches (account.branch_id) → regions; `obj_description`
      // of v_transactions → "branch/region are the ACCOUNT branch, not the
      // customer home branch."
      body:
        'transactions carry account_id only. Customer: transactions → accounts ' +
        '(account_id) → customers (customer_id). Branch and region: ' +
        'accounts.branch_id → branches → regions (region_id), the branch holding ' +
        'the account; customers.home_branch_id differs from it on about a fifth ' +
        'of accounts. Report customers, branches and regions by name; ' +
        'v_transactions and v_accounts already do these joins.',
      entities: [
        'finance.transactions',
        'finance.customers',
        'finance.branches',
      ],
    },
    {
      kind: 'term',
      title: 'Coverage: transactions booked in 2024 and 2025 only',
      // Verified: `SELECT min(booked_on), max(booked_on) FROM
      // finance.transactions` → 2024-01-02 .. 2025-12-31; loan_payments
      // 2024-01-05 .. 2025-12-28; accounts opened 2019-04-15 .. 2025-12-31;
      // loans originated 2019-02-11 .. 2025-11-14; customers joined 2015-08-28
      // .. 2024-11-30. CHECKs: booked_on and paid_on BETWEEN 2024-01-01 AND
      // 2025-12-31, opened_on and originated_on from 2019-01-01, joined_on
      // from 2015-01-01.
      body:
        'transactions.booked_on and loan_payments.paid_on cover 2024-01-01 ' +
        'through 2025-12-31 only (CHECK constraints): no transaction history ' +
        'before 2024. Accounts were opened and loans originated from 2019, ' +
        'customers joined from 2015.',
      entities: ['finance.transactions'],
    },
    {
      kind: 'term',
      title: 'Loan payment split',
      // Verified: `SELECT count(*) FROM finance.loan_payments WHERE
      // principal_minor + interest_minor <> amount_minor` → 0 (also a CHECK).
      body:
        'Each loan_payments row is one payment received: amount_minor = ' +
        'principal_minor (repays the loan) + interest_minor (interest income). ' +
        'loans.principal_minor is the amount lent; outstanding_minor is what ' +
        'was still owed on 2025-12-31.',
      entities: ['finance.loan_payments', 'finance.loans'],
    },
  ],
  metrics: [
    {
      // Verified: `SELECT <expression> FROM finance.v_transactions WHERE NOT
      // is_test` → 413151459.
      name: 'net_customer_flow_usd_minor',
      label: 'Net customer flow (US cents)',
      description:
        'Money in minus money out, in US cents (amount_usd_minor), on POSTED ' +
        'transactions only and excluding internal transfers, which only move ' +
        'money between two accounts inside the bank. Divide by 100 for US ' +
        'dollars. Combine with the "Exclude test accounts and portfolios" ' +
        'filter (is_test = false) for a reported figure.',
      entity: 'finance.v_transactions',
      expression:
        "SUM(CASE WHEN direction = 'CREDIT' THEN amount_usd_minor ELSE -amount_usd_minor END) FILTER (WHERE status = 'POSTED' AND type NOT IN ('TRANSFER_IN', 'TRANSFER_OUT'))",
    },
    {
      // Verified: `SELECT <expression> FROM finance.transactions WHERE
      // account_id IN (SELECT id FROM finance.accounts WHERE NOT is_test)` →
      // 10552806.
      name: 'card_spend_usd_minor',
      label: 'Card spend (US cents)',
      description:
        'Settled card purchases in US cents: POSTED CARD_PURCHASE rows, ' +
        'amount_usd_minor. Divide by 100 for US dollars. Combine with the ' +
        '"Exclude test accounts and portfolios" filter (join to accounts, ' +
        'is_test = false) for a reported figure.',
      entity: 'finance.transactions',
      expression:
        "SUM(amount_usd_minor) FILTER (WHERE type = 'CARD_PURCHASE' AND status = 'POSTED')",
    },
    {
      // Verified: `SELECT <expression> FROM finance.loan_payments` → 0.3306.
      name: 'interest_share_of_payments',
      label: 'Interest share of loan payments',
      description:
        'Share of the loan payments received that was interest, as a ' +
        'fraction of 1 (multiply by 100 for a percentage). Loan payments ' +
        'carry no test flag.',
      entity: 'finance.loan_payments',
      expression: 'SUM(interest_minor) * 1.0 / NULLIF(SUM(amount_minor), 0)',
    },
  ],
};
