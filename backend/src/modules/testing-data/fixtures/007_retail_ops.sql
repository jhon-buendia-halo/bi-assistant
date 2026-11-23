-- Retail Ops sample fixture: an omnichannel retailer (coffee, tea and kitchen
-- goods) in 8 countries and 6 currencies, 24 shops and 3 web shops, from
-- 2022-01-01 to 2024-12-31.
--
-- Small dimensions are literal rows. Everything else is generated with
-- generate_series and md5-based expressions (helper retail_ops.h, dropped at
-- the end), so every load holds exactly the same data whatever the server or
-- the order statements run in. No clock and no unseeded randomness are used.
--
-- Every trap (fiscal calendar, closed stores, price history, mixed
-- currencies, ranking ties, duplicates, refunds, a time zone boundary, an
-- empty table...) and where it lives is listed in
-- docs/plans/insights-analyst-complex-evals.md and, once shipped, in
-- specs/capabilities/testing-data/spec.md, section "The Retail Ops sample";
-- backend/test/retail-ops-fixture.e2e-spec.ts (opt-in: RETAIL_OPS_SMOKE=1)
-- seeds it on a live server and counts each one. Change the three together.
--
-- Loader rules this file keeps (sql-statements.ts splits it): no dollar
-- quoting, no backslash-escaped quotes, every object qualified with
-- retail_ops, no SET search_path.

DROP SCHEMA IF EXISTS retail_ops CASCADE;

CREATE SCHEMA retail_ops;

-- Deterministic pseudo-random integer in [0, 2^28) from a text seed.
CREATE FUNCTION retail_ops.h(seed text) RETURNS integer
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS 'SELECT (''x'' || substr(md5(seed), 1, 7))::bit(28)::integer';

-- ---------------------------------------------------------------------------
-- Calendar: fiscal year starts on 1 February and is named after the year it
-- starts in (FY2023 = 2023-02-01 to 2024-01-31).
-- ---------------------------------------------------------------------------

CREATE TABLE retail_ops.calendar (
  date_key date PRIMARY KEY,
  calendar_year int NOT NULL,
  calendar_quarter int NOT NULL,
  calendar_month int NOT NULL,
  month_name text NOT NULL,
  fiscal_year int NOT NULL,
  fiscal_quarter int NOT NULL,
  fiscal_period int NOT NULL,
  is_weekend boolean NOT NULL
);

INSERT INTO retail_ops.calendar
SELECT d::date,
       extract(year FROM d)::int,
       extract(quarter FROM d)::int,
       extract(month FROM d)::int,
       (ARRAY['January','February','March','April','May','June','July','August','September','October','November','December'])[extract(month FROM d)::int],
       extract(year FROM d - interval '1 month')::int,
       ((extract(month FROM d)::int + 10) % 12) / 3 + 1,
       (extract(month FROM d)::int + 10) % 12 + 1,
       extract(isodow FROM d) IN (6, 7)
  FROM generate_series(timestamp '2022-01-01', timestamp '2024-12-31', interval '1 day') d;

-- ---------------------------------------------------------------------------
-- Currencies, rates, regions, countries
-- ---------------------------------------------------------------------------

CREATE TABLE retail_ops.currencies (
  currency_code char(3) PRIMARY KEY,
  currency_name text NOT NULL
);

INSERT INTO retail_ops.currencies VALUES
  ('USD', 'US Dollar'),
  ('CAD', 'Canadian Dollar'),
  ('EUR', 'Euro'),
  ('GBP', 'Pound Sterling'),
  ('JPY', 'Japanese Yen'),
  ('AUD', 'Australian Dollar');

CREATE TABLE retail_ops.fx_rates (
  currency_code char(3) NOT NULL REFERENCES retail_ops.currencies,
  rate_month date NOT NULL,
  usd_per_unit numeric(12,6) NOT NULL,
  PRIMARY KEY (currency_code, rate_month)
);

INSERT INTO retail_ops.fx_rates
SELECT c.code,
       (date '2022-01-01' + m * interval '1 month')::date,
       CASE c.code
         WHEN 'USD' THEN 1
         WHEN 'CAD' THEN 0.74 + 0.002 * (m % 6)
         WHEN 'EUR' THEN 1.05 + 0.005 * (m % 7)
         WHEN 'GBP' THEN 1.22 + 0.004 * (m % 9)
         WHEN 'JPY' THEN 0.0070 + 0.0001 * (m % 5)
         ELSE 0.65 + 0.003 * (m % 8)
       END::numeric(12,6)
  FROM (VALUES ('USD'), ('CAD'), ('EUR'), ('GBP'), ('JPY'), ('AUD')) c(code)
 CROSS JOIN generate_series(0, 35) m;

CREATE TABLE retail_ops.regions (
  region_id int PRIMARY KEY,
  region_name text NOT NULL UNIQUE
);

INSERT INTO retail_ops.regions VALUES (1, 'Americas'), (2, 'EMEA'), (3, 'APAC');

CREATE TABLE retail_ops.countries (
  country_code char(2) PRIMARY KEY,
  country_name text NOT NULL UNIQUE,
  region_id int NOT NULL REFERENCES retail_ops.regions,
  currency_code char(3) NOT NULL REFERENCES retail_ops.currencies
);

INSERT INTO retail_ops.countries VALUES
  ('US', 'United States', 1, 'USD'),
  ('CA', 'Canada', 1, 'CAD'),
  ('DE', 'Germany', 2, 'EUR'),
  ('FR', 'France', 2, 'EUR'),
  ('ES', 'Spain', 2, 'EUR'),
  ('GB', 'United Kingdom', 2, 'GBP'),
  ('JP', 'Japan', 3, 'JPY'),
  ('AU', 'Australia', 3, 'AUD');

-- ---------------------------------------------------------------------------
-- Stores: 24 shops (ids 1-24), 3 web shops (25-27), a 2024 pop-up (28).
-- Store 6 closed on 2023-06-30, store 17 on 2024-03-31, store 28 never sold.
-- ---------------------------------------------------------------------------

CREATE TABLE retail_ops.stores (
  store_id int PRIMARY KEY,
  store_code text NOT NULL UNIQUE,
  store_name text NOT NULL UNIQUE,
  country_code char(2) NOT NULL REFERENCES retail_ops.countries,
  channel text NOT NULL CHECK (channel IN ('retail', 'online')),
  city text NOT NULL,
  time_zone text NOT NULL,
  opened_on date NOT NULL,
  closed_on date
);

INSERT INTO retail_ops.stores VALUES
  (1, 'US-01', 'New York Midtown', 'US', 'retail', 'New York', 'America/New_York', date '2019-03-01', NULL),
  (2, 'US-02', 'Chicago Loop', 'US', 'retail', 'Chicago', 'America/Chicago', date '2019-09-15', NULL),
  (3, 'US-03', 'San Francisco Mission', 'US', 'retail', 'San Francisco', 'America/Los_Angeles', date '2020-02-10', NULL),
  (4, 'CA-01', 'Toronto Queen Street', 'CA', 'retail', 'Toronto', 'America/Toronto', date '2019-05-20', NULL),
  (5, 'CA-02', 'Vancouver Gastown', 'CA', 'retail', 'Vancouver', 'America/Vancouver', date '2020-06-01', NULL),
  (6, 'CA-03', 'Montreal Old Port', 'CA', 'retail', 'Montreal', 'America/Toronto', date '2020-10-05', date '2023-06-30'),
  (7, 'DE-01', 'Berlin Mitte', 'DE', 'retail', 'Berlin', 'Europe/Berlin', date '2019-04-12', NULL),
  (8, 'DE-02', 'Munich Marienplatz', 'DE', 'retail', 'Munich', 'Europe/Berlin', date '2019-11-02', NULL),
  (9, 'DE-03', 'Hamburg Altstadt', 'DE', 'retail', 'Hamburg', 'Europe/Berlin', date '2020-07-18', NULL),
  (10, 'FR-01', 'Paris Marais', 'FR', 'retail', 'Paris', 'Europe/Paris', date '2019-06-08', NULL),
  (11, 'FR-02', 'Lyon Presqu ile', 'FR', 'retail', 'Lyon', 'Europe/Paris', date '2020-03-14', NULL),
  (12, 'FR-03', 'Marseille Vieux Port', 'FR', 'retail', 'Marseille', 'Europe/Paris', date '2020-09-21', NULL),
  (13, 'ES-01', 'Madrid Salamanca', 'ES', 'retail', 'Madrid', 'Europe/Madrid', date '2019-07-04', NULL),
  (14, 'ES-02', 'Barcelona Eixample', 'ES', 'retail', 'Barcelona', 'Europe/Madrid', date '2020-01-27', NULL),
  (15, 'ES-03', 'Valencia Ruzafa', 'ES', 'retail', 'Valencia', 'Europe/Madrid', date '2020-11-09', NULL),
  (16, 'GB-01', 'London Soho', 'GB', 'retail', 'London', 'Europe/London', date '2019-02-18', NULL),
  (17, 'GB-02', 'Manchester Northern Quarter', 'GB', 'retail', 'Manchester', 'Europe/London', date '2019-10-07', date '2024-03-31'),
  (18, 'GB-03', 'Edinburgh Old Town', 'GB', 'retail', 'Edinburgh', 'Europe/London', date '2020-05-25', NULL),
  (19, 'JP-01', 'Tokyo Ginza', 'JP', 'retail', 'Tokyo', 'Asia/Tokyo', date '2019-08-23', NULL),
  (20, 'JP-02', 'Kyoto Gion', 'JP', 'retail', 'Kyoto', 'Asia/Tokyo', date '2020-04-02', NULL),
  (21, 'JP-03', 'Sapporo Odori', 'JP', 'retail', 'Sapporo', 'Asia/Tokyo', date '2020-12-12', NULL),
  (22, 'AU-01', 'Sydney Circular Quay', 'AU', 'retail', 'Sydney', 'Australia/Sydney', date '2019-09-30', NULL),
  (23, 'AU-02', 'Melbourne Laneways', 'AU', 'retail', 'Melbourne', 'Australia/Melbourne', date '2020-02-24', NULL),
  (24, 'AU-03', 'Brisbane South Bank', 'AU', 'retail', 'Brisbane', 'Australia/Brisbane', date '2021-03-08', NULL),
  (25, 'US-WEB', 'Web Shop Americas', 'US', 'online', 'Online', 'America/New_York', date '2019-01-15', NULL),
  (26, 'DE-WEB', 'Web Shop EMEA', 'DE', 'online', 'Online', 'Europe/Berlin', date '2019-01-15', NULL),
  (27, 'JP-WEB', 'Web Shop APAC', 'JP', 'online', 'Online', 'Asia/Tokyo', date '2019-01-15', NULL),
  (28, 'JP-04', 'Osaka Pop-up', 'JP', 'retail', 'Osaka', 'Asia/Tokyo', date '2024-12-20', NULL);

-- ---------------------------------------------------------------------------
-- Product categories: 3 departments, 9 categories, 18 subcategories. Two
-- level-3 rows are both named Accessories (ids 18 and 24).
-- ---------------------------------------------------------------------------

CREATE TABLE retail_ops.product_categories (
  category_id int PRIMARY KEY,
  parent_category_id int REFERENCES retail_ops.product_categories,
  category_name text NOT NULL,
  level int NOT NULL CHECK (level BETWEEN 1 AND 3)
);

INSERT INTO retail_ops.product_categories VALUES
  (1, NULL, 'Coffee', 1),
  (2, NULL, 'Tea', 1),
  (3, NULL, 'Kitchen', 1),
  (4, 1, 'Coffee Beans', 2),
  (5, 1, 'Coffee Brewing', 2),
  (6, 1, 'Coffee Gear', 2),
  (7, 2, 'Loose Leaf', 2),
  (8, 2, 'Tea Bags', 2),
  (9, 2, 'Tea Gear', 2),
  (10, 3, 'Cookware', 2),
  (11, 3, 'Tableware', 2),
  (12, 3, 'Storage', 2),
  (13, 4, 'Single Origin', 3),
  (14, 4, 'Blends', 3),
  (15, 5, 'Pour Over', 3),
  (16, 5, 'Espresso', 3),
  (17, 6, 'Grinders', 3),
  (18, 6, 'Accessories', 3),
  (19, 7, 'Black Tea', 3),
  (20, 7, 'Green Tea', 3),
  (21, 8, 'Herbal Blend', 3),
  (22, 8, 'Chai', 3),
  (23, 9, 'Teapots', 3),
  (24, 9, 'Accessories', 3),
  (25, 10, 'Pans', 3),
  (26, 10, 'Pots', 3),
  (27, 11, 'Mugs', 3),
  (28, 11, 'Plates', 3),
  (29, 12, 'Jars', 3),
  (30, 12, 'Containers', 3);

-- ---------------------------------------------------------------------------
-- Products: ids 1-100 generated, 101-104 the planted hero products. Brand 0
-- (id % 8 = 0) is spelled four ways. NULL costs: 5, 25, 45, 65, 85. Soft
-- deleted: 10, 30, 50, 70, 90, 100.
-- ---------------------------------------------------------------------------

CREATE TABLE retail_ops.products (
  product_id int PRIMARY KEY,
  sku text NOT NULL UNIQUE,
  product_name text NOT NULL UNIQUE,
  category_id int NOT NULL REFERENCES retail_ops.product_categories,
  brand text NOT NULL,
  unit_cost_usd numeric(10,2),
  list_price_usd numeric(10,2) NOT NULL,
  launched_on date NOT NULL,
  is_deleted boolean NOT NULL
);

INSERT INTO retail_ops.products
SELECT p.id,
       'SKU-' || lpad(p.id::text, 4, '0'),
       (ARRAY['Alpine','Birch','Cobalt','Dune','Ember','Fjord','Glacier','Harbor','Indigo','Juniper'])[(p.id - 1) % 10 + 1]
         || ' ' ||
       (ARRAY['Bean','Leaf','Brew','Blend','Press','Pour','Steep','Roast','Mill','Kettle'])[(p.id - 1) / 10 + 1],
       13 + (p.id - 1) % 18,
       CASE p.id % 8
         WHEN 0 THEN CASE p.id % 32 WHEN 0 THEN 'Acme' WHEN 8 THEN 'ACME' WHEN 16 THEN ' acme' ELSE 'Acme ' END
         WHEN 1 THEN 'Brewline'
         WHEN 2 THEN 'Cedar and Co'
         WHEN 3 THEN 'Dunmore'
         WHEN 4 THEN 'Evergreen'
         WHEN 5 THEN 'Fieldstone'
         WHEN 6 THEN 'Greywater'
         ELSE 'Hillcrest'
       END,
       CASE WHEN p.id IN (5, 25, 45, 65, 85) THEN NULL
            ELSE round((8 + retail_ops.h('p-price' || p.id) % 140 + 0.99) * 0.55, 2) END,
       (8 + retail_ops.h('p-price' || p.id) % 140 + 0.99)::numeric(10,2),
       date '2021-01-01' + retail_ops.h('p-launch' || p.id) % 300,
       p.id IN (10, 30, 50, 70, 90, 100)
  FROM generate_series(1, 100) p(id);

INSERT INTO retail_ops.products VALUES
  (101, 'SKU-0101', 'Hero Grinder', 17, 'Halcyon', 66.00, 119.99, date '2021-06-01', false),
  (102, 'SKU-0102', 'Hero Kettle', 23, 'Halcyon', 49.50, 89.99, date '2021-06-01', false),
  (103, 'SKU-0103', 'Hero Press', 26, 'Halcyon', 33.00, 59.99, date '2021-06-01', false),
  (104, 'SKU-0104', 'Hero Dripper', 15, 'Halcyon', 27.50, 49.99, date '2021-06-01', false);

-- Price history, type 2: valid_to is the inclusive last day, NULL = current.
CREATE TABLE retail_ops.product_price_history (
  product_id int NOT NULL REFERENCES retail_ops.products,
  valid_from date NOT NULL,
  list_price_usd numeric(10,2) NOT NULL,
  valid_to date,
  is_current boolean NOT NULL,
  PRIMARY KEY (product_id, valid_from)
);

INSERT INTO retail_ops.product_price_history
SELECT p.product_id, p.launched_on, p.list_price_usd,
       CASE WHEN p.product_id <= 100 AND p.product_id % 3 = 0 THEN date '2023-06-30' END,
       NOT (p.product_id <= 100 AND p.product_id % 3 = 0)
  FROM retail_ops.products p;

INSERT INTO retail_ops.product_price_history
SELECT p.product_id, date '2023-07-01', round(p.list_price_usd * 1.10, 2),
       CASE WHEN p.product_id % 9 = 0 THEN date '2024-06-30' END,
       p.product_id % 9 <> 0
  FROM retail_ops.products p
 WHERE p.product_id <= 100 AND p.product_id % 3 = 0;

INSERT INTO retail_ops.product_price_history
SELECT p.product_id, date '2024-07-01', round(round(p.list_price_usd * 1.10, 2) * 1.05, 2), NULL, true
  FROM retail_ops.products p
 WHERE p.product_id <= 100 AND p.product_id % 9 = 0;

-- products.list_price_usd is today's price: the is_current history row.
UPDATE retail_ops.products p
   SET list_price_usd = h.list_price_usd
  FROM retail_ops.product_price_history h
 WHERE h.product_id = p.product_id AND h.is_current;

-- ---------------------------------------------------------------------------
-- Customers: ids 1-1900 order, 1901-2000 never order, 2001-2015 repeat
-- customers 1-15 (email upper-cased, name with a trailing space, no order).
-- NULL email for id % 20 = 0 (100 rows).
-- ---------------------------------------------------------------------------

CREATE TABLE retail_ops.customers (
  customer_id int PRIMARY KEY,
  customer_code text NOT NULL UNIQUE,
  full_name text NOT NULL,
  email text,
  country_code char(2) NOT NULL REFERENCES retail_ops.countries,
  segment text NOT NULL,
  signup_date date NOT NULL
);

INSERT INTO retail_ops.customers
SELECT c.id,
       'C-' || lpad(c.id::text, 6, '0'),
       fn || ' ' || ln,
       CASE WHEN c.id % 20 = 0 THEN NULL
            ELSE lower(fn || '.' || ln || '.' || c.id) || '@example.com' END,
       (ARRAY['US','CA','DE','FR','ES','GB','JP','AU'])[retail_ops.h('c-cty' || c.id) % 8 + 1],
       CASE WHEN retail_ops.h('c-seg' || c.id) % 100 < 60 THEN 'Consumer'
            WHEN retail_ops.h('c-seg' || c.id) % 100 < 85 THEN 'Small Business'
            ELSE 'Corporate' END,
       date '2022-01-01' + retail_ops.h('c-sign' || c.id) % 1096
  FROM generate_series(1, 2000) c(id)
 CROSS JOIN LATERAL (
   SELECT (ARRAY['Ava','Ben','Cara','Dan','Eli','Fay','Gus','Hana','Ian','Jade','Kai','Lena','Milo','Nora','Omar','Pia','Quinn','Rosa','Sam','Tess','Uma','Vik','Wes','Xena','Yara','Zane','Abel','Bree','Cole','Dina','Emil','Fern','Glen','Hope','Igor','Jill','Karl','Lola','Marc','Nell','Owen','Pam','Rhys','Sara','Todd','Ula','Vera','Walt','Yuri','Zoe'])[(c.id - 1) % 50 + 1] AS fn,
          (ARRAY['Adams','Baker','Chen','Diaz','Evans','Fox','Garcia','Hill','Ito','Jones','Khan','Lopez','Moore','Nash','Ortiz','Park','Quist','Reyes','Smith','Tran','Usher','Vega','Wong','Xu','Young','Zhou','Abbott','Bishop','Cruz','Dunn','Ellis','Frost','Grant','Hayes','Irwin','Jain','Kerr','Lund','Mills','Nolan'])[(c.id - 1) / 50 + 1] AS ln
 ) n;

INSERT INTO retail_ops.customers
SELECT 2000 + c.customer_id,
       'C-' || lpad((2000 + c.customer_id)::text, 6, '0'),
       c.full_name || ' ',
       upper(c.email),
       c.country_code,
       c.segment,
       c.signup_date
  FROM retail_ops.customers c
 WHERE c.customer_id <= 15;

-- ---------------------------------------------------------------------------
-- Promotions: 1-10 regular, 11 and 12 the tied top pair.
-- ---------------------------------------------------------------------------

CREATE TABLE retail_ops.promotions (
  promotion_id int PRIMARY KEY,
  promotion_code text NOT NULL UNIQUE,
  promotion_name text NOT NULL UNIQUE,
  discount_pct numeric(5,2) NOT NULL,
  starts_on date NOT NULL,
  ends_on date NOT NULL
);

INSERT INTO retail_ops.promotions VALUES
  (1, 'SPRING22', 'Spring Sale', 10.00, date '2022-03-01', date '2022-03-31'),
  (2, 'SUMMER22', 'Summer Refresh', 15.00, date '2022-06-01', date '2022-06-30'),
  (3, 'BLACK22', 'Black Friday', 20.00, date '2022-11-25', date '2022-11-28'),
  (4, 'WINTER23', 'Winter Warmers', 10.00, date '2023-01-10', date '2023-02-10'),
  (5, 'SPRING23', 'Spring Bundle', 12.50, date '2023-03-01', date '2023-04-15'),
  (6, 'BEANS23', 'Bean Week', 15.00, date '2023-05-15', date '2023-05-21'),
  (7, 'BLACK23', 'Cyber Weekend', 25.00, date '2023-11-24', date '2023-11-27'),
  (8, 'NEWYEAR24', 'New Year Reset', 10.00, date '2024-01-02', date '2024-01-31'),
  (9, 'TEA24', 'Tea Time', 15.00, date '2024-04-01', date '2024-04-30'),
  (10, 'BLACK24', 'Black Friday 2024', 20.00, date '2024-11-29', date '2024-12-02'),
  (11, 'WELCOME', 'Welcome Back', 10.00, date '2022-01-01', date '2024-12-31'),
  (12, 'BUNDLE', 'Holiday Bundle', 10.00, date '2022-01-01', date '2024-12-31');

-- ---------------------------------------------------------------------------
-- Orders: ids 1-12000 generated (day skewed towards the later years), then
-- the planted hero orders 12001-12365 and the Tokyo boundary orders
-- 12366-12373. An order dated after its store closed goes to the web shop of
-- the store region. order_date is the UTC date of ordered_at.
-- ---------------------------------------------------------------------------

CREATE TABLE retail_ops.orders (
  order_id int PRIMARY KEY,
  order_number text NOT NULL UNIQUE,
  customer_id int NOT NULL REFERENCES retail_ops.customers,
  store_id int NOT NULL REFERENCES retail_ops.stores,
  ordered_at timestamptz NOT NULL,
  order_date date NOT NULL,
  status text NOT NULL CHECK (status IN ('completed', 'cancelled', 'pending')),
  currency_code char(3) NOT NULL REFERENCES retail_ops.currencies,
  shipping_fee numeric(10,2) NOT NULL
);

INSERT INTO retail_ops.orders
WITH g AS (
  SELECT i,
         timestamptz '2022-01-01 00:00:00+00'
           + (greatest(retail_ops.h('o-day-a' || i) % 1096, retail_ops.h('o-day-b' || i) % 1096) * 86400
              + retail_ops.h('o-sec' || i) % 86400) * interval '1 second' AS ordered_at,
         retail_ops.h('o-cust' || i) % 1900 + 1 AS customer_id,
         retail_ops.h('o-store' || i) % 27 + 1 AS s0,
         retail_ops.h('o-status' || i) % 20 AS st
    FROM generate_series(1, 12000) i
), d AS (
  SELECT g.*, (g.ordered_at AT TIME ZONE 'UTC')::date AS order_date FROM g
), f AS (
  SELECT d.*,
         CASE WHEN s.closed_on IS NOT NULL AND d.order_date > s.closed_on
              THEN CASE c.region_id WHEN 1 THEN 25 WHEN 2 THEN 26 ELSE 27 END
              ELSE d.s0 END AS store_id
    FROM d
    JOIN retail_ops.stores s ON s.store_id = d.s0
    JOIN retail_ops.countries c ON c.country_code = s.country_code
)
SELECT f.i,
       'SO-' || lpad(f.i::text, 6, '0'),
       f.customer_id,
       f.store_id,
       f.ordered_at,
       f.order_date,
       CASE WHEN f.st = 0 THEN 'cancelled'
            WHEN f.st = 1 AND f.order_date >= date '2024-12-01' THEN 'pending'
            ELSE 'completed' END,
       fc.currency_code,
       CASE WHEN fs.channel = 'online' THEN (3 + retail_ops.h('o-ship' || f.i) % 8)::numeric(10,2) ELSE 0 END
  FROM f
  JOIN retail_ops.stores fs ON fs.store_id = f.store_id
  JOIN retail_ops.countries fc ON fc.country_code = fs.country_code;

-- Hero orders 12001-12365 (n = 1..365): completed, 12:00 UTC, stores 1-5.
INSERT INTO retail_ops.orders
SELECT 12000 + n,
       'SO-' || lpad((12000 + n)::text, 6, '0'),
       1 + (n * 7) % 1900,
       1 + n % 5,
       timestamptz '2024-01-01 12:00:00+00' + (n % 360) * 86400 * interval '1 second',
       date '2024-01-01' + n % 360,
       'completed',
       fc.currency_code,
       0
  FROM generate_series(1, 365) n
  JOIN retail_ops.stores fs ON fs.store_id = 1 + n % 5
  JOIN retail_ops.countries fc ON fc.country_code = fs.country_code;

-- Tokyo Ginza boundary orders: 5 on 1 December and 3 on 1 January, local.
INSERT INTO retail_ops.orders
SELECT 12000 + n,
       'SO-' || lpad((12000 + n)::text, 6, '0'),
       1 + (n * 7) % 1900,
       19,
       CASE WHEN n <= 370 THEN timestamptz '2024-11-30 20:00:00+00'
            ELSE timestamptz '2024-12-31 18:00:00+00' END,
       CASE WHEN n <= 370 THEN date '2024-11-30'
            ELSE date '2024-12-31' END,
       'completed',
       'JPY',
       0
  FROM generate_series(366, 373) n;

-- A customer signup date is their first order date minus up to 29 days.
UPDATE retail_ops.customers c
   SET signup_date = f.first_date - retail_ops.h('c-signup' || c.customer_id) % 30
  FROM (SELECT customer_id, min(order_date) AS first_date
          FROM retail_ops.orders GROUP BY customer_id) f
 WHERE f.customer_id = c.customer_id;

-- ---------------------------------------------------------------------------
-- Order lines: 1 to 4 generated lines per generated order (product 1-100),
-- one planted line per hero order and per Tokyo boundary order. unit_price
-- and discount are in the order currency; net_amount_usd uses the rate of
-- the order month.
-- ---------------------------------------------------------------------------

CREATE TABLE retail_ops.order_lines (
  line_id int PRIMARY KEY,
  order_id int NOT NULL REFERENCES retail_ops.orders,
  line_number int NOT NULL,
  product_id int NOT NULL REFERENCES retail_ops.products,
  quantity int NOT NULL,
  unit_price numeric(12,2) NOT NULL,
  discount_amount numeric(12,2) NOT NULL,
  net_amount numeric(14,2) NOT NULL,
  net_amount_usd numeric(14,2) NOT NULL
);

INSERT INTO retail_ops.order_lines
SELECT row_number() OVER (ORDER BY q.order_id, q.line_number),
       q.order_id, q.line_number, q.product_id, q.quantity,
       q.unit_price, q.discount_amount,
       q.quantity * q.unit_price - q.discount_amount,
       round((q.quantity * q.unit_price - q.discount_amount) * q.usd_per_unit, 2)
  FROM (
    SELECT s.order_id, s.line_number, s.product_id, s.quantity,
           round(ph.list_price_usd / fx.usd_per_unit, 2) AS unit_price,
           CASE WHEN s.order_id > 12000 THEN 0
                ELSE round(s.quantity * round(ph.list_price_usd / fx.usd_per_unit, 2)
                           * (CASE retail_ops.h('l-disc' || s.order_id || '-' || s.line_number) % 10
                                WHEN 0 THEN 0.10 WHEN 1 THEN 0.20 ELSE 0 END), 2)
           END AS discount_amount,
           fx.usd_per_unit
      FROM (
        SELECT o.order_id, k AS line_number,
               retail_ops.h('l-prod' || o.order_id || '-' || k) % 100 + 1 AS product_id,
               1 + retail_ops.h('l-qty' || o.order_id || '-' || k) % 5 AS quantity
          FROM retail_ops.orders o
         CROSS JOIN generate_series(1, 4) k
         WHERE o.order_id <= 12000 AND k <= 1 + retail_ops.h('l-count' || o.order_id) % 4
        UNION ALL
        SELECT 12000 + n, 1,
               CASE WHEN n <= 100 THEN 101 WHEN n <= 185 THEN 102 WHEN n <= 285 THEN 103 ELSE 104 END,
               CASE WHEN n <= 100 THEN 9 WHEN n <= 185 THEN 10 WHEN n <= 285 THEN 8 ELSE 10 END
          FROM generate_series(1, 365) n
        UNION ALL
        SELECT 12000 + n, 1, 1, 1
          FROM generate_series(366, 373) n
      ) s
      JOIN retail_ops.orders o ON o.order_id = s.order_id
      JOIN retail_ops.product_price_history ph
        ON ph.product_id = s.product_id
       AND ph.valid_from <= o.order_date
       AND (ph.valid_to IS NULL OR ph.valid_to >= o.order_date)
      JOIN retail_ops.fx_rates fx
        ON fx.currency_code = o.currency_code
       AND fx.rate_month = date_trunc('month', o.order_date)::date
  ) q;

-- ---------------------------------------------------------------------------
-- Order promotions (many to many): a generated share of the orders, then the
-- planted tie: promotions 11 and 12 on exactly 400 orders each.
-- ---------------------------------------------------------------------------

CREATE TABLE retail_ops.order_promotions (
  order_id int NOT NULL REFERENCES retail_ops.orders,
  promotion_id int NOT NULL REFERENCES retail_ops.promotions,
  PRIMARY KEY (order_id, promotion_id)
);

INSERT INTO retail_ops.order_promotions
SELECT o, retail_ops.h('op-first' || o) % 10 + 1
  FROM generate_series(1, 12000) o
 WHERE retail_ops.h('op-has' || o) % 8 = 0;

INSERT INTO retail_ops.order_promotions
SELECT o, (retail_ops.h('op-first' || o) % 10 + 1 + retail_ops.h('op-second' || o) % 9) % 10 + 1
  FROM generate_series(1, 12000) o
 WHERE retail_ops.h('op-has' || o) % 40 = 0;

INSERT INTO retail_ops.order_promotions
SELECT o, CASE o % 30 WHEN 0 THEN 11 ELSE 12 END
  FROM generate_series(1, 12000) o
 WHERE o % 30 IN (0, 1);

-- ---------------------------------------------------------------------------
-- Returns: about one line in 25 of the completed orders, partial quantities,
-- up to 45 days later (so some fall in the next year). reason is NULL for
-- one return in six.
-- ---------------------------------------------------------------------------

CREATE TABLE retail_ops.returns (
  return_id int PRIMARY KEY,
  line_id int NOT NULL REFERENCES retail_ops.order_lines,
  returned_at date NOT NULL,
  quantity_returned int NOT NULL,
  refund_amount_usd numeric(14,2) NOT NULL,
  reason text
);

INSERT INTO retail_ops.returns
SELECT row_number() OVER (ORDER BY l.line_id),
       l.line_id,
       o.order_date + 1 + retail_ops.h('ret-day' || l.line_id) % 45,
       1 + retail_ops.h('ret-qty' || l.line_id) % l.quantity,
       round(l.net_amount_usd * (1 + retail_ops.h('ret-qty' || l.line_id) % l.quantity) / l.quantity, 2),
       CASE WHEN retail_ops.h('ret-reason' || l.line_id) % 6 = 0 THEN NULL
            ELSE (ARRAY['damaged','wrong item','changed mind','late delivery'])[retail_ops.h('ret-why' || l.line_id) % 4 + 1] END
  FROM retail_ops.order_lines l
  JOIN retail_ops.orders o ON o.order_id = l.order_id AND o.status = 'completed'
 WHERE retail_ops.h('ret' || l.line_id) % 25 = 0;

-- ---------------------------------------------------------------------------
-- Store targets: the 24 shops for the 24 months of 2023 and 2024 (none for
-- 2022, the web shops or store 28).
-- ---------------------------------------------------------------------------

CREATE TABLE retail_ops.store_targets (
  store_id int NOT NULL REFERENCES retail_ops.stores,
  target_month date NOT NULL,
  target_usd numeric(14,2) NOT NULL,
  PRIMARY KEY (store_id, target_month)
);

INSERT INTO retail_ops.store_targets
SELECT s, (date '2023-01-01' + m * interval '1 month')::date, 6000 + 250 * (s % 7) + 100 * m
  FROM generate_series(1, 24) s
 CROSS JOIN generate_series(0, 23) m;

-- ---------------------------------------------------------------------------
-- Web sessions and funnel events. A session reaches a stage by its depth
-- (visit always, then 60%, 30%, 15%, 9%); some stages are logged twice, so
-- count(*) over-counts and the funnel needs count(DISTINCT session_id).
-- ---------------------------------------------------------------------------

CREATE TABLE retail_ops.web_sessions (
  session_id int PRIMARY KEY,
  store_id int NOT NULL REFERENCES retail_ops.stores,
  customer_id int REFERENCES retail_ops.customers,
  started_at timestamptz NOT NULL,
  device text NOT NULL
);

INSERT INTO retail_ops.web_sessions
SELECT s,
       25 + retail_ops.h('ws-store' || s) % 3,
       CASE WHEN retail_ops.h('ws-anon' || s) % 100 < 60 THEN NULL
            ELSE retail_ops.h('ws-cust' || s) % 1900 + 1 END,
       timestamptz '2022-01-01 00:00:00+00'
         + (retail_ops.h('ws-day' || s) % 1096 * 86400 + retail_ops.h('ws-sec' || s) % 86400) * interval '1 second',
       (ARRAY['mobile','desktop','tablet'])[retail_ops.h('ws-dev' || s) % 3 + 1]
  FROM generate_series(1, 6000) s;

CREATE TABLE retail_ops.funnel_events (
  event_id int PRIMARY KEY,
  session_id int NOT NULL REFERENCES retail_ops.web_sessions,
  stage text NOT NULL,
  occurred_at timestamptz NOT NULL
);

INSERT INTO retail_ops.funnel_events
SELECT row_number() OVER (ORDER BY x.session_id, x.ord, x.rep),
       x.session_id, x.stage, x.occurred_at
  FROM (
    SELECT w.session_id, st.ord, st.stage, r AS rep,
           w.started_at + (st.ord * 30 + r * 10) * interval '1 second' AS occurred_at
      FROM retail_ops.web_sessions w
     CROSS JOIN (VALUES ('visit', 1, 100), ('product_view', 2, 60), ('add_to_cart', 3, 30),
                        ('checkout', 4, 15), ('purchase', 5, 9)) st(stage, ord, lim)
     CROSS JOIN LATERAL generate_series(1,
            CASE WHEN st.stage = 'product_view' AND retail_ops.h('dup-pv' || w.session_id) % 7 = 0 THEN 2
                 WHEN st.stage = 'add_to_cart' AND retail_ops.h('dup-atc' || w.session_id) % 5 = 0 THEN 2
                 ELSE 1 END) r
     WHERE retail_ops.h('depth' || w.session_id) % 100 < st.lim
  ) x;

-- ---------------------------------------------------------------------------
-- Loyalty redemptions: the programme has not started, the table is empty.
-- ---------------------------------------------------------------------------

CREATE TABLE retail_ops.loyalty_redemptions (
  redemption_id int PRIMARY KEY,
  customer_id int NOT NULL REFERENCES retail_ops.customers,
  redeemed_at timestamptz NOT NULL,
  points int NOT NULL,
  value_usd numeric(10,2) NOT NULL
);

-- ---------------------------------------------------------------------------
-- Indexes on the foreign keys of the big tables, statistics, comments
-- ---------------------------------------------------------------------------

CREATE INDEX orders_customer_idx ON retail_ops.orders (customer_id);
CREATE INDEX orders_store_idx ON retail_ops.orders (store_id);
CREATE INDEX orders_date_idx ON retail_ops.orders (order_date);
CREATE INDEX order_lines_order_idx ON retail_ops.order_lines (order_id);
CREATE INDEX order_lines_product_idx ON retail_ops.order_lines (product_id);
CREATE INDEX returns_line_idx ON retail_ops.returns (line_id);
CREATE INDEX funnel_events_session_idx ON retail_ops.funnel_events (session_id);

ANALYZE retail_ops.calendar;
ANALYZE retail_ops.currencies;
ANALYZE retail_ops.fx_rates;
ANALYZE retail_ops.regions;
ANALYZE retail_ops.countries;
ANALYZE retail_ops.stores;
ANALYZE retail_ops.product_categories;
ANALYZE retail_ops.products;
ANALYZE retail_ops.product_price_history;
ANALYZE retail_ops.customers;
ANALYZE retail_ops.promotions;
ANALYZE retail_ops.orders;
ANALYZE retail_ops.order_lines;
ANALYZE retail_ops.order_promotions;
ANALYZE retail_ops.returns;
ANALYZE retail_ops.store_targets;
ANALYZE retail_ops.web_sessions;
ANALYZE retail_ops.funnel_events;
ANALYZE retail_ops.loyalty_redemptions;

COMMENT ON TABLE retail_ops.calendar IS 'One row per day, 2022-01-01 to 2024-12-31, with the calendar and the fiscal year (starts 1 February, named after the year it starts in).';
COMMENT ON TABLE retail_ops.currencies IS 'The six currencies the retailer trades in.';
COMMENT ON TABLE retail_ops.fx_rates IS 'Monthly exchange rate to US dollars: usd_per_unit of each currency for rate_month.';
COMMENT ON TABLE retail_ops.regions IS 'Americas, EMEA and APAC.';
COMMENT ON TABLE retail_ops.countries IS 'The eight countries the retailer sells in, with their region and currency.';
COMMENT ON TABLE retail_ops.stores IS 'Shops (channel retail) and web shops (channel online); closed_on is set for shops that closed.';
COMMENT ON TABLE retail_ops.product_categories IS 'Three-level category tree: department, category, subcategory. Products belong to a subcategory.';
COMMENT ON TABLE retail_ops.products IS 'Product list. list_price_usd is the current price; brand spellings vary; is_deleted marks products removed from the catalogue.';
COMMENT ON TABLE retail_ops.product_price_history IS 'Price of a product over a period (valid_from to valid_to, inclusive; NULL valid_to is the current price).';
COMMENT ON TABLE retail_ops.customers IS 'Customers; some people appear twice with another letter case in the email.';
COMMENT ON TABLE retail_ops.promotions IS 'Promotion campaigns with their discount and dates.';
COMMENT ON TABLE retail_ops.orders IS 'One row per order. ordered_at is the UTC instant, order_date its UTC date. Status completed, cancelled or pending.';
COMMENT ON TABLE retail_ops.order_lines IS 'Lines of an order. unit_price, discount_amount and net_amount are in the order currency; net_amount_usd is in US dollars.';
COMMENT ON TABLE retail_ops.order_promotions IS 'Which promotions an order used; an order can use more than one.';
COMMENT ON TABLE retail_ops.returns IS 'Returned order lines with the refund in US dollars (a return can be partial).';
COMMENT ON TABLE retail_ops.store_targets IS 'Monthly revenue target in US dollars per shop, 2023 and 2024 only.';
COMMENT ON TABLE retail_ops.web_sessions IS 'Web shop sessions; customer_id is NULL for anonymous visitors.';
COMMENT ON TABLE retail_ops.funnel_events IS 'Stage reached in a web session; a stage can be logged more than once per session.';
COMMENT ON TABLE retail_ops.loyalty_redemptions IS 'Loyalty point redemptions. The programme has not started: no rows.';

DROP FUNCTION retail_ops.h(text);
