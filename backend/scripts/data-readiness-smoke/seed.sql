-- Data readiness smoke seed (BA-259). Run as a superuser on a fresh database
-- named smokedb. Every defect below is listed with the check it must trip; the
-- expected scores are in smoke.mjs and README.md.

CREATE SCHEMA smoke;

-- customers: declared primary key, 10 rows.
--   nickname  60 % null            -> completeness high
--   region    20 % null            -> completeness medium (1 distinct: no consistency check)
--   email     3 invalid addresses  -> validity medium
--   segment   case/space variants  -> consistency low (5 distinct, 2 normalised)
--   created_at newest 2020-09-15   -> timeliness medium (> 730 days)
--   created_at oldest 1899-06-01   -> reasonability low (before 1900)
CREATE TABLE smoke.customers (
  id integer PRIMARY KEY,
  email text,
  nickname text,
  region text,
  segment text NOT NULL,
  created_at timestamp NOT NULL
);
INSERT INTO smoke.customers VALUES
  (1,  'ann@example.com',  'Annie', 'North', 'Retail',    '2020-01-15'),
  (2,  'bob@example.com',  NULL,    'North', 'retail',    '2020-02-15'),
  (3,  'carl@example.com', 'Carl',  'North', ' Retail ',  '2020-03-15'),
  (4,  'dana@example.com', NULL,    NULL,    'Wholesale', '2020-04-15'),
  (5,  'not-an-email',     'Ed',    'North', 'WHOLESALE', '2020-05-15'),
  (6,  'a@b',              NULL,    'North', 'Retail',    '2020-06-15'),
  (7,  'x y@z.com',        NULL,    'North', 'Retail',    '1899-06-01'),
  (8,  'hal@example.com',  NULL,    NULL,    'Wholesale', '2020-07-15'),
  (9,  'ivy@example.com',  'Ivy',   'North', 'Retail',    '2020-08-15'),
  (10, 'jo@example.com',   NULL,    'North', 'Retail',    '2020-09-15');

-- orders: declared primary key, 8 rows.
--   customer_id  declared FK added NOT VALID, one orphan (999) -> integrity high
--   amount       min -5.00                                      -> reasonability low
--   discount_pct max 150                                         -> reasonability medium (ratio > 100)
--   ordered_at   one row two years in the future                 -> reasonability medium (future)
CREATE TABLE smoke.orders (
  order_id integer PRIMARY KEY,
  customer_id integer,
  amount numeric(10, 2) NOT NULL,
  discount_pct numeric(5, 1) NOT NULL,
  ordered_at timestamptz NOT NULL
);
INSERT INTO smoke.orders VALUES
  (1, 1,   120.00, 10.0,  now() - interval '30 days'),
  (2, 2,    80.50,  0.0,  now() - interval '20 days'),
  (3, 3,    -5.00,  5.0,  now() - interval '10 days'),
  (4, 1,    42.00, 150.0, now() - interval '5 days'),
  (5, 999,  10.00, 20.0,  now() - interval '4 days'),
  (6, 2,    15.00, 15.0,  now() - interval '3 days'),
  (7, 3,    99.99, 25.0,  now() - interval '2 days'),
  (8, 1,    60.00, 30.0,  now() + interval '2 years');
ALTER TABLE smoke.orders
  ADD CONSTRAINT orders_customer_fk FOREIGN KEY (customer_id)
  REFERENCES smoke.customers (id) NOT VALID;

-- events: no declared key, 6 rows.
--   event_id    1 null, 3 distinct -> completeness medium, inferred uniqueness medium (2 duplicates)
--   customer_id 1 null, 4 distinct -> completeness medium, inferred uniqueness medium (1 duplicate),
--               inferred join to customers.id with one orphan (777) -> integrity medium
--   event_year  newest 2019 (no temporal column) -> timeliness medium
CREATE TABLE smoke.events (
  event_id integer,
  customer_id integer,
  event_year integer NOT NULL
);
INSERT INTO smoke.events VALUES
  (1,    1,    2018),
  (2,    2,    2019),
  (2,    3,    2019),
  (3,    777,  2017),
  (3,    NULL, 2019),
  (NULL, 1,    2018);

-- audit_log: the reader may INSERT but not SELECT -> accessibility medium
-- (visible in information_schema, unreadable).
CREATE TABLE smoke.audit_log (id integer PRIMARY KEY, msg text);
INSERT INTO smoke.audit_log VALUES (1, 'boot'), (2, 'login');

-- secrets: no privilege at all -> invisible to information_schema, so it is
-- not in the inventory and not assessed.
CREATE TABLE smoke.secrets (id integer PRIMARY KEY, note text);
INSERT INTO smoke.secrets VALUES (1, 'hidden');

-- The datasource connects as this limited role.
CREATE ROLE smoke_reader LOGIN PASSWORD 'smoke_reader';
GRANT USAGE ON SCHEMA smoke TO smoke_reader;
GRANT SELECT ON smoke.customers, smoke.orders, smoke.events TO smoke_reader;
GRANT INSERT ON smoke.audit_log TO smoke_reader;
