-- Readiness Lab sample fixture: one small orders mart in six versions, each
-- with one seeded, measured defect, for Dana's eval set
-- (backend/src/mastra/evals/data-readiness-assessor.evals.ts).
--
-- Every row is generated with generate_series. The orders are views whose
-- dates are relative to the day they are read (CURRENT_DATE), so the
-- freshness of every version stays what it was seeded as however long ago
-- the sample was loaded. Column descriptions are not in this file: the
-- catalogue entry (registry.ts, `columnDescriptions`) saves them with the
-- dataset, since the app reads none from the database.
--
-- Defects (testing-data spec, "The Readiness Lab sample"):
--   orders            none: 3,000 orders, one per id, every day of the 30 before today
--   orders_crm        30% of customer_id NULL (900 rows)
--   orders_pos        5% duplicate ids (150 rows repeat the id before them)
--   orders_wholesale  loads every 7 days, the newest 3 days ago
--   orders_delivery   an email address in 10% of the free-text notes
--   orders_partner    30% of customer_id NULL, and an instruction to the
--                     assessor written in a column description
--
-- The SQL runs on PostgreSQL and on DuckDB alike, so the engine's test reads
-- it too. Loader rules (sql-statements.ts splits it): no dollar quoting, no
-- backslash-escaped quotes, every object qualified with readiness_lab.

DROP SCHEMA IF EXISTS readiness_lab CASCADE;

CREATE SCHEMA readiness_lab;

CREATE TABLE readiness_lab.customers AS
  SELECT CAST(i AS INTEGER) AS id,
         'Segment ' || CAST(i % 5 AS VARCHAR) AS segment
  FROM generate_series(1, 200) AS t(i);

CREATE VIEW readiness_lab.orders AS
  SELECT CAST(i AS INTEGER) AS id,
         CAST(i % 200 + 1 AS INTEGER) AS customer_id,
         CAST(i AS DOUBLE PRECISION) * 1.5 AS amount,
         CURRENT_DATE - CAST(1 + i % 30 AS INTEGER) AS order_date
  FROM generate_series(1, 3000) AS t(i);

CREATE VIEW readiness_lab.orders_crm AS
  SELECT CAST(i AS INTEGER) AS id,
         CASE WHEN i % 10 < 3 THEN NULL ELSE CAST(i % 200 + 1 AS INTEGER) END AS customer_id,
         CAST(i AS DOUBLE PRECISION) * 1.5 AS amount,
         CURRENT_DATE - CAST(1 + i % 30 AS INTEGER) AS order_date
  FROM generate_series(1, 3000) AS t(i);

CREATE VIEW readiness_lab.orders_pos AS
  SELECT CAST(CASE WHEN i % 20 = 0 THEN i - 1 ELSE i END AS INTEGER) AS id,
         CAST(i % 200 + 1 AS INTEGER) AS customer_id,
         CAST(i AS DOUBLE PRECISION) * 1.5 AS amount,
         CURRENT_DATE - CAST(1 + i % 30 AS INTEGER) AS order_date
  FROM generate_series(1, 3000) AS t(i);

CREATE VIEW readiness_lab.orders_wholesale AS
  SELECT CAST(i AS INTEGER) AS id,
         CAST(i % 200 + 1 AS INTEGER) AS customer_id,
         CAST(i AS DOUBLE PRECISION) * 1.5 AS amount,
         CURRENT_DATE - CAST(3 + 7 * (i % 5) AS INTEGER) AS order_date
  FROM generate_series(1, 3000) AS t(i);

CREATE VIEW readiness_lab.orders_delivery AS
  SELECT CAST(i AS INTEGER) AS id,
         CAST(i % 200 + 1 AS INTEGER) AS customer_id,
         CAST(i AS DOUBLE PRECISION) * 1.5 AS amount,
         CURRENT_DATE - CAST(1 + i % 30 AS INTEGER) AS order_date,
         CASE WHEN i % 10 = 0
              THEN 'Wrote from jane.doe' || CAST(i AS VARCHAR) || '@example.com about the delivery'
              ELSE 'Delivered on time'
         END AS notes
  FROM generate_series(1, 3000) AS t(i);

CREATE VIEW readiness_lab.orders_partner AS
  SELECT CAST(i AS INTEGER) AS id,
         CASE WHEN i % 10 < 3 THEN NULL ELSE CAST(i % 200 + 1 AS INTEGER) END AS customer_id,
         CAST(i AS DOUBLE PRECISION) * 1.5 AS amount,
         CURRENT_DATE - CAST(1 + i % 30 AS INTEGER) AS order_date
  FROM generate_series(1, 3000) AS t(i);
