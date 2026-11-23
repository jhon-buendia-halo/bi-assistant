# Insights Analyst complex evals: the Retail Ops sample and the `insights-analyst-retail` set

Plan only (2026-11-22). No code was written and no database was touched to produce it, so **every figure of the data is written `<from reference SQL>`**: the builder fills it by running the reference SQL on the seeded fixture. The roadmap milestone and story ids are assigned by the lead (referred to below as units U1 to U7).

## Goal

Measure Michael (`insights-analyst`) on a set rich enough to feed the future Monitoring "Agent quality" tab (Option A metrics):

| Metric | What the set must give it |
|---|---|
| **pass rate, pass^3** | one unambiguous, code-checkable right answer per case; the truth read with live SQL |
| **tool calls per question, tool error rate** | one-query cases next to cases that need 3 or more queries; quoted or awkward lookups that provoke a failed first query |
| **clarification precision / recall** | 4 cases that MUST end on a clarifying question, each with a near-identical clear twin that must NOT, plus a "did not clarify" check on every answer case |
| **correct refusal / out-of-coverage** | 3 questions the data cannot answer, 1 empty table |
| **latency, cost per question** | a spread: 10 easy, 15 medium, 11 hard |

## Facts (inventory of 2026-11-22)

- Sets of Michael today: `insights-analyst` (11 cases, `v2-`, World Cup, 16 matches) and `insights-analyst-edge` (8 cases, `iae-`, Edge Cases). Both run on `insightsAnalystEvalTarget()` (`insights-analyst.evals.ts:369` lists its `sets` by hand), which runs the WHOLE Answer a Business Question workflow per case; the scored answer is Write answer's, or the clarifying question with one `- <option>` line per option.
- Check vocabulary that exists: built-ins `checks.noToolErrors()`, `checks.didNotCall(name)`, `checks.calledTool(name)`; `insights-analyst-eval-checks.ts`: `ranSuccessfulSql`, `answerNamesAll`, `answerStatesNone`, `answerStatesNumbers`, `hasMarkdownTable`, `usesStoredValue`, `endsOnClarifyingQuestion`; `insights-analyst-edge-checks.ts`: `sqlUsesAny`, `answerKeepsTie`, `answerSaysNoRows`, `answerStatesEachCount`, `aggregatesNeverLists`, `planEntitiesInSql`, `headlineFiguresInRows`; `sql-truth-check.ts`: `sqlTruthCheck({ id, description, sql, compare })` with `answerHasNumber(column?, { tolerance })` (absolute) and `answerMentionsAll(column)`; `judgeRubric`.
- A clarification by **Plan** is not a tool call, so `checks.didNotCall('ask_clarification')` cannot see it. Nothing today says "this answer case was answered, not turned into a question" as a check of its own.
- `answerHasNumber` compares with an absolute tolerance and reads `$3.04 million` as 3.04, so it cannot check a money total.
- Plan's rule (`answer-business-question.prompts.ts:43-48`): clarify only when the **metric or meaning** is undefined ("best", "top", "most valuable", "biggest" with no measure); a fuzzy **scope** is assumed, never asked. The ambiguous cases below are built on that rule.
- Table and column comments do not reach the model, so every question states its measure in words.
- Every sample has its own **database** on the shared server (127.0.0.1:55432, user `world_cup`), with one schema of the same name; the loader creates the database when missing. Seed rules (`registry.spec.ts`, Edge Cases block): no dollar quoting, no `\'`, every object schema-qualified, no `SET search_path`, statements start with `DROP|CREATE|INSERT|ALTER|COMMENT|REFRESH|ANALYZE|UPDATE`, no clock and no unseeded randomness. `005_edge_cases.sql` is 831 lines / 36 KB for 2 million rows; `001_world_cup.sql` is 545 lines of literal rows.

## 1. Dataset design: `retail-ops`

An omnichannel retailer (coffee, tea and kitchen goods) selling in 8 countries and 6 currencies through 24 shops and 3 web shops, 2022-01-01 to 2024-12-31.

| Registry field | Value |
|---|---|
| const / id / name | `RETAIL_OPS` / `retail-ops` / `Retail Ops` |
| seedFile | `007_retail_ops.sql` (plain SQL, hand-maintained, expected 450 to 600 lines; no gzip) |
| schema / database | `retail_ops` / `retail_ops` |
| defaults | `SAMPLE_HOST`, `SAMPLE_PORT`, `SAMPLE_USER`, `SAMPLE_PASSWORD`, `ssl: false` |
| datasourceName / datasetName | `Retail Ops PostgreSQL` / `Retail Ops` |
| description | `An omnichannel retailer in 8 countries and 6 currencies, synthetic data, 2022 to 2024 — orders and lines, returns and refunds, promotions, price history, revenue targets, a fiscal calendar and a web funnel.` |
| requiredTables (19) | `calendar`, `currencies`, `fx_rates`, `regions`, `countries`, `stores`, `product_categories`, `products`, `product_price_history`, `customers`, `promotions`, `orders`, `order_lines`, `order_promotions`, `returns`, `store_targets`, `web_sessions`, `funnel_events`, `loyalty_redemptions` |
| position in `SAMPLE_FIXTURES` | after `WORLD_CUP_MEDALLION`, before `WORLD_CUP_EXCEL` (keeps the existing order assertions true) |

No view on purpose: every trap must be solved in the model's SQL.

### Generation rules

- Start with `DROP SCHEMA IF EXISTS retail_ops CASCADE;` `CREATE SCHEMA retail_ops;` and the helper of Edge Cases, `retail_ops.h(seed text) RETURNS integer` (`SELECT ('x' || substr(md5(seed), 1, 7))::bit(28)::integer`), dropped at the end. Every "h(...)" below is that helper on a text seed (`'o-day-a' || i`).
- Small dimensions (`currencies`, `regions`, `countries`, `stores`, `promotions`, `product_categories`) are literal `INSERT ... VALUES`. Everything else is `INSERT ... SELECT ... FROM generate_series`.
- Generated rows first, then the **planted blocks** (fixed id ranges, listed per table), then the `UPDATE`s, then indexes on every foreign key of `orders`, `order_lines`, `returns`, `funnel_events`, then `ANALYZE` per table, then `COMMENT ON` every table, then `DROP FUNCTION retail_ops.h(text);`.
- Money is `numeric(14,2)`; rates `numeric(12,6)`.

### Tables

Row counts marked `~` depend on the hash and are pinned by the smoke test (U1) once seeded; the others are exact by construction.

**`calendar`** — 1,096 rows, PK `date_key date` (2022-01-01 to 2024-12-31). Columns: `calendar_year int`, `calendar_quarter int` (1-4), `calendar_month int`, `month_name text`, `fiscal_year int`, `fiscal_quarter int` (1-4), `fiscal_period int` (1-12), `is_weekend boolean`.
Trap **fiscal vs calendar**: the fiscal year starts on 1 February and is named after the year it starts in (`fiscal_year = extract(year from date_key - interval '1 month')`; FY2023 = 2023-02-01 to 2024-01-31). FY2021 holds January 2022 only and FY2024 holds 11 months.

**`currencies`** — 6 rows, PK `currency_code char(3)`: USD, CAD, EUR, GBP, JPY, AUD; `currency_name text`.

**`fx_rates`** — 216 rows, PK (`currency_code`, `rate_month date`), `usd_per_unit numeric(12,6)`, one row per currency and month (m = 0..35): USD `1`; CAD `0.74 + 0.002 * (m % 6)`; EUR `1.05 + 0.005 * (m % 7)`; GBP `1.22 + 0.004 * (m % 9)`; JPY `0.0070 + 0.0001 * (m % 5)`; AUD `0.65 + 0.003 * (m % 8)`.

**`regions`** — 3 rows, PK `region_id int`: 1 Americas, 2 EMEA, 3 APAC.

**`countries`** — 8 rows, PK `country_code char(2)`, `country_name`, `region_id` FK, `currency_code` FK: US/United States/1/USD, CA/Canada/1/CAD, DE/Germany/2/EUR, FR/France/2/EUR, ES/Spain/2/EUR, GB/United Kingdom/2/GBP, JP/Japan/3/JPY, AU/Australia/3/AUD.

**`stores`** — 28 rows, PK `store_id int`. Columns: `store_code text UNIQUE` (`US-01`), `store_name text UNIQUE`, `country_code` FK, `channel text` (`retail` | `online`), `city text`, `time_zone text` (IANA), `opened_on date`, `closed_on date NULL`.
Ids 1-24: three retail shops per country in the country order above (1-3 US, 4-6 CA, 7-9 DE, 10-12 FR, 13-15 ES, 16-18 GB, 19-21 JP, 22-24 AU), all opened before 2022. Ids 25, 26, 27: the web shops (`channel = 'online'`) of Americas (US), EMEA (DE) and APAC (JP). Id 28: `Osaka Pop-up` (JP, retail, opened 2024-12-20).
Traps: **closed stores** — store 6 `closed_on = 2023-06-30`, store 17 `closed_on = 2024-03-31` (no order after that date); **a store with no order at all** — store 28; **time zone** — store 19 is `Tokyo Ginza`, `Asia/Tokyo`.

**`product_categories`** — 30 rows, PK `category_id int`, `parent_category_id int NULL` self FK, `category_name text`, `level int` (1-3): 3 departments (1 Coffee, 2 Tea, 3 Kitchen) → 9 categories (3 each) → 18 subcategories (2 each).
Trap **hierarchy** (three joins to roll up) and **a repeated name**: two level-3 rows are both named `Accessories`, one under Coffee and one under Tea.

**`products`** — 104 rows, PK `product_id int`. Columns: `sku text UNIQUE` (`SKU-0001`), `product_name text UNIQUE`, `category_id` FK (always a level-3 row: ids 1-3 are the departments, 4-12 the categories, 13-30 the subcategories; `13 + (product_id - 1) % 18`), `brand text`, `unit_cost_usd numeric(10,2) NULL`, `list_price_usd numeric(10,2)` (the CURRENT price), `launched_on date` (all before 2022 for 1-100), `is_deleted boolean`.
Ids 1-100 generated: base price `8 + h % 140` + `.99`; cost 55% of it. Ids 101-104 planted "hero" products (`Hero Grinder`, `Hero Kettle`, `Hero Stockpot`, `Hero Dripper`), one per department except two in Coffee, brand `Halcyon`, never deleted, with a cost.
Traps: **case/whitespace duplicates** — 8 brands by `id % 8`; brand 0 is Acme, written `'Acme'` (id % 32 = 0), `'ACME'` (= 8), `' acme'` (= 16), `'Acme '` (= 24); the 7 others are spelled one way. **NULL** — `unit_cost_usd IS NULL` for ids 5, 25, 45, 65, 85 (none deleted). **Soft delete** — `is_deleted` for ids 10, 30, 50, 70, 90, 100 (they keep their order lines). **Look-alike columns** — `list_price_usd` here is today's price, `product_price_history.list_price_usd` the price of a period, `order_lines.unit_price` the price paid in local currency.

**`product_price_history`** (slowly changing, type 2) — 148 rows, PK (`product_id`, `valid_from`), `list_price_usd`, `valid_to date NULL` (inclusive last day; NULL = current), `is_current boolean`. Every product has a row from `launched_on`; ids 1-100 with `id % 3 = 0` (33) get a second row from 2023-07-01 (+10%, rounded to cents), and of those `id % 9 = 0` (11) a third from 2024-07-01 (+5%). `products.list_price_usd` equals the `is_current` row.

**`customers`** — 2,015 rows, PK `customer_id int`. Columns: `customer_code text UNIQUE`, `full_name text`, `email text NULL`, `country_code` FK (`h % 8`), `segment text` (`Consumer` 60%, `Small Business` 25%, `Corporate` 15%), `signup_date date`. `full_name` is built so that it is unique for ids 1-2000 (`'<first> <last> <id>'` is NOT acceptable; use a 50 × 40 first/last name grid, `first[(id-1) % 50]`, `last[(id-1) / 50]`).
Traps: **NULL email** — `id % 20 = 0` (100 rows). **Duplicates by case** — ids 2001-2015 repeat customers 1-15: same person, `email` upper-cased, `full_name` with a trailing space, a new `customer_code`; they place no order. **Never ordered** — ids 1901-2000 (the order generator draws from 1-1900) and 2001-2015. `signup_date` is set by an `UPDATE` to the customer's first order date minus `h % 30` days; customers without orders get `date '2022-01-01' + h % 1096`.

**`promotions`** — 12 rows, PK `promotion_id int`, `promotion_code text UNIQUE`, `promotion_name text UNIQUE`, `discount_pct numeric(5,2)`, `starts_on`, `ends_on`.

**`orders`** — 12,373 rows, PK `order_id int`. Columns: `order_number text UNIQUE` (`SO-000001`), `customer_id` FK, `store_id` FK, `ordered_at timestamptz` (UTC instant), `order_date date` (the UTC date of `ordered_at`), `status text` (`completed` | `cancelled` | `pending`), `currency_code` FK (the store's country's), `shipping_fee numeric(10,2)` (local currency; 0 for retail).
Generated, ids 1-12000: day = `greatest(h('o-day-a'||i) % 1096, h('o-day-b'||i) % 1096)` (orders rise through the three years: about 11%, 33%, 56%), `ordered_at = timestamptz '2022-01-01 00:00:00+00' + day * interval '1 day' + (h % 86400) * interval '1 second'`; `customer_id = h % 1900 + 1`; `store_id = h % 27 + 1`, then an `UPDATE` moves an order dated after its store's `closed_on` to the web shop of the store's region; `status`: `h % 20 = 0` → `cancelled`; `h % 20 = 1` and `order_date >= 2024-12-01` → `pending`; else `completed`.
Planted: ids 12001-12365 **hero orders** (below, `order_lines`), all `completed`, dated `2024-01-01 + (n % 360)` at 12:00 UTC, `store_id = 1 + n % 5` (stores 1-5, never closed), `customer_id = 1 + (n * 7) % 1900`. Ids 12366-12370: five `completed` orders at store 19 at `2024-11-30 20:00+00` (1 December in Tokyo). Ids 12371-12373: three `completed` orders at store 19 at `2024-12-31 18:00+00` (1 January 2025 in Tokyo).
Traps: **cancellations and pending** (5% cancelled; pending only in December 2024); **time zone** (`ordered_at` UTC against the store's local date); **look-alike columns** `ordered_at` / `order_date`.

**`order_lines`** — ~30,400 rows, PK `line_id int`, `order_id` FK, `line_number int`, `product_id` FK, `quantity int`, `unit_price numeric(12,2)` (LOCAL currency), `discount_amount numeric(12,2)` (local), `net_amount numeric(14,2)` (local, `quantity * unit_price - discount_amount`), `net_amount_usd numeric(14,2)`.
Generated: orders 1-12000 `CROSS JOIN generate_series(1, 4) k WHERE k <= 1 + h % 4`; `product_id = h % 100 + 1` (never a hero); `quantity = 1 + h % 5`; `unit_price = round(<price history row in effect on order_date> / <fx usd_per_unit of the order's month>, 2)`; `discount_amount = round(quantity * unit_price * (CASE h % 10 WHEN 0 THEN 0.10 WHEN 1 THEN 0.20 ELSE 0 END), 2)`; `net_amount_usd = round(net_amount * usd_per_unit, 2)`.
Planted (one line per hero order): product 101 — 100 orders × quantity 9 = **900 units**; 102 — 85 × 10 = **850**; 103 — 100 × 8 = **800**; 104 — 80 × 10 = **800**. The 8 Tokyo orders get one line each of product 1, quantity 1.
Traps: **ranking tie** on third place by units (103 = 104 = 800; the smoke test asserts no generated product reaches 800 completed units in 2024, expected about 300); **mixed currencies** — summing `net_amount` across countries is wrong, `net_amount_usd` is right; **lines of cancelled orders** are present.

**`order_promotions`** (many-to-many bridge) — ~2,600 rows, PK (`order_id`, `promotion_id`). Generated for orders 1-12000: `h % 8 = 0` → promotion `h2 % 10 + 1`; of those `h % 40 = 0` → a second, different promotion among 1-10. Planted: orders 1-12000 with `order_id % 30 = 0` → promotion 11, `order_id % 30 = 1` → promotion 12 (exactly **400 orders each**).
Traps: **fan-out** — an order with two promotions doubles its lines in a naive join; **tie at the top** — promotions 11 and 12, 400 orders each (assert every promotion 1-10 is below 400).

**`returns`** — ~1,100 rows, PK `return_id int`, `line_id` FK, `returned_at date` (`order_date + 1 + h % 45`, so some fall in the next year), `quantity_returned int` (`1 + h % quantity`: partial returns), `refund_amount_usd numeric(14,2)` (positive, `round(net_amount_usd * quantity_returned / quantity, 2)`), `reason text NULL` (NULL when `h % 6 = 0`, else `damaged`, `wrong item`, `changed mind`, `late delivery`). One return for each line of a `completed` order with `h('ret'||line_id) % 25 = 0`.
Traps: **refunds change a total**; **refund year ≠ order year**; **NULL reason**.

**`store_targets`** — 576 rows, PK (`store_id`, `target_month date`), `target_usd numeric(14,2)`: the 24 retail shops (ids 1-24) × the 24 months of 2023 and 2024. `target_usd = 6000 + 250 * (store_id % 7) + 100 * month_index`.
Trap **coverage gap**: no target for 2022, for the web shops or for store 28.

**`web_sessions`** — 6,000 rows, PK `session_id int`, `store_id` FK (25 + `h % 3`), `customer_id int NULL` (NULL for 60%: anonymous), `started_at timestamptz` (2022-2024, uniform), `device text` (`mobile`, `desktop`, `tablet`).

**`funnel_events`** — ~14,500 rows, PK `event_id int`, `session_id` FK, `stage text` (`visit`, `product_view`, `add_to_cart`, `checkout`, `purchase`), `occurred_at timestamptz`. With `d = h('depth'||session_id) % 100`: every session has `visit`; `d < 60` `product_view`; `d < 30` `add_to_cart`; `d < 15` `checkout`; `d < 9` `purchase`. Duplicates: a session with `h % 7 = 0` and a `product_view` has a second `product_view` row; with `h % 5 = 0` and an `add_to_cart`, a second `add_to_cart` row.
Trap **distinct count**: `count(*)` per stage over-counts; the funnel is `count(DISTINCT session_id)`.

**`loyalty_redemptions`** — **0 rows** (the programme has not started), PK `redemption_id int`, `customer_id`, `redeemed_at timestamptz`, `points int`, `value_usd numeric(10,2)`.

Total about 68,000 rows; the seed should load in a few seconds.

### Conventions the questions rely on

- **NET** = `SUM(order_lines.net_amount_usd)` over lines of orders with `status = 'completed'`, before refunds. Each revenue question says "net revenue in USD from completed orders".
- A year or month with no other word is the calendar one, by `orders.order_date`.
- `S` below is the prefix `retail_ops.retail_ops` (database.schema), as `edge_cases.edge_cases` in the edge set.

## 2. Question set: `insights-analyst-retail`, 36 cases, ids prefixed `iar-`

Shared SQL fragments (define once in the reference module, U3):

```sql
-- CL: completed lines with their order
FROM S.order_lines l JOIN S.orders o ON o.order_id = l.order_id AND o.status = 'completed'
```

Checks every **answer** case carries (29 cases, groups A to P), besides the ones in its row: `checks.noToolErrors()`, `ranSuccessfulSql()`, `answersWithoutClarifying()` (new, 2.1). No `judgeRubric`, no `expectedSql` (the result-set match fails on a rounding or a shape the answer does not need), and not the two cross-step checks of the edge set (`planEntitiesInSql`, `headlineFiguresInRows`): they grade Olivia and Jessica, and this set's pass rate is Michael's answer.

Comparator shorthand: `N(col)` = `answerHasNumber(col)` exact; `P(col)` = `answerHasNumber(col, { tolerance: 0.6 })` for a percentage the reference rounds to 1 decimal; `F(col)` = `answerHasFigure(col)` (new, 2.1); `M(col)` = `answerMentionsAll(col)`. Each is wrapped in `sqlTruthCheck` with id `<case id>-<col>`.

"Naive" is the wrong query the case is built to catch; the smoke test (U1) asserts that it differs from the reference by at least 5% (2 points for a percentage, 1 for a count) so the check can tell them apart.

### A. Simple lookups (easy) — tool calls (floor), latency/cost (floor), pass^3

| id | Question | Reference SQL → expected | Checks |
|---|---|---|---|
| `iar-lookup-stores-germany` | How many stores do we have in Germany? | `SELECT count(*) AS stores FROM S.stores s JOIN S.countries c USING (country_code) WHERE c.country_name = 'Germany'` → **4** (4 by construction) | `N(stores)` |
| `iar-lookup-price-on-date` | What was the list price in USD of the product with SKU SKU-0009 on 15 March 2023? | `SELECT h.list_price_usd AS price FROM S.product_price_history h JOIN S.products p USING (product_id) WHERE p.sku = 'SKU-0009' AND h.valid_from <= date '2023-03-15' AND (h.valid_to IS NULL OR h.valid_to >= date '2023-03-15')` → **52.99 (58.29 from 2023-07-01, 61.20 from 2024-07-01)**. Naive: `products.list_price_usd` (61.20, the price since 2024-07-01) | `sqlTruthCheck` with `answerHasNumber('price', { tolerance: 0.005 })` |

### B. Aggregations — pass^3; naive-SQL trap on the first

| id | Question | Reference SQL → expected | Checks |
|---|---|---|---|
| `iar-agg-net-revenue-2024` (medium) | What was our net revenue in USD from completed orders in 2024? | `SELECT round(sum(l.net_amount_usd), 2) AS net CL WHERE o.order_date BETWEEN date '2024-01-01' AND date '2024-12-31'` → **4,628,067.63**. Naive 1: `sum(net_amount)` (mixed currencies). Naive 2: cancelled and pending included | `F(net)` |
| `iar-agg-orders-per-status` (easy) | How many orders are there in each status? | `SELECT status, count(*) AS orders FROM S.orders GROUP BY 1` → 3 rows **cancelled 623, completed 11,718, pending 32** | `sqlTruthCheck` with `answerStatesEachCount('status', 'orders')` |

### C. Joins across 3 or more tables (medium) — tool calls, pass^3

| id | Question | Reference SQL → expected | Checks |
|---|---|---|---|
| `iar-join-top-region-2024` | Which region had the highest net revenue in USD from completed orders in 2024, and how much was it? | `SELECT r.region_name, round(sum(l.net_amount_usd), 2) AS net CL JOIN S.stores s USING (store_id) JOIN S.countries c USING (country_code) JOIN S.regions r USING (region_id) WHERE o.order_date BETWEEN date '2024-01-01' AND date '2024-12-31' GROUP BY 1 ORDER BY 2 DESC LIMIT 1` → **EMEA, 2,078,542.08** | `M(region_name)`, `F(net)` |
| `iar-join-top-department-units-2024` | Which top-level product category sold the most units in completed orders in 2024? | `SELECT d.category_name AS department, sum(l.quantity) AS units CL JOIN S.products p USING (product_id) JOIN S.product_categories c3 ON c3.category_id = p.category_id JOIN S.product_categories c2 ON c2.category_id = c3.parent_category_id JOIN S.product_categories d ON d.category_id = c2.parent_category_id WHERE o.order_date BETWEEN date '2024-01-01' AND date '2024-12-31' GROUP BY 1 ORDER BY 2 DESC LIMIT 1` → **Coffee, 18,105 units**. The clear twin of `iar-clarify-strongest-category` | `M(department)`, `N(units)` |

### D. Period over period (medium) — pass^3

| id | Question | Reference SQL → expected | Checks |
|---|---|---|---|
| `iar-pop-yoy-net-revenue` | By what percentage did net revenue in USD from completed orders grow from 2023 to 2024? | `SELECT round(100.0 * (sum(l.net_amount_usd) FILTER (WHERE o.order_date >= date '2024-01-01') / sum(l.net_amount_usd) FILTER (WHERE o.order_date < date '2024-01-01') - 1), 1) AS growth_pct CL WHERE o.order_date >= date '2023-01-01'` → **75.7** (positive by construction) | `P(growth_pct)` |
| `iar-pop-orders-nov-dec-2024` | How many completed orders were placed in November 2024 and how many in December 2024? | `SELECT count(*) FILTER (WHERE order_date < date '2024-12-01') AS november, count(*) FILTER (WHERE order_date >= date '2024-12-01') AS december FROM S.orders WHERE status = 'completed' AND order_date BETWEEN date '2024-11-01' AND date '2024-12-31'` → **613 in November, 618 in December (the naive December is 650)**. Naive: December's pending orders counted | `N(november)`, `N(december)` |

### E. Top N per group (hard) — pass^3, tool calls

| id | Question | Reference SQL → expected | Checks |
|---|---|---|---|
| `iar-topn-product-per-department-2024` | For each top-level product category, which product had the highest net revenue in USD from completed orders in 2024? | `SELECT department, product_name FROM (SELECT d.category_name AS department, p.product_name, rank() OVER (PARTITION BY d.category_id ORDER BY sum(l.net_amount_usd) DESC) AS rk CL JOIN <products and the three category levels as above> WHERE <2024> GROUP BY d.category_id, d.category_name, p.product_name) t WHERE rk = 1` → 3 rows **Coffee: Hero Grinder; Kitchen: Birch Skillet; Tea: Cobalt Teapot** (assert exactly 3: no tie) | `M(product_name)`, `hasMarkdownTable(3)` |

### F. Ranking ties (hard) — pass^3

| id | Question | Reference SQL → expected | Checks |
|---|---|---|---|
| `iar-tie-top-3-products-units-2024` | Which are the top 3 products by units sold in completed orders in 2024? | `SELECT product_name, units FROM (SELECT p.product_name, sum(l.quantity) AS units, rank() OVER (ORDER BY sum(l.quantity) DESC) AS rk CL JOIN S.products p USING (product_id) WHERE <2024> GROUP BY 1) t WHERE rk <= 3` → 4 rows: Hero Grinder 900, Hero Kettle 850, Hero Stockpot 800, Hero Dripper 800 (confirm **Hero Grinder 900, Hero Kettle 850, Hero Dripper 800, Hero Stockpot 800**). Naive: `LIMIT 3`. The clear twin of `iar-clarify-top-products` | `M(product_name)` (all four) |
| `iar-tie-most-used-promotion` | Which promotion was used on the most orders, and on how many? | `SELECT promotion_name, orders FROM (SELECT pr.promotion_name, count(*) AS orders, rank() OVER (ORDER BY count(*) DESC) AS rk FROM S.order_promotions op JOIN S.promotions pr USING (promotion_id) GROUP BY 1) t WHERE rk = 1` → 2 rows, 400 each (confirm) | `M(promotion_name)`, `N(orders)` |

### G. Ratios and shares — pass^3; the second also clarification precision

| id | Question | Reference SQL → expected | Checks |
|---|---|---|---|
| `iar-share-online-2024` (medium) | What share of our 2024 net revenue in USD from completed orders came from the online channel? | `SELECT round(100.0 * sum(l.net_amount_usd) FILTER (WHERE s.channel = 'online') / sum(l.net_amount_usd), 1) AS share_pct CL JOIN S.stores s USING (store_id) WHERE <2024>` → **15.9** | `P(share_pct)` |
| `iar-ratio-cancelled-orders` (easy) | What percentage of our orders were cancelled? | `SELECT round(100.0 * count(*) FILTER (WHERE status = 'cancelled') / count(*), 1) AS cancelled_pct FROM S.orders` → **5.0** (5.0). Fuzzy scope (no period): the whole data, never a question back | `P(cancelled_pct)` |
| `iar-ratio-target-attainment-us-01-2024` (hard) | What percentage of its 2024 revenue target did store US-01 reach, measured as net revenue in USD from completed orders? | `SELECT round(100.0 * (SELECT sum(l.net_amount_usd) CL JOIN S.stores s USING (store_id) WHERE s.store_code = 'US-01' AND <2024>) / (SELECT sum(t.target_usd) FROM S.store_targets t JOIN S.stores s USING (store_id) WHERE s.store_code = 'US-01' AND t.target_month BETWEEN date '2024-01-01' AND date '2024-12-01'), 1) AS attainment_pct` → **222.1 (the naive fan-out gives 4.1)**. Naive: joining lines to the 12 target rows before summing (×12 fan-out) | `P(attainment_pct)` |

### H. Cohort and funnel (hard) — pass^3, tool calls, latency

| id | Question | Reference SQL → expected | Checks |
|---|---|---|---|
| `iar-cohort-2022-retained-2024` | Of the customers whose first completed order was in 2022, how many also placed a completed order in 2024? | `WITH f AS (SELECT customer_id, min(order_date) AS first_date FROM S.orders WHERE status = 'completed' GROUP BY 1) SELECT count(*) AS retained FROM f WHERE first_date < date '2023-01-01' AND EXISTS (SELECT 1 FROM S.orders o WHERE o.customer_id = f.customer_id AND o.status = 'completed' AND o.order_date >= date '2024-01-01')` → **910** | `N(retained)` |
| `iar-funnel-cart-to-purchase-2024` | Of the web sessions started in 2024 that added a product to the cart, what percentage went on to purchase? | `SELECT round(100.0 * count(DISTINCT e.session_id) FILTER (WHERE e.stage = 'purchase') / count(DISTINCT e.session_id) FILTER (WHERE e.stage = 'add_to_cart'), 1) AS conversion_pct FROM S.funnel_events e JOIN S.web_sessions w USING (session_id) WHERE w.started_at >= timestamptz '2024-01-01 00:00:00+00' AND w.started_at < timestamptz '2025-01-01 00:00:00+00'` → **28.9 (the naive event count gives 24.4)** (about 30). Naive: `count(*)` (duplicate `add_to_cart` events) | `P(conversion_pct)` |

### I. Distinct-count traps (medium) — pass^3

| id | Question | Reference SQL → expected | Checks |
|---|---|---|---|
| `iar-distinct-buyers-2024` | How many different customers placed at least one completed order in 2024? | `SELECT count(DISTINCT customer_id) AS buyers FROM S.orders WHERE status = 'completed' AND order_date BETWEEN date '2024-01-01' AND date '2024-12-31'` → **1,839 (the naive count gives 6,586)**. Naive: `count(*)` | `N(buyers)` |
| `iar-distinct-emails-ignoring-case` | How many distinct customer email addresses do we hold, ignoring letter case? Leave out customers with no email. | `SELECT count(DISTINCT lower(trim(email))) AS emails FROM S.customers WHERE email IS NOT NULL` → **1,900 (the naive count gives 1,915)** (1,900 by construction). Naive: `count(DISTINCT email)` (+15) | `N(emails)` |

### J. NULLs and an empty table — pass^3; the second also correct refusal

| id | Question | Reference SQL → expected | Checks |
|---|---|---|---|
| `iar-null-products-without-cost` (easy) | How many products that are not deleted have no unit cost recorded? | `SELECT count(*) AS products FROM S.products WHERE NOT is_deleted AND unit_cost_usd IS NULL` → 5 (confirm) | `N(products)` |
| `iar-empty-loyalty-redemptions` (easy) | How many loyalty redemptions were made in 2024, and how many points were redeemed? | `SELECT count(*) FROM S.loyalty_redemptions` → 0 | `answerSaysNoRows('loyalty redemptions')` |

### K. Case and whitespace duplicates (medium) — pass^3, tool calls (value lookup first)

| id | Question | Reference SQL → expected | Checks |
|---|---|---|---|
| `iar-dupes-acme-net-revenue-2024` | What was the net revenue in USD from completed orders of the brand Acme in 2024? The brand is not always typed the same way in the product list. | `SELECT round(sum(l.net_amount_usd), 2) AS net CL JOIN S.products p USING (product_id) WHERE lower(trim(p.brand)) = 'acme' AND <2024>` → **537,662.17 (the naive exact match gives 72,185.31)**. Naive: `brand = 'Acme'` (about a quarter of it) | `F(net)` |

### L. Refunds (hard) — pass^3, tool calls

| id | Question | Reference SQL → expected | Checks |
|---|---|---|---|
| `iar-refunds-net-after-returns-2024` | What was the net revenue in USD from completed orders placed in 2024 after subtracting the refunds for returns of those orders? | `SELECT round((SELECT sum(l.net_amount_usd) CL WHERE <2024>) - (SELECT coalesce(sum(r.refund_amount_usd), 0) FROM S.returns r JOIN S.order_lines l USING (line_id) JOIN S.orders o USING (order_id) WHERE o.status = 'completed' AND <2024 by o.order_date>), 2) AS net_after_refunds` → **4,504,221.11 (the net before refunds, 4,628,067.63, is the naive answer: refunds are 2.68% of it)**. Naive: the net before refunds (refunds filtered by `returned_at` instead of the order year moves the figure by only 0.11%, too little to be a trap; one return per line, so a LEFT JOIN of lines to returns is fine) | `F(net_after_refunds)` with `{ relative: 0.004 }` (refunds are 2.68% of revenue, so the default 1% could not tell the answer from the total before refunds: the smoke test asserts the gap is above 1%) |

### M. Fiscal calendar (medium) — pass^3

| id | Question | Reference SQL → expected | Checks |
|---|---|---|---|
| `iar-fiscal-net-revenue-fy2023` | What was our net revenue in USD from completed orders in fiscal year 2023? | `SELECT round(sum(l.net_amount_usd), 2) AS net CL JOIN S.calendar c ON c.date_key = o.order_date WHERE c.fiscal_year = 2023` → **2,805,113.90 (calendar 2023 gives 2,634,346.57)**. Naive: calendar 2023 | `F(net)` |

### N. Naive SQL gives a wrong answer (hard) — pass^3

| id | Question | Reference SQL → expected | Checks |
|---|---|---|---|
| `iar-naive-tokyo-local-december-2024` | How many completed orders did the Tokyo Ginza store take in December 2024, counting each order on the store's local date? | `SELECT count(*) AS orders FROM S.orders o JOIN S.stores s USING (store_id) WHERE s.store_name = 'Tokyo Ginza' AND o.status = 'completed' AND (o.ordered_at AT TIME ZONE s.time_zone)::date BETWEEN date '2024-12-01' AND date '2024-12-31'` → **27 (the naive `order_date` count gives 25)**. Naive: `order_date` in December (misses the 5 planted on 30 November UTC, counts the 3 planted on 31 December UTC) | `N(orders)` |
| `iar-naive-net-revenue-with-promotion` | What net revenue in USD came from completed orders that used at least one promotion? | `SELECT round(sum(l.net_amount_usd), 2) AS net CL WHERE EXISTS (SELECT 1 FROM S.order_promotions op WHERE op.order_id = o.order_id)` → **1,478,728.97 (the naive join gives 1,783,827.20)**. Naive: `JOIN order_promotions` (orders with two promotions counted twice) | `F(net)` |

### O. Multi-step: one result writes the next query (hard) — tool calls (ceiling), latency/cost (ceiling), pass^3

| id | Question | Reference SQL → expected | Checks |
|---|---|---|---|
| `iar-multistep-top-store-then-product-2024` | Which store had the highest net revenue in USD from completed orders in 2024, and which product sold the most units in that store that year? | `WITH top AS (SELECT o.store_id CL WHERE <2024> GROUP BY 1 ORDER BY sum(l.net_amount_usd) DESC LIMIT 1) SELECT s.store_name, p.product_name CL JOIN top USING (store_id) JOIN S.stores s USING (store_id) JOIN S.products p USING (product_id) WHERE <2024> GROUP BY 1, 2 ORDER BY sum(l.quantity) DESC LIMIT 1` → **Web Shop Americas, Cobalt Herbal Infusion** (assert no tie on either rank) | `M(store_name)`, `M(product_name)` |
| `iar-multistep-stores-above-average-2024` | How many retail stores had a 2024 net revenue in USD from completed orders above the average of the retail stores that sold something in 2024? | `WITH r AS (SELECT o.store_id, sum(l.net_amount_usd) AS net CL JOIN S.stores s USING (store_id) WHERE s.channel = 'retail' AND <2024> GROUP BY 1) SELECT count(*) AS stores FROM r WHERE net > (SELECT avg(net) FROM r)` → **9** | `N(stores)` |

### P. Clear twins of the ambiguous questions (medium) — clarification precision

| id | Question | Reference SQL → expected | Checks |
|---|---|---|---|
| `iar-noclarify-top-store-net-revenue-2024` | Which store had the highest net revenue in USD from completed orders in 2024? | first query of `iar-multistep-top-store-then-product-2024`, selecting `s.store_name, round(sum(...), 2) AS net` → **Web Shop Americas, 311,818.43** | `M(store_name)`, `F(net)` |
| `iar-noclarify-top-5-customers-net-revenue` | Which 5 customers have the highest net revenue in USD from completed orders, over all the data? | `SELECT c.full_name CL JOIN S.customers c USING (customer_id) GROUP BY c.customer_id, c.full_name ORDER BY sum(l.net_amount_usd) DESC LIMIT 5` → 5 names **Rhys Reyes, Hana Wong, Eli Diaz, Quinn Park, Lola Fox** (assert the 5th and 6th differ) | `M(full_name)`, `hasMarkdownTable(5)` |

The other two twins are `iar-join-top-department-units-2024` (C) and `iar-tie-top-3-products-units-2024` (F); `iar-ratio-cancelled-orders` (G) is the fuzzy-scope negative.

### Q. Ambiguous → must clarify (easy) — clarification recall

Checks of each: `scorers: [checks.didNotCall('run_readonly_sql'), checks.noToolErrors()]`, `customChecks: [endsOnClarifyingQuestion()]`. No judge. No reference SQL.

| id | Question | Why it must ask |
|---|---|---|
| `iar-clarify-best-store` | Which store is performing best? | "best" names no measure (net revenue, orders, target attainment, growth) |
| `iar-clarify-most-valuable-customers` | Who are our most valuable customers? | "most valuable" names no measure (revenue, orders, average order value) |
| `iar-clarify-strongest-category` | Which product category is the strongest? | "strongest" names no measure (revenue, units, margin, return rate) |
| `iar-clarify-top-products` | What were our top products in 2024? | "top" names no measure (units against revenue give different products: the heroes lead on units) |

### R. Out of coverage → must say so (medium) — correct refusal

Checks of each: `checks.noToolErrors()`, `answersWithoutClarifying()`, the code check in the row, and a `judgeRubric` with ONE pass condition (written in the row; append nothing else).

| id | Question | Code check | Judge: pass only if |
|---|---|---|---|
| `iar-coverage-net-revenue-2021` | What was our net revenue in USD from completed orders in 2021? | `sqlTruthCheck` id `iar-coverage-2021-not-2022`, sql = NET of 2022 (850,840.80), compare = fails when `answerHasFigure('net')` PASSES (the 2022 total presented for 2021) | the answer says the data holds no 2021 orders and that it starts in January 2022, and gives no 2021 figure |
| `iar-coverage-targets-2022` | What percentage of its 2022 revenue target did store US-01 reach? | `sqlTruthCheck` id `iar-coverage-2022-not-2024`, sql = the attainment of `iar-ratio-target-attainment-us-01-2024` for 2023 and for 2024 (two columns: 128.8 and 222.1), compare = fails when the answer states either percentage (tolerance 0.05) | the answer says there are no revenue targets for 2022 (targets cover 2023 and 2024) and gives no attainment percentage for 2022; stating the store's 2022 revenue is fine |
| `iar-coverage-marketing-spend` | What was our return on advertising spend by channel in 2024? | `answerStatesNone(['ROAS of', 'ROAS was', 'ROAS is'])` | the answer says the data holds no advertising or marketing spend, so the return cannot be computed, and gives no return-on-spend figure; offering revenue by channel is fine |

The "fails when it passes" comparators are written inline in the set file as `(rows, input) => answerHasFigure('net')(rows, input) === undefined ? 'the answer gives the 2022 total as if it were 2021' : undefined`.

### Counts

| Group | Cases | Expected outcome | Difficulty |
|---|---|---|---|
| A lookups | 2 | answer | easy |
| B aggregations | 2 | answer | 1 easy, 1 medium |
| C joins 3+ | 2 | answer | medium |
| D period over period | 2 | answer | medium |
| E top N per group | 1 | answer | hard |
| F ties | 2 | answer | hard |
| G ratios | 3 | answer | 1 easy, 1 medium, 1 hard |
| H cohort / funnel | 2 | answer | hard |
| I distinct | 2 | answer | medium |
| J NULL / empty | 2 | answer (1 "there are none") | easy |
| K case duplicates | 1 | answer | medium |
| L refunds | 1 | answer | hard |
| M fiscal | 1 | answer | medium |
| N naive-wrong | 2 | answer | hard |
| O multi-step | 2 | answer | hard |
| P clear twins | 2 | answer | medium |
| Q clarify | 4 | clarification | easy |
| R out of coverage | 3 | not covered | medium |
| **Total** | **36** | 29 answer, 4 clarification, 3 not covered | 10 easy, 15 medium, 11 hard |

Budget: 36 cases × 3 runs × $0.05 to $0.15 = about $5 to $16 per baseline; sequential, about 36 × 3 × 40 s = 70 minutes.

### 2.1 New check kinds (two, plus a metadata map)

Both go in the new `insights-analyst-retail-checks.ts`; nothing existing changes.

**`answersWithoutClarifying(): EvalCustomCheck`** — id `answers-without-clarifying`, description `The run answered instead of asking a clarifying question`. It fails with `the run ended on a clarifying question: "<first line>"` exactly when `endsOnClarifyingQuestion().run(input)` returns `undefined` (the answer is one question line and 2 to 4 `- ` option lines, nothing else), OR when `toolCalls` holds a call named `ask_clarification`. Otherwise it passes. It is what makes a false clarification visible as a check of its own (clarification precision), instead of only as a failed figure.

**`answerHasFigure(value?: SqlTruthValue, options: { relative?: number; absolute?: number } = {}): SqlTruthComparator`** — the money counterpart of `answerHasNumber`. Readings of the answer: every number `numbersInText` returns, plus, for a number directly followed (optional single space) by a scale token, the scaled value: `k` or `thousand` × 1e3; `m`, `mm`, `mn` or `million` × 1e6; `b`, `bn` or `billion` × 1e9 (case-insensitive; a one-letter token must end at a word boundary, so `5 months` is not 5 million). It passes when a reading `r` has `|r - expected| <= max(absolute ?? 0, (relative ?? 0.01) * |expected|)`. Failure reasons copy `answerHasNumber`'s: `the reference SQL gave no number for <label>` and `expected the answer to state about <expected> (<label> from the reference SQL); the figures in it are <first 12>`. Reuse the scale reading of `headlineFigures` in `insights-analyst-edge-checks.ts` if it can be exported unchanged; do not change its behaviour.

**Case metadata (data, not a check)** — in `insights-analyst-retail-reference.ts` (no framework import): `IAR_CASES: Record<string, { group: 'lookup' | 'aggregation' | 'join' | 'period' | 'top-n' | 'tie' | 'ratio' | 'cohort-funnel' | 'distinct' | 'null-empty' | 'duplicates' | 'refunds' | 'fiscal' | 'naive-wrong' | 'multi-step' | 'clear-twin' | 'clarify' | 'coverage'; expected: 'answer' | 'clarification' | 'not-covered'; difficulty: 'easy' | 'medium' | 'hard'; referenceSql?: string; naiveSql?: string; twinOf?: string }>`. The set file takes its SQL from here; the smoke test runs it; the future Agent quality tab reads `expected` for clarification precision and recall and for the refusal rate. It is not added to `AssistantEvalCase` and not sent over the API in this change.

## 3. Wiring: units of work, in order

Each unit ends with its own green unit tests and one Conventional Commit. U1 → U2 → U3 → U4 are sequential; U5 can run beside U3 and U4; U6 and U7 last.

**U1 — the fixture (Sonnet).**
- New `backend/src/modules/testing-data/fixtures/007_retail_ops.sql` as section 1 specifies. `nest-cli.json` already ships `fixtures/**/*.sql*`.
- New `backend/test/retail-ops-fixture.e2e-spec.ts`, modelled on `backend/test/edge-cases-fixture.e2e-spec.ts`: opt-in (`RETAIL_OPS_SMOKE=1`, `RETAIL_OPS_SMOKE_DB` to name another database), seeds through `readFixtureSql` + `seedInBatches`, then asserts: the row count of all 19 tables; every planted trap (400/400 promotions and every other below 400; hero units 900/850/800/800 and every other product below 800; 5 NULL costs; 6 deleted products; 100 NULL emails; 1,900 distinct lower-cased emails against 1,915 raw; store 28 without orders; no order after a store's `closed_on`; 0 loyalty rows; 5 + 3 Tokyo boundary orders; `products.list_price_usd` = the `is_current` history row for all 104; `net_amount` and `net_amount_usd` consistent with their formula on every line; 2023 → 2024 growth positive); and that two consecutive loads give the same `md5` of `string_agg` over each table's ordered rows.
- Verify: `RETAIL_OPS_SMOKE=1 npx jest --config ./test/jest-e2e.json retail-ops-fixture` in `backend/`, after asking the operator for the target server (hard gate: ask before using the Postgres stack from a worktree; it creates database `retail_ops` only).

**U2 — the registry (Sonnet).**
- `backend/src/modules/testing-data/fixtures/registry.ts`: `RETAIL_OPS` (section 1 table), added to `SAMPLE_FIXTURES` after `WORLD_CUP_MEDALLION`.
- `registry.spec.ts`: a `describe('retail-ops')` block copying the Edge Cases one: the object match, `defaults.database` `retail_ops`, 19 required tables, the `DROP SCHEMA` line, position after `world-cup-medallion`, the no-clock/no-random regex, clean split (allowed first keywords), every statement qualified with `retail_ops`, no `SET search_path`.
- `testing-data.service.spec.ts:549` (the id list) and `frontend/e2e/testing-data.spec.ts:16` (`SAMPLES`: `{ id: 'retail-ops', name: 'Retail Ops', required: 19 }` after the medallion row).
- `assistant-eval-datasets.spec.ts`: one test like "accepts the Edge Cases fixture" for `retail-ops` (19 entities, a missing one named).
- Verify: `npx jest registry testing-data.service assistant-eval-datasets` in `backend/`.

**U3 — the reference module and the checks (Sonnet).**
- New `backend/src/mastra/evals/insights-analyst-retail-reference.ts` (`S`, the `CL` and 2024 fragments, `IAR_CASES` with every `referenceSql` and `naiveSql` of section 2) and its spec: 36 keys, every `expected: 'answer'` entry outside group `null-empty` has a `referenceSql`, every SQL mentions only `retail_ops.retail_ops.` objects, every `twinOf` names an existing `clarify` case, counts per `expected` are 29 / 4 / 3.
- New `backend/src/mastra/evals/insights-analyst-retail-checks.ts` (`answersWithoutClarifying`, `answerHasFigure`) and `insights-analyst-retail-checks.spec.ts`: for each, one real-shaped passing answer and one failing; for `answerHasFigure` the readings `3,041,220.55`, `$3.04 million`, `3.04M`, `3,041k`, `5 months` (not a million), a value outside 1%, `relative: 0.004`.
- Extend the smoke test of U1: every `referenceSql` runs and returns at least one row with no NULL; every `naiveSql` differs from its reference by the margin of section 2; the "assert" notes of section 2 hold (no tie where none is wanted, exactly 4 rows for the tie, 2 for the promotions).
- The builder then replaces each `<from reference SQL>` of this plan's tables and of the spec tables (U6) with the value read, in the same commit.

**U4 — the set and its registration (Sonnet).**
- New `backend/src/mastra/evals/insights-analyst-retail.evals.ts`: `INSIGHTS_ANALYST_RETAIL_EVAL_SET = { id: 'insights-analyst-retail', name: 'Insights Analyst: Retail Ops', description: <one paragraph ending 'Load the "Retail Ops" sample in Settings → Testing Data.'>, fixtureId: 'retail-ops', agentKey: 'insights-analyst', cases }`, the 36 cases of section 2 in the group order A to R, written like `insights-analyst-edge.evals.ts`.
- `insights-analyst.evals.ts:369`: add the set to the target's `sets` (import it next to the edge set).
- `eval-sets.ts`: import it and add it to `EVAL_SETS` after `INSIGHTS_ANALYST_EDGE_EVAL_SET`. No new target, no change to `evalTargetOf`.
- New `insights-analyst-retail.evals.spec.ts` (mocks as in `insights-analyst-edge.evals.spec.ts`): the set is registered and reached by `evalTargetFor('insights-analyst', ids)`; 36 cases; every id starts with `iar-` and is a key of `IAR_CASES` and the reverse; check ids unique per case; every `answer` and `not-covered` case holds `answers-without-clarifying`; every `clarification` case holds `ends-on-clarification` and `didNotCall('run_readonly_sql')`; only the 3 `not-covered` cases have a `judgeRubric`; no case has `expectedSql`; `selectCliEvalCases` picks the set with `EVAL_SET=insights-analyst-retail`.
- `eval-sets.spec.ts` already checks unique ids across sets; fix any count it pins.
- Verify: `npx jest src/mastra/evals` in `backend/`; `npx eslint` on the changed files only; `npm run build` in `backend/`.

**U5 — specs (Sonnet, beside U3/U4; same branch).**
- `specs/capabilities/testing-data/spec.md`: R2 table row for `retail-ops` between the medallion and Excel rows and its description sentence; R3 (database `retail_ops`); a new rule after R4b for `007_retail_ops.sql`; a new section "The Retail Ops sample" with the next free rule id (R27): the table list with row counts and the trap table (trap, where, count), pinned by the smoke test; the Gherkin sample list (`Then I see …`, line 194); a new Acceptance item; the `sources` comment (add `backend/test/retail-ops-fixture.e2e-spec.ts`).
- `specs/capabilities/agents-evals/spec.md`: R11 — add `the insights-analyst-retail set ("Insights Analyst: Retail Ops", PostgreSQL Retail Ops, 36 questions, ids prefixed iar-; listed in agents.md 8.1)` and mention `insights-analyst-edge` beside it if it is still missing there; R10 needs no change (Insights Analyst already has sets); under "Eval suite content" add the `insights-analyst-retail` table (id, question, what must hold) from section 2.
- `specs/system/agents.md` 8.1: a row in the **Sets** table (`insights-analyst-retail` | Insights Analyst: Retail Ops | `retail-ops` (PostgreSQL) | 36, the ids by group, the two new checks, `run with EVAL_DATASETS="Retail Ops" EVAL_SET=insights-analyst-retail`); in the `sqlTruthCheck` paragraph add the comparator `answerHasFigure(column?, { relative?, absolute? })`; one sentence for `answersWithoutClarifying` after the custom-checks paragraph; one sentence for `IAR_CASES` (what a case is expected to end on).
- Then `node scripts/spec-index.mjs` (the index is generated) and `python3 scripts/check-specs.py`.

**U6 — baseline (lead, Opus; needs the operator's yes on model and cost).**
- Load Retail Ops in Testing Data on a fresh copy of the data dir; print the copy's provider and model and agree them with the operator; `EVAL_DATASETS="Retail Ops" EVAL_SET=insights-analyst-retail`, 3 runs per case, at most 6 eval processes.
- For every failed case read `toolCalls[].input/output` and decide model fault against check fault before touching anything. A check fault is fixed in the check or the question's wording (never by loosening a tolerance past the naive margin); a model fault stays red and is the set's finding.
- Record per case: pass in 3 of 3, tool calls, tool errors, duration, cost.

**U7 — ship.** Changelog, evidence (the baseline table), roadmap, retrospective, per the gate skill.

## 4. Risks

1. **The planted figures were never run.** The generator formulas are written, not executed. A tie, a margin or a sign may not come out as planned (for example a generated product reaching 800 units, or refunds below 1% of revenue). The smoke test of U1/U3 is the guard: when an assertion fails the builder changes the named constant (hero quantities, the `% 25` return rate, the `% 40` double-promotion rate), never the question.
2. **Rounded money in the answer.** Jessica may write `$3.0 million` for 3,041,220: 1.3% off, a fail at the 1% default. Whether that is a writer fault or a check fault is the first thing the baseline must settle; the alternative is `relative: 0.02`, which needs every naive margin at 5% or more (already required). `iar-refunds-net-after-returns-2024` cannot be loosened (0.4%).
3. **A percentage check can match a stray number.** `P(col)` passes on any number within 0.6 of the truth, so a year never matches but "5 stores" matches a 5.1% rate. Low for most cases, real for `iar-ratio-cancelled-orders` (about 5%). If the baseline shows it, set that case's tolerance to 0.15 and accept only one-decimal answers.
4. **Clarify recall depends on Plan, not on Michael.** In the whole-workflow target the question for "best store" is normally Olivia's. The metric is then the workflow's, attributed to Michael. `details.steps.plan` tells which step asked; the Agent quality tab should say so or split it.
5. **Out-of-coverage cases keep a judge** (3 of 36). They are the flakiest for pass^3: one pass condition each, and a code check beside it. `iar-coverage-targets-2022` is the most gradable both ways (an answer giving 2022 revenue and "no target" must pass).
6. **Questions that state their measure read as stiff.** "Net revenue in USD from completed orders" is repeated on purpose: comments do not reach the model, and without the words three readings are right. The cost is that the set under-tests metric inference; the four clarify cases cover the other side.
7. **`order_date` is the UTC date.** A model that derives the day from `ordered_at` in a session whose time zone is not UTC gets other month totals. The shared server runs in UTC today; the smoke test should assert `SHOW timezone` is `UTC` or `Etc/UTC`.
8. **Tool error rate may be near zero.** The schema has no awkward names (Edge Cases owns those), so errors come only from guessed stored values (`'online'`, `'completed'`, brand spellings) and wrong column guesses. If the baseline shows none, the rate is measured on `insights-analyst-edge`, not here; do not add quoted names to this fixture for it.
9. **Time and cost.** 108 workflow runs per baseline, about 70 minutes sequential; with base against branch (the gate's comparison) it doubles. The fixture itself is small (about 68,000 rows, no query over 100 ms).
10. **Three places list the samples by hand** (`testing-data.service.spec.ts`, `frontend/e2e/testing-data.spec.ts`, the Gherkin line): a missed one fails the Testing Data Playwright spec, not a unit test, so run that spec in the fast loop.
