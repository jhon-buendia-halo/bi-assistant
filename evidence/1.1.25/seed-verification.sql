-- Verification queries of the Marketing Analytics knowledge seed (roadmap 1.1.25, BA-188).
-- Run read-only, 2026-10-24, against ba9_marketing_analytics on the shared PostgreSQL (port 55432):
--   docker exec -i questions-to-insights-world-cup-postgres-1 psql -U world_cup -d ba9_marketing_analytics -At -F ' | ' -v ON_ERROR_STOP=1 < seed-verification.sql
\echo == V1 sale_status vocabulary
SELECT sale_status, count(*) AS rows, sum(policy_count) AS policies FROM marketing_analytics.policy_sales GROUP BY 1 ORDER BY 1;
\echo == V2 PENDING only in the PRELIMINARY quarter
SELECT p.reporting_status, s.sale_status, count(*) FROM marketing_analytics.policy_sales s JOIN marketing_analytics.periods p ON p.id = s.period_id GROUP BY 1, 2 ORDER BY 1, 2;
\echo == V3 rows are totals (non-test rows, policies per row)
SELECT sale_status, min(policy_count), max(policy_count), round(avg(policy_count), 1) FROM marketing_analytics.policy_sales WHERE NOT is_test GROUP BY 1 ORDER BY 1;
\echo == V4 the real case: every status over BOUND non-test, Harborline Mutual written premium 2024 and 2025
SELECT round(sum(s.written_premium_cents)::numeric / sum(s.written_premium_cents) FILTER (WHERE s.sale_status = 'BOUND' AND NOT s.is_test), 4) AS ratio FROM marketing_analytics.policy_sales s JOIN marketing_analytics.carriers c ON c.id = s.carrier_id JOIN marketing_analytics.periods p ON p.id = s.period_id WHERE c.name = 'Harborline Mutual' AND p.calendar_year IN (2024, 2025);
\echo == V5 test flag: which tables have is_test
SELECT table_name FROM information_schema.columns WHERE table_schema = 'marketing_analytics' AND column_name = 'is_test' ORDER BY 1;
\echo == V6 test rows by status
SELECT is_test, sale_status, count(*) FROM marketing_analytics.policy_sales GROUP BY 1, 2 ORDER BY 1, 2;
\echo == V7 market_benchmarks rows against the BOUND non-test sales of the carrier each label masks (rows, rows that differ)
WITH s AS (SELECT s.carrier_id, s.period_id, pr.line_id, sum(s.policy_count) pc, sum(s.written_premium_cents) wp FROM marketing_analytics.policy_sales s JOIN marketing_analytics.products pr ON pr.id = s.product_id WHERE s.sale_status = 'BOUND' AND NOT s.is_test GROUP BY 1, 2, 3)
SELECT count(*) AS rows, count(*) FILTER (WHERE s.pc IS DISTINCT FROM b.policy_count OR s.wp IS DISTINCT FROM b.written_premium_cents) AS differ FROM marketing_analytics.market_benchmarks b JOIN marketing_analytics.competitor_masks m ON m.viewer_carrier_id = b.viewer_carrier_id AND m.competitor_label = b.competitor_label LEFT JOIN s ON s.carrier_id = m.competitor_carrier_id AND s.period_id = b.period_id AND s.line_id = b.line_id;
\echo == V8 the same against every status and test rows (rows that differ)
WITH s AS (SELECT s.carrier_id, s.period_id, pr.line_id, sum(s.policy_count) pc, sum(s.written_premium_cents) wp FROM marketing_analytics.policy_sales s JOIN marketing_analytics.products pr ON pr.id = s.product_id GROUP BY 1, 2, 3)
SELECT count(*) FILTER (WHERE s.pc IS DISTINCT FROM b.policy_count OR s.wp IS DISTINCT FROM b.written_premium_cents) AS differ FROM marketing_analytics.market_benchmarks b JOIN marketing_analytics.competitor_masks m ON m.viewer_carrier_id = b.viewer_carrier_id AND m.competitor_label = b.competitor_label LEFT JOIN s ON s.carrier_id = m.competitor_carrier_id AND s.period_id = b.period_id AND s.line_id = b.line_id;
\echo == V9 carriers, and carriers that report sales
SELECT carrier_code, name, segment FROM marketing_analytics.carriers ORDER BY id;
SELECT count(DISTINCT carrier_id) AS reporting FROM marketing_analytics.policy_sales;
\echo == V10 market = the viewer own BOUND non-test written premium + its benchmark rows, per viewer, line and quarter (cells, cells that differ)
WITH s AS (SELECT s.carrier_id, s.period_id, pr.line_id, sum(s.written_premium_cents) wp FROM marketing_analytics.policy_sales s JOIN marketing_analytics.products pr ON pr.id = s.product_id WHERE s.sale_status = 'BOUND' AND NOT s.is_test GROUP BY 1, 2, 3),
m AS (SELECT period_id, line_id, sum(wp) wp FROM s GROUP BY 1, 2),
v AS (SELECT c.id, m.wp AS market, coalesce((SELECT wp FROM s WHERE s.carrier_id = c.id AND s.period_id = m.period_id AND s.line_id = m.line_id), 0) AS own, coalesce((SELECT sum(b.written_premium_cents) FROM marketing_analytics.market_benchmarks b WHERE b.viewer_carrier_id = c.id AND b.period_id = m.period_id AND b.line_id = m.line_id), 0) AS bench FROM marketing_analytics.carriers c CROSS JOIN m)
SELECT count(*) AS cells, count(*) FILTER (WHERE market <> own + bench) AS differ FROM v;
\echo == V11 labels per viewer, and carriers behind each label across viewers
SELECT count(DISTINCT viewer_carrier_id) AS viewers, string_agg(DISTINCT competitor_label, ', ') AS labels FROM marketing_analytics.market_benchmarks;
SELECT competitor_label, count(DISTINCT competitor_carrier_id) AS carriers FROM marketing_analytics.competitor_masks GROUP BY 1 ORDER BY 1;
SELECT count(*) AS viewer_masks_itself FROM marketing_analytics.competitor_masks WHERE viewer_carrier_id = competitor_carrier_id;
\echo == V12 competitor visibility per carrier, and benchmark rows of each viewer
SELECT c.name, a.competitor_visibility, count(*) AS analysts FROM marketing_analytics.analyst_access a JOIN marketing_analytics.carriers c ON c.id = a.carrier_id GROUP BY 1, 2 ORDER BY 1, 2;
SELECT c.name, count(*) AS benchmark_rows FROM marketing_analytics.market_benchmarks b JOIN marketing_analytics.carriers c ON c.id = b.viewer_carrier_id GROUP BY 1 ORDER BY 1;
\echo == V13 carriers that load campaigns
SELECT c.name, count(*) AS campaigns FROM marketing_analytics.campaigns k JOIN marketing_analytics.carriers c ON c.id = k.carrier_id GROUP BY 1 ORDER BY 1;
\echo == V14 money columns and currency
SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = 'marketing_analytics' AND column_name LIKE '%cents' ORDER BY 1, 2;
SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'marketing_analytics' AND column_name LIKE '%currency%';
SELECT currency_code, count(*) FROM marketing_analytics.policy_sales GROUP BY 1;
\echo == V15 revenue_by_period grain and fee income
SELECT count(*) AS rows, count(DISTINCT (carrier_id, line_id, period_id)) AS distinct_keys, count(*) FILTER (WHERE fee_income_cents > 0) AS with_fees FROM marketing_analytics.revenue_by_period;
\echo == V16 periods: code format and fiscal rule (rows, rows that follow it)
SELECT count(*) AS periods, count(*) FILTER (WHERE period_code = calendar_year || '-Q' || calendar_quarter) AS code_ok, count(*) FILTER (WHERE fiscal_year = calendar_year + CASE WHEN calendar_quarter >= 3 THEN 1 ELSE 0 END AND fiscal_quarter = ((calendar_quarter + 1) % 4) + 1) AS fiscal_ok FROM marketing_analytics.periods;
SELECT calendar_quarter, fiscal_quarter, min(to_char(starts_on, 'Mon')) AS first_month FROM marketing_analytics.periods GROUP BY 1, 2 ORDER BY 1;
\echo == V17 coverage start: first period and first row of each fact table
SELECT 'periods' AS t, min(starts_on) FROM marketing_analytics.periods
UNION ALL SELECT 'policy_sales', min(p.starts_on) FROM marketing_analytics.policy_sales s JOIN marketing_analytics.periods p ON p.id = s.period_id
UNION ALL SELECT 'revenue_by_period', min(p.starts_on) FROM marketing_analytics.revenue_by_period s JOIN marketing_analytics.periods p ON p.id = s.period_id
UNION ALL SELECT 'campaign_results', min(p.starts_on) FROM marketing_analytics.campaign_results s JOIN marketing_analytics.periods p ON p.id = s.period_id
UNION ALL SELECT 'market_benchmarks', min(p.starts_on) FROM marketing_analytics.market_benchmarks s JOIN marketing_analytics.periods p ON p.id = s.period_id;
\echo == V18 reporting status vocabulary, and rows in a NOT_REPORTED quarter
SELECT reporting_status, count(*) AS quarters FROM marketing_analytics.periods GROUP BY 1 ORDER BY 1;
SELECT (SELECT count(*) FROM marketing_analytics.policy_sales s JOIN marketing_analytics.periods p ON p.id = s.period_id WHERE p.reporting_status = 'NOT_REPORTED') AS sales, (SELECT count(*) FROM marketing_analytics.revenue_by_period s JOIN marketing_analytics.periods p ON p.id = s.period_id WHERE p.reporting_status = 'NOT_REPORTED') AS revenue, (SELECT count(*) FROM marketing_analytics.campaign_results s JOIN marketing_analytics.periods p ON p.id = s.period_id WHERE p.reporting_status = 'NOT_REPORTED') AS campaign_results, (SELECT count(*) FROM marketing_analytics.market_benchmarks s JOIN marketing_analytics.periods p ON p.id = s.period_id WHERE p.reporting_status = 'NOT_REPORTED') AS benchmarks;
SELECT (SELECT max(starts_on) FROM marketing_analytics.periods WHERE reporting_status = 'PRELIMINARY') > (SELECT max(p.starts_on) FROM marketing_analytics.policy_sales s JOIN marketing_analytics.periods p ON p.id = s.period_id WHERE p.reporting_status = 'FINAL') AS preliminary_is_the_latest_with_rows;
\echo == V19 campaign_results grain, funnel columns, overspend rows
SELECT count(*) AS rows, count(DISTINCT (campaign_id, period_id)) AS distinct_keys, count(*) FILTER (WHERE spend_cents > budget_cents) AS overspend FROM marketing_analytics.campaign_results;
SELECT column_name FROM information_schema.columns WHERE table_schema = 'marketing_analytics' AND table_name = 'campaign_results' ORDER BY ordinal_position;
\echo == V20 metric expressions over the whole table
SELECT sum(policy_count) FILTER (WHERE sale_status = 'BOUND' AND NOT is_test) AS policies_sold FROM marketing_analytics.policy_sales;
SELECT sum(written_premium_cents) FILTER (WHERE sale_status = 'BOUND' AND NOT is_test) / 100.0 AS written_premium_usd FROM marketing_analytics.policy_sales;
SELECT round(sum(policy_count) FILTER (WHERE sale_status = 'NTU' AND NOT is_test) * 1.0 / NULLIF(sum(policy_count) FILTER (WHERE sale_status IN ('BOUND', 'NTU') AND NOT is_test), 0), 4) AS walk_away_rate FROM marketing_analytics.policy_sales;
SELECT sum(earned_premium_cents + fee_income_cents) / 100.0 AS revenue_usd FROM marketing_analytics.revenue_by_period;
