-- Edge Cases sample fixture: an e-commerce store built to break things.
--
-- Every row is generated here with generate_series and md5-based expressions
-- (helper edge_cases.h, dropped at the end), so every load holds exactly the
-- same data whatever the server or the order statements run in. No clock and
-- no unseeded randomness are used.
--
-- Each planted edge case (awkward names and values, data-quality problems,
-- ranking ties) and where it lives is listed in
-- specs/capabilities/testing-data/spec.md, section "The Edge Cases sample";
-- backend/test/edge-cases-fixture.e2e-spec.ts (opt-in: EDGE_CASES_SMOKE=1)
-- seeds it on a live server and counts each one. Change the three together.
--
-- Loader rules this file keeps (sql-statements.ts splits it): no dollar
-- quoting, no backslash-escaped quotes, every object qualified with
-- edge_cases, no SET search_path.

DROP SCHEMA IF EXISTS edge_cases CASCADE;

CREATE SCHEMA edge_cases;

-- Deterministic pseudo-random integer in [0, 2^28) from a text seed.
CREATE FUNCTION edge_cases.h(seed text) RETURNS integer
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS 'SELECT (''x'' || substr(md5(seed), 1, 7))::bit(28)::integer';

CREATE TYPE edge_cases.order_status AS ENUM
  ('pending', 'paid', 'shipped', 'delivered', 'cancelled', 'returned');

-- ---------------------------------------------------------------------------
-- One-row and empty tables
-- ---------------------------------------------------------------------------

CREATE TABLE edge_cases.store_settings (
  id smallint PRIMARY KEY CHECK (id = 1),
  store_name text NOT NULL,
  base_currency char(3) NOT NULL,
  time_zone text NOT NULL,
  opened_on date NOT NULL,
  free_shipping_threshold numeric(10,2),
  settings jsonb
);

INSERT INTO edge_cases.store_settings VALUES (
  1, 'Edge Cases Store', 'USD', 'America/Bogota', date '2019-01-01', 50.00,
  '{"checkout": {"guest": true, "max_items": 999, "payment_methods": ["card", "paypal"]}, "beta": null}'
);

CREATE TABLE edge_cases.gift_cards (
  id bigint PRIMARY KEY,
  code text NOT NULL UNIQUE,
  customer_id bigint,
  initial_balance numeric(10,2) NOT NULL,
  balance numeric(10,2) NOT NULL,
  issued_at timestamptz NOT NULL,
  expires_on date
);

-- ---------------------------------------------------------------------------
-- Categories: a self-referencing tree, three levels deep
-- ---------------------------------------------------------------------------

CREATE TABLE edge_cases.categories (
  category_id integer PRIMARY KEY,
  parent_category_id integer REFERENCES edge_cases.categories (category_id),
  name text NOT NULL,
  "group" text,
  sort_order integer NOT NULL
);

INSERT INTO edge_cases.categories
SELECT c, NULL,
  (ARRAY['Apparel', 'Electronics', 'Home', 'Beauty', 'Sports', 'Toys', 'Grocery', 'Books'])[c],
  (ARRAY['A', 'B', 'b', ' B '])[1 + c % 4],
  c
FROM generate_series(1, 8) AS c;

INSERT INTO edge_cases.categories
SELECT c, 1 + (c - 9) % 8, 'Sub-category ' || c,
  (ARRAY['A', 'B', 'b', ' B '])[1 + c % 4],
  c
FROM generate_series(9, 60) AS c;

INSERT INTO edge_cases.categories
SELECT c, c - 52, 'Leaf ' || c, NULL, c
FROM generate_series(61, 70) AS c;

-- ---------------------------------------------------------------------------
-- Customers (50,000)
-- ---------------------------------------------------------------------------

CREATE TABLE edge_cases.customers (
  id bigint PRIMARY KEY,
  customer_code text NOT NULL UNIQUE,
  first_name text,
  middle_name text,
  last_name text,
  email text,
  phone text,
  fax text,
  "CustomerTier" text,
  country text,
  "región" text,
  city text,
  is_vip boolean,
  birth_date date,
  signup_date text,
  preferences jsonb,
  last_login_ip inet,
  created_at timestamptz NOT NULL,
  updated_at timestamptz
);

INSERT INTO edge_cases.customers
SELECT
  i,
  'C' || lpad(i::text, 6, '0'),
  (ARRAY['Ana', 'Bruno', 'Chloé', 'Dmitri', 'Émile', 'Fatima', 'Günter', 'Hiro', 'Iñigo', 'José',
         'Kofi', 'Léa', 'María', 'Nuño', 'Olga', 'Priya', 'Quinn', 'Raúl', 'Søren', 'Zoë'])[1 + i % 20],
  CASE WHEN i % 2 = 0 THEN NULL
       ELSE (ARRAY['Luis', 'Ángel', 'Marie', 'J.', 'van der'])[1 + i % 5] END,
  (ARRAY['García', 'Smith', 'O''Connor', 'Müller', 'Nakamura', 'Okafor', 'Peña', 'Dubois',
         'Kowalski', 'Silva', 'de la Cruz', 'Ng'])[1 + (i / 20) % 12],
  CASE WHEN i % 50 = 1
       THEN (ARRAY['not-an-email', 'user@@example.com', 'user at example.com', '@example.com',
                   'user@example', 'user@ex ample.com'])[1 + (i / 50) % 6]
       ELSE 'c' || i || '@example.com' END,
  CASE WHEN i % 20 = 0 THEN NULL
       WHEN i % 100 = 7 THEN (ARRAY['N/A', 'call me', '12345', '+1 (555) CALL-NOW', 'none'])[1 + (i / 100) % 5]
       ELSE '+1 555-' || lpad((i % 10000)::text, 4, '0') END,
  NULL,
  (ARRAY['Bronze', 'Silver', 'Gold', 'Platinum'])[1 + edge_cases.h('tier' || i) % 4],
  (ARRAY['Brazil', 'Brazil', 'brazil', ' BRAZIL ', 'Colombia', 'colombia', 'México', 'Mexico',
         'United States', 'united states', 'USA', 'U.S.A.', 'Spain', 'España', 'Canada', 'CANADA',
         'Germany', 'Japan', 'France', ' France'])[1 + i % 20],
  (ARRAY['Norte', 'Sur', 'Centro', 'Oeste', 'Este', 'Región Andina', 'Ñuble'])[1 + i % 7],
  (ARRAY['Bogotá', 'São Paulo', 'Ciudad de México', 'New York', 'Madrid', 'Köln', 'Tōkyō', 'Paris'])[1 + (i / 3) % 8],
  CASE WHEN i % 10 = 0 THEN NULL ELSE i % 3 = 0 END,
  CASE WHEN i = 1 THEN date '1899-12-31'
       WHEN i = 2 THEN date '1900-01-01'
       ELSE date '1950-01-01' + edge_cases.h('birth' || i) % 20000 END,
  CASE WHEN i % 500 = 0
       THEN (ARRAY['2024-02-30', 'N/A', '', '31/12/2024', '2024-13-01', 'yesterday'])[1 + (i / 500) % 6]
       ELSE to_char(date '2019-01-01' + edge_cases.h('signup' || i) % 2800, 'YYYY-MM-DD') END,
  CASE WHEN i % 1000 = 0 THEN NULL
       WHEN i % 1000 = 1 THEN '{}'::jsonb
       WHEN i % 1000 = 2 THEN 'null'::jsonb
       ELSE jsonb_build_object(
         'newsletter', i % 2 = 0,
         'channels', jsonb_build_array('email', CASE WHEN i % 3 = 0 THEN 'sms' ELSE 'push' END),
         'address', jsonb_build_object(
           'city', (ARRAY['Bogotá', 'São Paulo', 'Madrid', 'Köln'])[1 + i % 4],
           'geo', jsonb_build_object('lat', (i % 180) - 90 + 0.123456, 'lng', (i % 360) - 180 + 0.654321)),
         'sizes', jsonb_build_object('shoe', 36 + i % 10, 'shirt', (ARRAY['S', 'M', 'L', 'XL'])[1 + i % 4]))
  END,
  CASE WHEN i % 7 = 0 THEN NULL
       WHEN i % 250 = 1 THEN ('2001:db8::' || to_hex(i))::inet
       ELSE ('10.' || ((i / 65536) % 256) || '.' || ((i / 256) % 256) || '.' || (i % 256))::inet END,
  timestamptz '2019-01-01 00:00:00+00' + (edge_cases.h('created' || i) % 220000000) * interval '1 second',
  CASE WHEN i % 4 = 0 THEN NULL
       ELSE timestamptz '2026-01-01 00:00:00+00' + (edge_cases.h('updated' || i) % 26000000) * interval '1 second' END
FROM generate_series(1, 50000) AS i;

-- 65 columns: one key and 64 attributes of eight types, each with its own NULL rate.
CREATE TABLE edge_cases.customer_profile_wide (
  customer_id bigint PRIMARY KEY,
  label_01 text, count_02 integer, amount_03 numeric(12,2), flag_04 boolean,
  day_05 date, seen_at_06 timestamptz, score_07 double precision, level_08 smallint,
  label_09 text, count_10 integer, amount_11 numeric(12,2), flag_12 boolean,
  day_13 date, seen_at_14 timestamptz, score_15 double precision, level_16 smallint,
  label_17 text, count_18 integer, amount_19 numeric(12,2), flag_20 boolean,
  day_21 date, seen_at_22 timestamptz, score_23 double precision, level_24 smallint,
  label_25 text, count_26 integer, amount_27 numeric(12,2), flag_28 boolean,
  day_29 date, seen_at_30 timestamptz, score_31 double precision, level_32 smallint,
  label_33 text, count_34 integer, amount_35 numeric(12,2), flag_36 boolean,
  day_37 date, seen_at_38 timestamptz, score_39 double precision, level_40 smallint,
  label_41 text, count_42 integer, amount_43 numeric(12,2), flag_44 boolean,
  day_45 date, seen_at_46 timestamptz, score_47 double precision, level_48 smallint,
  label_49 text, count_50 integer, amount_51 numeric(12,2), flag_52 boolean,
  day_53 date, seen_at_54 timestamptz, score_55 double precision, level_56 smallint,
  label_57 text, count_58 integer, amount_59 numeric(12,2), flag_60 boolean,
  day_61 date, seen_at_62 timestamptz, score_63 double precision, level_64 smallint
);

INSERT INTO edge_cases.customer_profile_wide
SELECT
  c,
  CASE WHEN (c + 1) % 2 = 0 THEN NULL ELSE 'v' || ((c + 1) % 97) END,
  CASE WHEN (c + 2) % 3 = 0 THEN NULL ELSE ((c * 2) % 1000) END,
  CASE WHEN (c + 3) % 4 = 0 THEN NULL ELSE round(((c * 3) % 100000) / 100.0, 2) END,
  CASE WHEN (c + 4) % 5 = 0 THEN NULL ELSE ((c + 4) % 3 = 0) END,
  CASE WHEN (c + 5) % 6 = 0 THEN NULL ELSE date '2020-01-01' + ((c * 5) % 2000)::integer END,
  CASE WHEN (c + 6) % 7 = 0 THEN NULL ELSE timestamptz '2020-01-01 00:00:00+00' + ((c * 6) % 2000000) * interval '1 minute' END,
  CASE WHEN (c + 7) % 8 = 0 THEN NULL ELSE ((c * 7) % 1000) / 7.0 END,
  CASE WHEN (c + 8) % 9 = 0 THEN NULL ELSE ((c + 8) % 10)::smallint END,
  CASE WHEN (c + 9) % 10 = 0 THEN NULL ELSE 'v' || ((c + 9) % 97) END,
  CASE WHEN (c + 10) % 11 = 0 THEN NULL ELSE ((c * 10) % 1000) END,
  CASE WHEN (c + 11) % 12 = 0 THEN NULL ELSE round(((c * 11) % 100000) / 100.0, 2) END,
  CASE WHEN (c + 12) % 13 = 0 THEN NULL ELSE ((c + 12) % 3 = 0) END,
  CASE WHEN (c + 13) % 14 = 0 THEN NULL ELSE date '2020-01-01' + ((c * 13) % 2000)::integer END,
  CASE WHEN (c + 14) % 15 = 0 THEN NULL ELSE timestamptz '2020-01-01 00:00:00+00' + ((c * 14) % 2000000) * interval '1 minute' END,
  CASE WHEN (c + 15) % 16 = 0 THEN NULL ELSE ((c * 15) % 1000) / 7.0 END,
  CASE WHEN (c + 16) % 17 = 0 THEN NULL ELSE ((c + 16) % 10)::smallint END,
  CASE WHEN (c + 17) % 18 = 0 THEN NULL ELSE 'v' || ((c + 17) % 97) END,
  CASE WHEN (c + 18) % 19 = 0 THEN NULL ELSE ((c * 18) % 1000) END,
  CASE WHEN (c + 19) % 20 = 0 THEN NULL ELSE round(((c * 19) % 100000) / 100.0, 2) END,
  CASE WHEN (c + 20) % 21 = 0 THEN NULL ELSE ((c + 20) % 3 = 0) END,
  CASE WHEN (c + 21) % 22 = 0 THEN NULL ELSE date '2020-01-01' + ((c * 21) % 2000)::integer END,
  CASE WHEN (c + 22) % 23 = 0 THEN NULL ELSE timestamptz '2020-01-01 00:00:00+00' + ((c * 22) % 2000000) * interval '1 minute' END,
  CASE WHEN (c + 23) % 24 = 0 THEN NULL ELSE ((c * 23) % 1000) / 7.0 END,
  CASE WHEN (c + 24) % 25 = 0 THEN NULL ELSE ((c + 24) % 10)::smallint END,
  CASE WHEN (c + 25) % 26 = 0 THEN NULL ELSE 'v' || ((c + 25) % 97) END,
  CASE WHEN (c + 26) % 27 = 0 THEN NULL ELSE ((c * 26) % 1000) END,
  CASE WHEN (c + 27) % 28 = 0 THEN NULL ELSE round(((c * 27) % 100000) / 100.0, 2) END,
  CASE WHEN (c + 28) % 29 = 0 THEN NULL ELSE ((c + 28) % 3 = 0) END,
  CASE WHEN (c + 29) % 30 = 0 THEN NULL ELSE date '2020-01-01' + ((c * 29) % 2000)::integer END,
  CASE WHEN (c + 30) % 31 = 0 THEN NULL ELSE timestamptz '2020-01-01 00:00:00+00' + ((c * 30) % 2000000) * interval '1 minute' END,
  CASE WHEN (c + 31) % 32 = 0 THEN NULL ELSE ((c * 31) % 1000) / 7.0 END,
  CASE WHEN (c + 32) % 33 = 0 THEN NULL ELSE ((c + 32) % 10)::smallint END,
  CASE WHEN (c + 33) % 34 = 0 THEN NULL ELSE 'v' || ((c + 33) % 97) END,
  CASE WHEN (c + 34) % 35 = 0 THEN NULL ELSE ((c * 34) % 1000) END,
  CASE WHEN (c + 35) % 36 = 0 THEN NULL ELSE round(((c * 35) % 100000) / 100.0, 2) END,
  CASE WHEN (c + 36) % 37 = 0 THEN NULL ELSE ((c + 36) % 3 = 0) END,
  CASE WHEN (c + 37) % 38 = 0 THEN NULL ELSE date '2020-01-01' + ((c * 37) % 2000)::integer END,
  CASE WHEN (c + 38) % 39 = 0 THEN NULL ELSE timestamptz '2020-01-01 00:00:00+00' + ((c * 38) % 2000000) * interval '1 minute' END,
  CASE WHEN (c + 39) % 40 = 0 THEN NULL ELSE ((c * 39) % 1000) / 7.0 END,
  CASE WHEN (c + 40) % 41 = 0 THEN NULL ELSE ((c + 40) % 10)::smallint END,
  CASE WHEN (c + 41) % 42 = 0 THEN NULL ELSE 'v' || ((c + 41) % 97) END,
  CASE WHEN (c + 42) % 43 = 0 THEN NULL ELSE ((c * 42) % 1000) END,
  CASE WHEN (c + 43) % 44 = 0 THEN NULL ELSE round(((c * 43) % 100000) / 100.0, 2) END,
  CASE WHEN (c + 44) % 45 = 0 THEN NULL ELSE ((c + 44) % 3 = 0) END,
  CASE WHEN (c + 45) % 46 = 0 THEN NULL ELSE date '2020-01-01' + ((c * 45) % 2000)::integer END,
  CASE WHEN (c + 46) % 47 = 0 THEN NULL ELSE timestamptz '2020-01-01 00:00:00+00' + ((c * 46) % 2000000) * interval '1 minute' END,
  CASE WHEN (c + 47) % 48 = 0 THEN NULL ELSE ((c * 47) % 1000) / 7.0 END,
  CASE WHEN (c + 48) % 49 = 0 THEN NULL ELSE ((c + 48) % 10)::smallint END,
  CASE WHEN (c + 49) % 50 = 0 THEN NULL ELSE 'v' || ((c + 49) % 97) END,
  CASE WHEN (c + 50) % 51 = 0 THEN NULL ELSE ((c * 50) % 1000) END,
  CASE WHEN (c + 51) % 52 = 0 THEN NULL ELSE round(((c * 51) % 100000) / 100.0, 2) END,
  CASE WHEN (c + 52) % 53 = 0 THEN NULL ELSE ((c + 52) % 3 = 0) END,
  CASE WHEN (c + 53) % 54 = 0 THEN NULL ELSE date '2020-01-01' + ((c * 53) % 2000)::integer END,
  CASE WHEN (c + 54) % 55 = 0 THEN NULL ELSE timestamptz '2020-01-01 00:00:00+00' + ((c * 54) % 2000000) * interval '1 minute' END,
  CASE WHEN (c + 55) % 56 = 0 THEN NULL ELSE ((c * 55) % 1000) / 7.0 END,
  CASE WHEN (c + 56) % 57 = 0 THEN NULL ELSE ((c + 56) % 10)::smallint END,
  CASE WHEN (c + 57) % 58 = 0 THEN NULL ELSE 'v' || ((c + 57) % 97) END,
  CASE WHEN (c + 58) % 59 = 0 THEN NULL ELSE ((c * 58) % 1000) END,
  CASE WHEN (c + 59) % 60 = 0 THEN NULL ELSE round(((c * 59) % 100000) / 100.0, 2) END,
  CASE WHEN (c + 60) % 61 = 0 THEN NULL ELSE ((c + 60) % 3 = 0) END,
  CASE WHEN (c + 61) % 62 = 0 THEN NULL ELSE date '2020-01-01' + ((c * 61) % 2000)::integer END,
  CASE WHEN (c + 62) % 63 = 0 THEN NULL ELSE timestamptz '2020-01-01 00:00:00+00' + ((c * 62) % 2000000) * interval '1 minute' END,
  CASE WHEN (c + 63) % 64 = 0 THEN NULL ELSE ((c * 63) % 1000) / 7.0 END,
  CASE WHEN (c + 64) % 65 = 0 THEN NULL ELSE ((c + 64) % 10)::smallint END
FROM generate_series(1, 20000) AS c;

-- ---------------------------------------------------------------------------
-- Products (5,000)
-- ---------------------------------------------------------------------------

CREATE TABLE edge_cases.products (
  id integer PRIMARY KEY,
  sku text NOT NULL UNIQUE,
  name text,
  category_id integer,
  brand text,
  color text,
  unit_price numeric(12,2) NOT NULL,
  cost numeric(38,10),
  margin_pct numeric(7,2),
  weight_kg double precision,
  "select" boolean,
  matching_rows integer,
  tags text[],
  is_active boolean NOT NULL,
  launched_at timestamptz,
  description text
);

INSERT INTO edge_cases.products
SELECT
  i,
  'SKU-' || lpad(i::text, 5, '0'),
  CASE
    WHEN i = 11 THEN '100% Cotton Tee'
    WHEN i = 12 THEN 'snake_case_name'
    WHEN i = 13 THEN 'C:\Temp\new folder'
    WHEN i = 14 THEN 'O''Brien''s Mug'
    WHEN i = 15 THEN '12" Vinyl "Deluxe"'
    WHEN i = 16 THEN 'Rocket 🚀 Lamp'
    WHEN i = 17 THEN 'Line one' || chr(10) || 'line two'
    WHEN i = 18 THEN '   Padded Name   '
    WHEN i = 19 THEN ''
    WHEN i = 20 THEN 'Ünïcödé Ñandú'
    WHEN i = 21 THEN 'Robert''); DROP TABLE products;--'
    WHEN i = 22 THEN '%_%'
    WHEN i = 23 THEN 'Tab' || chr(9) || 'separated'
    WHEN i = 24 THEN NULL
    WHEN i BETWEEN 30 AND 34 THEN 'Classic Mug'
    ELSE 'Product ' || i
  END,
  CASE WHEN i % 1000 = 999 THEN NULL ELSE 9 + i % 62 END,
  (ARRAY['Acme', 'ACME', 'acme ', 'Globex', 'Initech', 'Umbrella', 'Stark', 'Wayne'])[1 + i % 8],
  (ARRAY['Red', 'red', ' RED ', 'Blue', 'blue', 'Green', 'GREEN', 'Black', 'black ', 'White'])[1 + i % 10],
  CASE WHEN i <= 5 THEN 1000.00
       WHEN i = 4999 THEN 1000000000.00
       WHEN i = 4998 THEN -19.99
       WHEN i % 500 = 3 THEN 0.00
       ELSE round((500 + edge_cases.h('price' || i) % 49500) / 100.0, 2) END,
  CASE WHEN i = 1 THEN 1234567890123456789012345678.1234567890
       WHEN i = 2 THEN 0.0000000001
       ELSE round((500 + edge_cases.h('cost' || i) % 30000) / 100.0
                  + (edge_cases.h('cents' || i) % 1000000) / 10000000000.0, 10) END,
  CASE WHEN i % 1000 = 7 THEN 150.00
       WHEN i % 1000 = 8 THEN -12.50
       ELSE (edge_cases.h('margin' || i) % 6000) / 100.0 END,
  CASE WHEN i % 1000 = 9 THEN 'NaN'::double precision
       WHEN i = 10 THEN 'Infinity'::double precision
       WHEN i % 1000 = 10 THEN 0
       ELSE (edge_cases.h('weight' || i) % 50000) / 1000.0 END,
  CASE WHEN i % 7 = 0 THEN NULL ELSE i % 3 = 0 END,
  edge_cases.h('matches' || i) % 1000,
  CASE WHEN i % 100 = 0 THEN NULL
       WHEN i % 100 = 1 THEN '{}'::text[]
       WHEN i % 100 = 2 THEN ARRAY['with space', 'comma,inside', NULL]
       WHEN i % 100 = 3 THEN ARRAY['quote"inside', 'back\slash']
       ELSE ARRAY['tag' || (i % 10), 'tag' || (i % 7)] END,
  i % 20 <> 0,
  timestamptz '2015-01-01 00:00:00+00' + (edge_cases.h('launch' || i) % 3900) * interval '1 day',
  CASE WHEN i IN (100, 200, 300) THEN repeat('Soft, durable and built to last. ', 350)
       WHEN i % 10 = 0 THEN NULL
       ELSE 'Description of product ' || i END
FROM generate_series(1, 5000) AS i;

CREATE TABLE edge_cases.promotions (
  promotion_id integer PRIMARY KEY,
  name text NOT NULL,
  "discount_%" numeric(5,2),
  start_date date NOT NULL,
  end_date date NOT NULL,
  is_active boolean
);

-- Every end_date precedes its start_date: the columns look swapped.
INSERT INTO edge_cases.promotions
SELECT p, 'Promo ' || p, (p % 8) * 5.00,
  date '2025-01-01' + p * 7,
  date '2025-01-01' + p * 7 - 30,
  CASE WHEN p % 5 = 0 THEN NULL ELSE p % 2 = 0 END
FROM generate_series(1, 40) AS p;

-- ---------------------------------------------------------------------------
-- Orders (300,000)
-- ---------------------------------------------------------------------------

CREATE TABLE edge_cases.orders (
  id bigint NOT NULL,
  customer_id bigint NOT NULL,
  "order" integer,
  "user" text,
  status edge_cases.order_status NOT NULL,
  channel text,
  currency text,
  ordered_tz text NOT NULL,
  ordered_at timestamptz NOT NULL,
  expected_delivery_date date,
  "Order Notes" text,
  "ship-to" text,
  "año" smallint,
  "discount_%" numeric(5,2),
  discount_amount numeric(12,4),
  shipping_fee numeric(10,2),
  order_uuid uuid NOT NULL,
  cancelled_at timestamptz
);

INSERT INTO edge_cases.orders
SELECT
  i,
  1 + edge_cases.h('customer' || i) % 50000,
  1 + i % 7,
  CASE WHEN i % 4 = 0 THEN NULL ELSE 'rep_' || lpad((i % 25)::text, 2, '0') END,
  status,
  (ARRAY['web', 'Web', ' WEB ', 'mobile', 'Mobile', 'store', 'marketplace'])[1 + i % 7],
  (ARRAY['USD', 'USD', 'usd', 'EUR', 'eur ', 'COP', 'GBP'])[1 + (i / 7) % 7],
  tz,
  local_ts AT TIME ZONE tz,
  CASE WHEN i % 100000 = 0 THEN date '2999-12-31' ELSE (local_ts + interval '5 days')::date END,
  CASE
    WHEN i IN (1001, 2002, 3003) THEN repeat('Lorem ipsum dolor sit amet, consectetur adipiscing elit. ', 200)
    WHEN i % 1000 = 1 THEN 'Leave at door; 100% sure'
    WHEN i % 1000 = 2 THEN 'Use code SAVE_10 (snake_case)'
    WHEN i % 1000 = 3 THEN 'Path C:\Users\new folder'
    WHEN i % 1000 = 4 THEN 'Customer''s note: "fragile"'
    WHEN i % 1000 = 5 THEN 'Gift 🎁 for mum ❤️'
    WHEN i % 1000 = 6 THEN 'Line one' || chr(10) || 'Line two' || chr(13) || chr(10) || 'Line three'
    WHEN i % 1000 = 7 THEN '   padded both sides   '
    WHEN i % 1000 = 8 THEN ''
    WHEN i % 1000 = 9 THEN '   '
    WHEN i % 1000 = 10 THEN 'NULL'
    WHEN i % 2 = 0 THEN 'Deliver between 9 and 5'
    ELSE NULL
  END,
  CASE WHEN i % 50 = 0 THEN NULL
       ELSE 'Calle ' || (i % 200) || ' #' || (i % 97) || '-' || (i % 13) || ', '
            || (ARRAY['Bogotá', 'Medellín', 'São Paulo', 'Ciudad de México', 'Madrid'])[1 + i % 5] END,
  extract(year FROM local_ts)::smallint,
  CASE WHEN i % 10 = 0 THEN 15.00 WHEN i % 10 = 1 THEN 7.50 ELSE 0.00 END,
  (ARRAY[0.0050, 2.6750, 1.0049, 0.1250, 0.0000, 19.9950])[1 + i % 6],
  CASE WHEN i % 3 = 0 THEN 0.00 ELSE 4.99 END,
  md5('order-' || i)::uuid,
  CASE WHEN status = 'cancelled' THEN (local_ts AT TIME ZONE tz) + interval '2 hours' END
FROM (
  SELECT
    i,
    (ARRAY['pending', 'paid', 'shipped', 'delivered', 'delivered', 'delivered', 'cancelled', 'returned'])
      [1 + edge_cases.h('status' || i) % 8]::edge_cases.order_status AS status,
    CASE WHEN i IN (1, 2) THEN 'America/New_York'
         WHEN i = 3 THEN 'Europe/Madrid'
         ELSE (ARRAY['UTC', 'America/New_York', 'America/Bogota', 'Europe/Madrid', 'Asia/Tokyo',
                     'Australia/Sydney', 'Asia/Kolkata', 'Pacific/Chatham'])[1 + i % 8] END AS tz,
    CASE
      -- Spring-forward gap: 02:30 does not exist in New York that night.
      WHEN i = 1 THEN timestamp '2024-03-10 02:30:00'
      -- Fall-back overlap: 01:30 happens twice in New York that night.
      WHEN i = 2 THEN timestamp '2024-11-03 01:30:00'
      WHEN i = 3 THEN timestamp '2024-03-31 02:30:00'
      WHEN i = 4 THEN timestamp '2024-12-31 23:59:59.999999'
      WHEN i = 5 THEN timestamp '2024-02-29 12:00:00'
      ELSE timestamp '2021-01-01 00:00:00' + (edge_cases.h('ordered' || i) % 183800000) * interval '1 second'
    END AS local_ts
  FROM generate_series(1, 300000) AS i
) AS o;

ALTER TABLE edge_cases.orders ADD PRIMARY KEY (id);

-- ---------------------------------------------------------------------------
-- Order lines (1,000,000) — the largest table
-- ---------------------------------------------------------------------------

CREATE TABLE edge_cases.order_lines (
  id bigint NOT NULL,
  order_id bigint NOT NULL,
  product_id integer NOT NULL,
  line_number integer NOT NULL,
  quantity integer NOT NULL,
  unit_price numeric(12,2) NOT NULL,
  discount numeric(5,4) NOT NULL,
  line_total numeric(14,2) NOT NULL,
  tax_rate double precision,
  event_sequence bigint NOT NULL,
  gift_message text
);

-- Products 1-5 get 5,000 identical lines each (10 x 1,000.00): an exact
-- five-way tie at the top of revenue.
INSERT INTO edge_cases.order_lines
SELECT
  i,
  order_id,
  product_id,
  1 + (i - 1) / 300000,
  quantity,
  unit_price,
  discount,
  round(quantity * unit_price * (1 - discount), 2),
  (ARRAY[0.0, 0.05, 0.1, 0.19, 0.21])[1 + i % 5],
  9223372036853775807 + i,
  CASE WHEN i % 100 = 0 THEN ''
       WHEN i % 100 = 1 THEN ' '
       WHEN i % 10 = 5 THEN 'Happy birthday!'
       ELSE NULL END
FROM (
  SELECT
    i,
    CASE WHEN i % 50000 = 7 THEN 900000000 + i ELSE (i - 1) % 300000 + 1 END AS order_id,
    CASE WHEN i % 1000 < 25 THEN i % 5 + 1
         WHEN i % 40000 = 500 THEN 90000 + i / 40000
         ELSE 6 + edge_cases.h('product' || i) % 4994 END AS product_id,
    CASE WHEN i % 1000 < 25 THEN 10
         WHEN i % 2000 = 1999 THEN -1 - (i / 2000) % 5
         WHEN i % 5000 = 77 THEN 0
         ELSE 1 + edge_cases.h('qty' || i) % 9 END AS quantity,
    CASE WHEN i % 1000 < 25 THEN 1000.00
         WHEN i % 7919 = 0 THEN 0.00
         ELSE round((500 + edge_cases.h('unit' || i) % 49500) / 100.0, 2) END AS unit_price,
    CASE WHEN i % 1000 < 25 THEN 0
         ELSE (i % 4) * 0.05 END AS discount
  FROM generate_series(1, 1000000) AS i
) AS l;

ALTER TABLE edge_cases.order_lines ADD PRIMARY KEY (id);

-- ---------------------------------------------------------------------------
-- Payments, shipments, returns, reviews, inventory
-- ---------------------------------------------------------------------------

CREATE TABLE edge_cases.payments (
  id bigint PRIMARY KEY,
  order_id bigint NOT NULL,
  method text,
  amount numeric(14,2) NOT NULL,
  payer_email text,
  card_last4 text,
  transaction_ref uuid,
  paid_at timestamptz NOT NULL
);

INSERT INTO edge_cases.payments
SELECT
  i,
  i,
  (ARRAY['card', 'Card', 'CARD ', 'paypal', 'PayPal', 'bank_transfer', 'cash'])[1 + i % 7],
  round((edge_cases.h('amount' || i) % 200000) / 100.0, 2),
  CASE WHEN i % 400 = 1 THEN (ARRAY['payer.example.com', 'payer@', 'pay er@example.com'])[1 + (i / 400) % 3]
       ELSE 'payer' || i || '@example.org' END,
  CASE WHEN (ARRAY['card', 'Card', 'CARD ', 'paypal', 'PayPal', 'bank_transfer', 'cash'])[1 + i % 7] ILIKE '%card%'
       THEN lpad((i % 10000)::text, 4, '0') END,
  md5('payment-' || i)::uuid,
  timestamptz '2021-01-01 06:00:00+00' + (edge_cases.h('paid' || i) % 183800000) * interval '1 second'
FROM generate_series(1, 300000) AS i
WHERE i % 8 <> 0;

CREATE TABLE edge_cases.shipments (
  shipment_id bigint PRIMARY KEY,
  order_id bigint NOT NULL,
  carrier text,
  country text,
  postal_code text,
  tracking_url text,
  shipped_at timestamptz NOT NULL,
  delivered_at timestamptz
);

-- delivered_at precedes shipped_at on every 100th shipment ending in 37.
INSERT INTO edge_cases.shipments
SELECT
  i,
  i,
  (ARRAY['DHL', 'dhl', 'FedEx', 'FEDEX ', 'UPS', 'Servientrega'])[1 + i % 6],
  (ARRAY['Brazil', 'brazil', ' BRAZIL ', 'Colombia', 'COLOMBIA', 'Mexico', 'United States', 'Spain'])[1 + i % 8],
  CASE WHEN i % 200 = 0 THEN (ARRAY['ABC', '', '1234567890', '00000', 'N/A'])[1 + (i / 200) % 5]
       ELSE lpad((10000 + i % 89999)::text, 5, '0') END,
  CASE WHEN i % 250 = 0 THEN (ARRAY['N/A', 'www.track.example/' || i, 'ftp://track.example/' || i, ''])[1 + (i / 250) % 4]
       ELSE 'https://track.example/' || i END,
  shipped_at,
  CASE WHEN i % 10 = 1 THEN NULL
       WHEN i % 100 = 37 THEN shipped_at - interval '3 days'
       ELSE shipped_at + (1 + edge_cases.h('delivered' || i) % 10) * interval '1 day' END
FROM (
  SELECT i, timestamptz '2021-01-02 00:00:00+00' + (edge_cases.h('shipped' || i) % 183000000) * interval '1 second' AS shipped_at
  FROM generate_series(1, 300000) AS i
  WHERE i % 6 <> 0
) AS s;

CREATE TABLE edge_cases.returns (
  return_id integer PRIMARY KEY,
  order_line_id bigint NOT NULL,
  reason text,
  refund_amount numeric(12,2),
  restocked boolean,
  returned_at timestamptz NOT NULL
);

INSERT INTO edge_cases.returns
SELECT
  r,
  r * 61,
  (ARRAY['Damaged', 'damaged', 'DAMAGED ', 'Wrong size', 'Changed mind', NULL])[1 + r % 6],
  -round((100 + edge_cases.h('refund' || r) % 50000) / 100.0, 2),
  CASE WHEN r % 3 = 0 THEN NULL ELSE r % 2 = 0 END,
  timestamptz '2021-02-01 00:00:00+00' + (edge_cases.h('returned' || r) % 180000000) * interval '1 second'
FROM generate_series(1, 15000) AS r;

CREATE TABLE edge_cases.reviews (
  id bigint PRIMARY KEY,
  product_id integer NOT NULL,
  customer_id bigint NOT NULL,
  rating smallint,
  title text,
  body text,
  language text,
  helpful_votes integer NOT NULL,
  verified_purchase boolean,
  created_at timestamptz NOT NULL
);

INSERT INTO edge_cases.reviews
SELECT
  r,
  1 + edge_cases.h('review-product' || r) % 5000,
  1 + edge_cases.h('review-customer' || r) % 50000,
  CASE WHEN r % 1000 = 0 THEN 0
       WHEN r % 1000 = 1 THEN 6
       WHEN r % 50 = 2 THEN NULL
       ELSE 1 + edge_cases.h('rating' || r) % 5 END,
  CASE WHEN r % 9 = 0 THEN NULL ELSE 'Review ' || r END,
  CASE
    WHEN r IN (5, 10, 15) THEN repeat('This product is great! ', 500)
    WHEN r % 1000 = 3 THEN '50% off was worth it'
    WHEN r % 1000 = 4 THEN 'Fits like a_glove'
    WHEN r % 1000 = 5 THEN 'Saved under D:\reviews\2024'
    WHEN r % 1000 = 6 THEN 'It''s "fine", I guess'
    WHEN r % 1000 = 7 THEN '⭐⭐⭐⭐⭐ Loved it 😍'
    WHEN r % 1000 = 8 THEN 'First line' || chr(10) || chr(10) || 'After a blank line'
    WHEN r % 1000 = 9 THEN '  trailing and leading spaces  '
    WHEN r % 1000 = 10 THEN ''
    WHEN r % 4 = 0 THEN NULL
    ELSE 'Good value for ' || r
  END,
  (ARRAY['es', 'ES', 'en', 'EN ', 'pt', 'de'])[1 + r % 6],
  CASE WHEN r = 777 THEN 2147483647 ELSE edge_cases.h('votes' || r) % 50 END,
  CASE WHEN r % 11 = 0 THEN NULL ELSE r % 2 = 0 END,
  timestamptz '2021-03-01 00:00:00+00' + (edge_cases.h('reviewed' || r) % 178000000) * interval '1 second'
FROM generate_series(1, 40000) AS r;

-- Composite key: (product_id, warehouse_code, snapshot_date).
CREATE TABLE edge_cases.inventory_snapshots (
  product_id integer NOT NULL,
  warehouse_code text NOT NULL,
  snapshot_date date NOT NULL,
  quantity_on_hand integer NOT NULL,
  reorder_point integer,
  PRIMARY KEY (product_id, warehouse_code, snapshot_date)
);

INSERT INTO edge_cases.inventory_snapshots
SELECT
  p,
  w,
  date '2026-10-31' - k * 30,
  CASE WHEN (p + k) % 97 = 0 THEN -5 ELSE edge_cases.h('stock' || p || w || k) % 500 END,
  CASE WHEN p % 13 = 0 THEN NULL ELSE 20 + p % 30 END
FROM generate_series(1, 5000) AS p
CROSS JOIN unnest(ARRAY['BOG-01', 'MIA-02', 'MAD-03']) AS w
CROSS JOIN generate_series(0, 3) AS k;

-- ---------------------------------------------------------------------------
-- "LegacyOrders": a MixedCase table name, no primary key, exact duplicate
-- rows, duplicate ids and no row newer than 2015.
-- ---------------------------------------------------------------------------

CREATE TABLE edge_cases."LegacyOrders" (
  legacy_order_id integer,
  customer_id integer,
  legacy_uuid text,
  "OrderTotal" numeric(12,2),
  status text,
  placed_at timestamp without time zone,
  notes text
);

INSERT INTO edge_cases."LegacyOrders"
SELECT
  i,
  CASE WHEN i % 100 = 0 THEN 60000 + i ELSE 1 + i % 50000 END,
  CASE WHEN i % 250 = 0 THEN (ARRAY['not-a-uuid', '12345', '{' || md5('legacy' || i) || '}', ''])[1 + (i / 250) % 4]
       ELSE md5('legacy' || i)::uuid::text END,
  round((edge_cases.h('legacy-total' || i) % 100000) / 100.0, 2),
  (ARRAY['CLOSED', 'closed', 'Closed ', 'OPEN', 'void'])[1 + i % 5],
  timestamp '2010-01-01 00:00:00' + i * interval '9 hours',
  CASE WHEN i % 3 = 0 THEN NULL ELSE 'migrated from v1' END
FROM generate_series(1, 5000) AS i;

-- 200 exact duplicate rows.
INSERT INTO edge_cases."LegacyOrders"
SELECT * FROM edge_cases."LegacyOrders" WHERE legacy_order_id <= 200;

-- 50 more rows that reuse an id with different values.
INSERT INTO edge_cases."LegacyOrders"
SELECT
  i,
  1 + i % 50000,
  md5('legacy-reissued' || i)::uuid::text,
  99.99,
  'REISSUED',
  timestamp '2014-06-30 00:00:00' + i * interval '1 minute',
  'reissued with the same id'
FROM generate_series(1001, 1050) AS i;

-- ---------------------------------------------------------------------------
-- Keys, foreign keys and indexes (added after the bulk inserts: faster)
-- ---------------------------------------------------------------------------

ALTER TABLE edge_cases.gift_cards
  ADD CONSTRAINT "fk_gift_cards_customer" FOREIGN KEY (customer_id) REFERENCES edge_cases.customers (id);

ALTER TABLE edge_cases.customer_profile_wide
  ADD CONSTRAINT "fk_customer_profile_wide_customer" FOREIGN KEY (customer_id) REFERENCES edge_cases.customers (id);

ALTER TABLE edge_cases.products
  ADD CONSTRAINT "fk_products_category" FOREIGN KEY (category_id) REFERENCES edge_cases.categories (category_id);

ALTER TABLE edge_cases.orders
  ADD CONSTRAINT "fk_orders_customer" FOREIGN KEY (customer_id) REFERENCES edge_cases.customers (id);

-- Declared but NOT VALID: 20 order lines point at orders that do not exist.
ALTER TABLE edge_cases.order_lines
  ADD CONSTRAINT "fk_order_lines_order" FOREIGN KEY (order_id) REFERENCES edge_cases.orders (id) NOT VALID;

ALTER TABLE edge_cases.payments
  ADD CONSTRAINT "fk_payments_order" FOREIGN KEY (order_id) REFERENCES edge_cases.orders (id);

ALTER TABLE edge_cases.shipments
  ADD CONSTRAINT "fk_shipments_order" FOREIGN KEY (order_id) REFERENCES edge_cases.orders (id);

ALTER TABLE edge_cases.returns
  ADD CONSTRAINT "fk_returns_order_line" FOREIGN KEY (order_line_id) REFERENCES edge_cases.order_lines (id);

ALTER TABLE edge_cases.reviews
  ADD CONSTRAINT "fk_reviews_product" FOREIGN KEY (product_id) REFERENCES edge_cases.products (id);

ALTER TABLE edge_cases.reviews
  ADD CONSTRAINT "fk_reviews_customer" FOREIGN KEY (customer_id) REFERENCES edge_cases.customers (id);

ALTER TABLE edge_cases.inventory_snapshots
  ADD CONSTRAINT "fk_inventory_snapshots_product" FOREIGN KEY (product_id) REFERENCES edge_cases.products (id);

CREATE INDEX order_lines_order_id_idx ON edge_cases.order_lines (order_id);

CREATE INDEX order_lines_product_id_idx ON edge_cases.order_lines (product_id);

CREATE INDEX orders_customer_id_idx ON edge_cases.orders (customer_id);

-- ---------------------------------------------------------------------------
-- Views and a materialized view
-- ---------------------------------------------------------------------------

CREATE VIEW edge_cases.v_order_totals AS
SELECT
  o.id AS order_id,
  o.customer_id,
  o.status,
  o.ordered_at,
  count(l.id) AS line_count,
  coalesce(sum(l.quantity), 0) AS units,
  coalesce(sum(l.line_total), 0) AS order_total
FROM edge_cases.orders o
LEFT JOIN edge_cases.order_lines l ON l.order_id = o.id
GROUP BY o.id;

CREATE VIEW edge_cases.v_customer_ltv AS
SELECT
  c.id AS customer_id,
  c."CustomerTier",
  c.country,
  count(t.order_id) AS order_count,
  coalesce(sum(t.order_total), 0) AS lifetime_value,
  max(t.ordered_at) AS last_ordered_at
FROM edge_cases.customers c
LEFT JOIN edge_cases.v_order_totals t ON t.customer_id = c.id
GROUP BY c.id;

CREATE VIEW edge_cases.v_product_revenue AS
SELECT
  p.id AS product_id,
  p.name,
  p.color,
  count(l.id) AS line_count,
  sum(l.quantity) AS units,
  sum(l.line_total) AS revenue
FROM edge_cases.products p
JOIN edge_cases.order_lines l ON l.product_id = p.id
GROUP BY p.id;

CREATE MATERIALIZED VIEW edge_cases.mv_daily_sales AS
SELECT
  (t.ordered_at AT TIME ZONE 'UTC')::date AS sales_date,
  count(*) AS order_count,
  sum(t.units) AS units,
  sum(t.order_total) AS revenue
FROM edge_cases.v_order_totals t
GROUP BY 1
WITH NO DATA;

REFRESH MATERIALIZED VIEW edge_cases.mv_daily_sales;

-- ---------------------------------------------------------------------------
-- Comments
-- ---------------------------------------------------------------------------

COMMENT ON SCHEMA edge_cases IS 'Edge Cases sample: a synthetic e-commerce store full of planted edge cases. See specs/capabilities/testing-data/spec.md.';

COMMENT ON TABLE edge_cases.store_settings IS 'Exactly one row of store-wide settings.';

COMMENT ON TABLE edge_cases.gift_cards IS 'Always empty: no gift card has been issued.';

COMMENT ON TABLE edge_cases.categories IS 'Product category tree; parent_category_id references this table (three levels).';

COMMENT ON TABLE edge_cases.customers IS 'One row per customer. email, phone and signup_date hold some invalid values; country has inconsistent spellings; fax is always NULL.';

COMMENT ON TABLE edge_cases.customer_profile_wide IS 'Wide table: 65 columns, one row per profiled customer (the first 20,000).';

COMMENT ON TABLE edge_cases.products IS 'Product catalogue. unit_price has a 1,000,000,000.00 outlier and a negative price; weight_kg has NaN and Infinity.';

COMMENT ON TABLE edge_cases.promotions IS 'Promotions whose end_date always precedes start_date.';

COMMENT ON TABLE edge_cases.orders IS 'One row per order. ordered_at is entered in the zone named by ordered_tz.';

COMMENT ON COLUMN edge_cases.orders."Order Notes" IS 'Free text: quotes, emoji, newlines, padding, empty strings and three notes over 10,000 characters.';

COMMENT ON TABLE edge_cases.order_lines IS 'One row per order line (1,000,000). Some order_id values have no order; some product_id values have no product.';

COMMENT ON COLUMN edge_cases.order_lines.event_sequence IS 'Near the bigint limit; the last row holds 9223372036854775807.';

COMMENT ON TABLE edge_cases.payments IS 'One payment per order, except every eighth order.';

COMMENT ON TABLE edge_cases.shipments IS 'One shipment per order, except every sixth order. Some delivered_at precede shipped_at.';

COMMENT ON TABLE edge_cases.returns IS 'Returned order lines; refund_amount is negative.';

COMMENT ON TABLE edge_cases.reviews IS 'Product reviews; body holds long and awkward text.';

COMMENT ON TABLE edge_cases.inventory_snapshots IS 'Stock per product, warehouse and month (composite primary key).';

COMMENT ON TABLE edge_cases."LegacyOrders" IS 'Orders migrated from a retired system: no primary key, duplicate rows and ids, nothing after 2015.';

COMMENT ON VIEW edge_cases.v_order_totals IS 'Order totals from the order lines.';

COMMENT ON VIEW edge_cases.v_customer_ltv IS 'Lifetime value per customer.';

COMMENT ON VIEW edge_cases.v_product_revenue IS 'Revenue per product; products 1 to 5 tie exactly at the top.';

COMMENT ON MATERIALIZED VIEW edge_cases.mv_daily_sales IS 'Orders, units and revenue per UTC day, refreshed when the sample is seeded.';

DROP FUNCTION edge_cases.h(text);

ANALYZE edge_cases.customers;

ANALYZE edge_cases.products;

ANALYZE edge_cases.orders;

ANALYZE edge_cases.order_lines;
