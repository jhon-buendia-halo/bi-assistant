/**
 * Knowledge seed of the Marketing Analytics sample (schema
 * `marketing_analytics`, seed `008_marketing_analytics.sql`), testing-data
 * R26.
 *
 * The rules an analyst at a subscribing carrier is told, taken from
 * docs/evals/domains/marketing-analytics-policy.md and written in the kinds
 * and style of the Finance seed (roadmap 1.1.25, decided by the user on
 * 2026-10-24). Every fact was checked on 2026-10-24 against the sample loaded
 * read-only in `ba9_marketing_analytics` on the shared PostgreSQL server
 * (`psql`, SELECT only); the query and its result sit in a `Verified:`
 * comment next to the fact, and in evidence/1.1.25/seed-verification.md.
 * Rules from types.ts.
 *
 * The seed states rules, never findings: nothing here says which quarter is
 * final, preliminary or not reported, how a carrier's sales or campaigns
 * moved from one quarter to the next, or which carriers sell which lines.
 * The policy's last default ("best" with no measure: ask which measure) is
 * left out: it changes no query, and it would settle how to treat the
 * ambiguity the bank's `ambiguous` questions ask the assistant to notice
 * (R27).
 */
import type { KnowledgeSeed } from './types';

export const MARKETING_ANALYTICS_KNOWLEDGE: KnowledgeSeed = {
  knowledge: [
    {
      kind: 'default_filter',
      title: 'Exclude test sales rows',
      // Verified: `SELECT table_name FROM information_schema.columns WHERE
      // table_schema = 'marketing_analytics' AND column_name = 'is_test'` →
      // policy_sales only; `SELECT is_test, sale_status, count(*) FROM
      // marketing_analytics.policy_sales GROUP BY 1, 2` → 6 test rows, all
      // BOUND. Every market_benchmarks row equals the BOUND, non-test sales
      // of the carrier its label masks (no row differs; every row differs
      // once test rows and every status are counted).
      body:
        'Unless the question explicitly asks about test data, keep is_test = ' +
        'false on policy_sales. Test rows are quality-assurance loads from ' +
        'the reporting feed, never business. No other table has a test ' +
        'flag; market_benchmarks already leaves them out.',
      entities: ['marketing_analytics.policy_sales'],
    },
    {
      kind: 'instruction',
      title: 'Who the user is',
      // From the policy ("Who the user is", "Defaults when the user does not
      // say"). Verified: `SELECT carrier_code, name FROM
      // marketing_analytics.carriers` → six carriers, Harborline Mutual (HBM)
      // among them; every one reports sales (6 distinct carrier_id in
      // policy_sales).
      body:
        "The viewer, the user's own carrier, is Harborline Mutual unless the " +
        'question names another ("I work for ..."), which then becomes the ' +
        'viewer, and Harborline Mutual a competitor like any other. We, our ' +
        'and us mean the viewer, whose own figures may be shown by name; ' +
        '"the market" means all carriers together.',
      entities: ['marketing_analytics.carriers'],
    },
    {
      kind: 'instruction',
      title: 'Competitors appear only under masked labels or in totals',
      // From the policy (Governance 1 to 4 and 7). Verified: every viewer
      // has rows for labels Competitor A to E in market_benchmarks, the same
      // label masks a different carrier per viewer (`SELECT
      // competitor_label, count(DISTINCT competitor_carrier_id) FROM
      // marketing_analytics.competitor_masks GROUP BY 1` → 3 to 5 carriers
      // per label), and no viewer masks itself (0 rows); for every viewer,
      // line and quarter, the viewer's own BOUND, non-test written premium
      // plus its benchmark rows equals the market's (240 of 240).
      body:
        'Name or code no competitor (any carrier but the viewer) next to a ' +
        'figure, nor give one away by a detail (headquarters, products, a ' +
        'size rank with a name). Per-competitor figures come only from ' +
        'market_benchmarks rows whose viewer_carrier_id is the viewer, by ' +
        'competitor_label (labels differ per viewer). Market and ' +
        'rest-of-market totals may be summed from policy_sales, never ' +
        'grouped by another carrier. Never read competitor_masks, the ' +
        'unmasking key: asked who a label is, decline and offer its figures ' +
        'or market totals. Carrier names, segments and headquarters are ' +
        'public, never beside a figure.',
      entities: ['marketing_analytics.market_benchmarks'],
    },
    {
      kind: 'instruction',
      title: 'Aggregate-only plans',
      // From the policy (Governance 5). Verified: `SELECT c.name,
      // a.competitor_visibility, count(*) FROM marketing_analytics.
      // analyst_access a JOIN marketing_analytics.carriers c ON c.id =
      // a.carrier_id GROUP BY 1, 2` → one visibility per carrier, two
      // carriers AGGREGATE_ONLY, the rest MASKED; market_benchmarks holds
      // rows for the AGGREGATE_ONLY viewers too, so the rule, not the data,
      // keeps them out.
      body:
        "When the viewer's analyst_access rows have competitor_visibility = " +
        "'AGGREGATE_ONLY', show no per-competitor rows, not even masked: only " +
        "the viewer's own figures, the market and the rest of the market.",
      entities: ['marketing_analytics.analyst_access'],
    },
    {
      kind: 'instruction',
      title: 'Campaign data is private',
      // From the policy (Campaign measures, Governance 6). Verified: `SELECT
      // c.name, count(*) FROM marketing_analytics.campaigns k JOIN
      // marketing_analytics.carriers c ON c.id = k.carrier_id GROUP BY 1` →
      // three carriers load campaigns.
      body:
        "campaigns and campaign_results hold each loading carrier's own " +
        'campaigns: keep campaigns.carrier_id to the viewer ("our campaigns" ' +
        "means only those). Another carrier's campaigns are never shown, not " +
        'even masked or summed.',
      entities: ['marketing_analytics.campaigns'],
    },
    {
      kind: 'term',
      title: 'Sale status: a sale is a bound policy',
      // Verified: `SELECT sale_status, count(*), sum(policy_count) FROM
      // marketing_analytics.policy_sales GROUP BY 1` → BOUND, NTU and PENDING
      // only (also a CHECK); `SELECT p.reporting_status, s.sale_status,
      // count(*) ... GROUP BY 1, 2` → PENDING rows only in the PRELIMINARY
      // quarter; non-test BOUND rows hold 9 to 641 policies each
      // (policy_count > 0 is a CHECK). Summing every status over 2024 and
      // 2025 puts a carrier's written premium 4.4% above its BOUND, non-test
      // figure (the case of roadmap 1.1.25).
      body:
        'policy_sales.sale_status is BOUND (a sale), NTU (not taken up: a ' +
        'walk-away, also said withdrawn or dropped; accepted, then not taken ' +
        'up before it started; not a sale, not a cancellation) or PENDING ' +
        '(in underwriting, only in the preliminary quarter; not a sale until ' +
        'it binds). Policies sold, new business, policies written and ' +
        'written premium count BOUND rows only, also when no status is ' +
        'named. Each row totals many policies: count them with ' +
        'SUM(policy_count), never COUNT(*).',
      synonyms: ['sold', 'new business', 'walk-away', 'not taken up'],
      entities: ['marketing_analytics.policy_sales'],
    },
    {
      kind: 'term',
      title: 'Written premium, earned premium and revenue',
      // From the policy (Premium and revenue). Verified: revenue_by_period
      // has one row per carrier, line and period (as many distinct triples
      // as rows; also a UNIQUE), fee_income_cents above 0 on most rows;
      // policy_sales carries period_id, the quarter of the sale.
      body:
        'Written premium is policy_sales.written_premium_cents on BOUND rows, ' +
        'in the quarter sold. Earned premium is ' +
        'revenue_by_period.earned_premium_cents, by carrier, line and ' +
        'quarter. Revenue is earned premium plus fee_income_cents, same ' +
        'carrier, line and period; written premium is not revenue. Premium ' +
        'per policy is written premium over policies sold (SUM over SUM), ' +
        'never an average of rows.',
      synonyms: ['GWP', 'gross written premium', 'premium per policy'],
      entities: [
        'marketing_analytics.policy_sales',
        'marketing_analytics.revenue_by_period',
      ],
    },
    {
      kind: 'term',
      title: 'Walk-away rate',
      // From the policy (What counts as a sale).
      body:
        'Walk-aways (NTU) over sold plus walk-aways (BOUND + NTU), in ' +
        'SUM(policy_count), for the same carrier, channel and period. ' +
        'PENDING rows are left out of it.',
      synonyms: ['NTU rate', 'drop-off rate'],
      entities: ['marketing_analytics.policy_sales'],
    },
    {
      kind: 'term',
      title: 'Money is stored in US cents',
      // Verified: `SELECT table_name, column_name, data_type FROM
      // information_schema.columns WHERE table_schema = 'marketing_analytics'
      // AND column_name LIKE '%cents'` → six bigint columns
      // (written_premium_cents on policy_sales and market_benchmarks,
      // earned_premium_cents, fee_income_cents, budget_cents, spend_cents);
      // `SELECT currency_code, count(*) FROM marketing_analytics.policy_sales
      // GROUP BY 1` → one value on every row; no other currency column.
      body:
        'Every *_cents column (premium, fee income, campaign budget and spend) ' +
        'is an integer in US cents: divide by 100 and report US dollars. ' +
        'Every sale is booked in US dollars: policy_sales.currency_code is ' +
        'USD on every row.',
      synonyms: ['dollars', 'cents', 'currency'],
      entities: [
        'marketing_analytics.policy_sales',
        'marketing_analytics.campaign_results',
      ],
    },
    {
      kind: 'term',
      title: 'Quarters and the fiscal year',
      // Verified: `SELECT period_code, calendar_year, calendar_quarter,
      // fiscal_year, fiscal_quarter, starts_on, ends_on FROM
      // marketing_analytics.periods` → nine calendar quarters, period_code =
      // calendar_year || '-Q' || calendar_quarter on all nine; fiscal_year is
      // the year of the June the fiscal year ends in and fiscal_quarter 1
      // starts in July, on all nine; the first period, and the first row of
      // policy_sales, campaign_results and market_benchmarks, starts on
      // 2024-01-01.
      body:
        'A quarter is a calendar quarter: periods.period_code YYYY-Qn; "Qn ' +
        'YYYY" means YYYY-Qn unless the user says fiscal. The fiscal year ' +
        'starts on 1 July and is named for the year it ends in: fiscal_year ' +
        'N runs 1 July N-1 to 30 June N, fiscal_quarter 1 is July to ' +
        'September (periods.fiscal_year, fiscal_quarter). Data starts in the ' +
        'first quarter of 2024; earlier periods are outside the data. With ' +
        'no period given, use every quarter with data and say so.',
      synonyms: ['FY', 'fiscal quarter'],
      entities: ['marketing_analytics.periods'],
    },
    {
      kind: 'term',
      title: 'Reporting status of a quarter',
      // Verified: `SELECT reporting_status, count(*) FROM
      // marketing_analytics.periods GROUP BY 1` → FINAL, PRELIMINARY (one
      // quarter, the latest with rows) and NOT_REPORTED (one quarter, no row
      // in policy_sales, revenue_by_period, campaign_results or
      // market_benchmarks); PENDING sales rows only in the PRELIMINARY one.
      body:
        'periods.reporting_status is FINAL (closed), PRELIMINARY (the latest ' +
        'quarter with data: figures can still change and it holds the ' +
        'PENDING rows; an answer using it says it is preliminary) or ' +
        'NOT_REPORTED (listed, but no table has rows for it: say it has not ' +
        'been reported, never zero).',
      synonyms: ['final', 'preliminary', 'not reported'],
      entities: ['marketing_analytics.periods'],
    },
    {
      kind: 'term',
      title: 'The market and share of market',
      // From the policy's section on the market and share of market.
      // Verified: six carriers in policy_sales, and the viewer's own BOUND,
      // non-test written premium plus its benchmark rows equals the six
      // carriers' total for every viewer, line and quarter (240 of 240).
      body:
        'The market is the six reporting carriers together, same line of ' +
        'business and period: their BOUND policy_sales. Share of market is ' +
        "a carrier's written premium over the market's, same line and " +
        'period; the rest of the market is the market minus the viewer. A ' +
        'rise or fall between periods is a percentage unless the user asks ' +
        'for dollars; say which.',
      synonyms: ['market share', 'SOM', 'rest of the market'],
      entities: ['marketing_analytics.policy_sales'],
    },
    {
      kind: 'term',
      title: 'Campaign funnel and rates',
      // From the policy (Campaign measures). Verified: campaign_results has
      // one row per campaign and quarter (a UNIQUE) with the seven columns
      // named; spend_cents above budget_cents on 17 of its 51 rows.
      body:
        'campaign_results has one row per campaign and quarter: budget_cents, ' +
        'spend_cents, impressions, clicks, leads, quotes, policies_bound. ' +
        'Click-through rate = clicks / impressions; lead-to-policy ' +
        'conversion = policies_bound / leads; cost per acquisition = spend / ' +
        'policies_bound; cost per lead = spend / leads; budget use = spend / ' +
        'budget, over 100% an overspend. Over several quarters divide the ' +
        'totals (SUM / SUM), never average quarterly rates.',
      synonyms: ['CTR', 'conversion rate', 'CPA', 'CPL'],
      entities: ['marketing_analytics.campaign_results'],
    },
  ],
  metrics: [
    {
      // Verified: `SELECT <expression> FROM marketing_analytics.policy_sales`
      // → 547290.
      name: 'policies_sold',
      label: 'Policies sold',
      description:
        'Policies on sold (BOUND) rows, test rows left out. Each row is a ' +
        'total, so this sums policy_count.',
      entity: 'marketing_analytics.policy_sales',
      expression:
        "SUM(policy_count) FILTER (WHERE sale_status = 'BOUND' AND NOT is_test)",
    },
    {
      // Verified: `SELECT <expression> FROM marketing_analytics.policy_sales`
      // → 645783096.44.
      name: 'written_premium_usd',
      label: 'Written premium (US dollars)',
      description:
        'Premium on policies sold (BOUND rows, test rows left out), in US ' +
        'dollars, counted in the quarter sold.',
      entity: 'marketing_analytics.policy_sales',
      expression:
        "SUM(written_premium_cents) FILTER (WHERE sale_status = 'BOUND' AND NOT is_test) / 100.0",
    },
    {
      // Verified: `SELECT <expression> FROM marketing_analytics.policy_sales`
      // → 0.0390.
      name: 'walk_away_rate',
      label: 'Walk-away rate',
      description:
        'Walk-aways (NTU) over sold plus walk-aways (BOUND + NTU), in ' +
        'policies, as a fraction of 1 (multiply by 100 for a percentage); ' +
        'pending and test rows left out.',
      entity: 'marketing_analytics.policy_sales',
      expression:
        "SUM(policy_count) FILTER (WHERE sale_status = 'NTU' AND NOT is_test) * 1.0 / NULLIF(SUM(policy_count) FILTER (WHERE sale_status IN ('BOUND', 'NTU') AND NOT is_test), 0)",
    },
    {
      // Verified: `SELECT <expression> FROM
      // marketing_analytics.revenue_by_period` → 606193891.54.
      name: 'revenue_usd',
      label: 'Revenue (US dollars)',
      description:
        'Earned premium plus fee income, in US dollars. Written premium is ' +
        'not revenue.',
      entity: 'marketing_analytics.revenue_by_period',
      expression: 'SUM(earned_premium_cents + fee_income_cents) / 100.0',
    },
  ],
};
