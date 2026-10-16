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
 * Banking only: the wealth-management tables (fiscal_periods, securities,
 * portfolios, holdings, fees) get no entry here. Nothing here settles the
 * "most valuable customer", "biggest wealth client" or "best performing
 * portfolio" ambiguity the question bank asks the assistant to notice.
 */
import type { KnowledgeSeed } from './types';

export const FINANCE_KNOWLEDGE: KnowledgeSeed = {
  knowledge: [
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
        'Every money column is an integer in MINOR units of its currency — ' +
        'cents for USD, euro cents for EUR, pence for GBP: amount_minor and ' +
        'amount_usd_minor on transactions, current_balance_minor on accounts, ' +
        'principal_minor and outstanding_minor on loans, and amount_minor, ' +
        'principal_minor and interest_minor on loan_payments. Divide by 100 ' +
        'to report a figure in dollars, euros or pounds.',
      synonyms: ['cents', 'pence', 'dollars', 'minor units'],
      entities: [
        'finance.transactions',
        'finance.accounts',
        'finance.loans',
        'finance.loan_payments',
      ],
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
        'accounts.currency is USD, EUR or GBP, and each transaction is in its ' +
        "account's currency. transactions.amount_minor is in that account " +
        'currency; amount_usd_minor is the same amount converted to US cents ' +
        'at the fx_rates rate (usd_per_unit) of the booking month, and equals ' +
        'amount_minor on USD accounts. Never add amount_minor across ' +
        'currencies — use amount_usd_minor for US-dollar totals. ' +
        'current_balance_minor is the 2025-12-31 balance in the account ' +
        'currency; convert EUR and GBP balances with fx_rates before adding ' +
        'them to USD ones.',
      synonyms: [
        'currency',
        'exchange rate',
        'fx',
        'US dollars',
        'euros',
        'pounds',
      ],
      entities: [
        'finance.transactions',
        'finance.accounts',
        'finance.fx_rates',
      ],
    },
    {
      kind: 'default_filter',
      title: 'Exclude test accounts',
      // Verified: `SELECT count(*) FILTER (WHERE is_test), count(*) FROM
      // finance.accounts` → 6 of 200 (3.0%); transactions on them → 36 of
      // 5400; cards on them → 1 of 150. `SELECT table_name FROM
      // information_schema.columns WHERE table_schema = 'finance' AND
      // column_name = 'is_test'` → accounts, portfolios and the two views:
      // customers, branches, loans and loan_payments have no flag.
      body:
        'Unless the question explicitly asks about test data, exclude accounts ' +
        'where is_test = true, together with their cards and every ' +
        'transaction booked on them (join cards or transactions to accounts ' +
        'on account_id and keep is_test = false). is_test flags synthetic ' +
        'sandbox accounts used for end-to-end testing, about 3% of accounts. ' +
        'Customers, branches, loans and loan payments carry no test flag.',
      entities: ['finance.accounts'],
    },
    {
      kind: 'term',
      title: 'Transaction status',
      // Verified: `SELECT status, count(*) FROM finance.transactions GROUP BY
      // 1` → PENDING 144, POSTED 5070, REVERSED 186.
      body:
        'transactions.status is POSTED, PENDING or REVERSED. Only POSTED ' +
        'transactions are settled money: PENDING ones had not settled by ' +
        '2025-12-31 and REVERSED ones were undone, so leave both out of any ' +
        'amount, spend, flow or balance figure. Every status is still a ' +
        'recorded transaction — status decides whether its money counts.',
      synonyms: ['settled', 'posted', 'pending', 'reversed', 'cleared'],
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
        'TRANSFER_OUT, FEE or INTEREST. amount_minor is always positive and ' +
        'direction gives the sign: CREDIT (DEPOSIT, TRANSFER_IN, INTEREST) ' +
        'adds money to the account, DEBIT takes it out. INTEREST is interest ' +
        'paid to depositors; interest charged on credit accounts is booked as ' +
        'FEE. Transfers are always internal: a TRANSFER_OUT leg on one ' +
        'account and a TRANSFER_IN leg on its counterparty_account_id, same ' +
        'day and amount, so the money stays inside the bank — see the ' +
        'net_customer_flow_usd_minor metric.',
      synonyms: ['credit', 'debit', 'inflow', 'outflow', 'internal transfer'],
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
        'Credit Card, LOC Personal Line of Credit). A deposit account holds ' +
        "the customer's money; on a CREDIT account current_balance_minor is " +
        'what the customer owes the bank. CREDIT accounts are always USD.',
      synonyms: [
        'deposit account',
        'credit account',
        'checking',
        'savings',
        'money market',
      ],
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
        '(payments stopped), PAID_OFF or CHARGED_OFF (written off as a ' +
        'loss). Non-performing loans are those DELINQUENT or DEFAULTED. ' +
        'PAID_OFF and CHARGED_OFF loans carry outstanding_minor = 0 (CHECK ' +
        'constraint) — a charge-off is a loss, not a repayment. Every loan is ' +
        "in USD, whatever currency the borrower's accounts are in.",
      synonyms: [
        'non-performing',
        'delinquent',
        'defaulted',
        'charged off',
        'paid off',
      ],
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
        'ONLINE_RETAIL, TRAVEL, UTILITIES, ENTERTAINMENT, HEALTH) is set on ' +
        'every CARD_PURCHASE and null on every other type (CHECK constraint), ' +
        'about 15% of rows; card_id follows the same rule.',
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
        'accounts.branch_id → branches → regions (region_id), the branch that ' +
        "holds the account. customers.home_branch_id is the customer's home " +
        "branch and differs from the account's branch on about a fifth of " +
        'accounts. Report customers, branches and regions by name, not id; ' +
        'v_transactions and v_accounts already perform these joins.',
      entities: [
        'finance.transactions',
        'finance.accounts',
        'finance.customers',
        'finance.branches',
        'finance.regions',
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
        'through 2025-12-31 only (CHECK constraints) — there is no ' +
        'transaction history before 2024. Accounts were opened and loans ' +
        'originated from 2019, and customers joined from 2015, so those dates ' +
        'reach back further than any transaction.',
      entities: ['finance.transactions'],
    },
    {
      kind: 'term',
      title: 'Loan payment split',
      // Verified: `SELECT count(*) FROM finance.loan_payments WHERE
      // principal_minor + interest_minor <> amount_minor` → 0 (also a CHECK).
      body:
        'Each loan_payments row is one payment received: amount_minor = ' +
        'principal_minor + interest_minor. principal_minor reduces the ' +
        "loan's balance; interest_minor is interest income. " +
        'loans.principal_minor is the amount originally lent; ' +
        'outstanding_minor is what was still owed on 2025-12-31.',
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
        'dollars. Combine with the "Exclude test accounts" filter ' +
        '(is_test = false) for a reported figure.',
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
        '"Exclude test accounts" filter (join to accounts, is_test = false) ' +
        'for a reported figure.',
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
