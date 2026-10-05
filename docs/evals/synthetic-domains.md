# Synthetic eval domains: health insurance, genomics, HR, retail, supply chain and banking

Design document for the second to seventh eval fixtures. It is the single source
of truth for the generators (`docker/postgres/generate/`), the case sets
(`backend/eval/*-set.json`) and the in-app suites
(`backend/src/mastra/evals/suites/`).

Follows the pipeline in *Questions to Insights Evals*, Part 3: design the domain
around its traps, generate rows from a fixed seed, register the dataset, write
one or more questions per trap, verify every reference SQL with zero model
calls, then run the loop.

## Why these two

The World Cup fixture is one small sports domain. Everything the engine has
been measured on so far is a sports question. These two add:

- **Health insurance** — the money-and-status domain most business users
  recognise, with the adjudication vocabulary (`PAID`/`DENIED`) that makes the
  "values written differently" trap unavoidable rather than contrived.
- **Genomics** — a STEM domain where the traps are *semantic*, not just
  structural. A `0/0` genotype is not a carrier; a TPM of 0 is a real
  measurement, not a missing one. These are mistakes a fluent model makes
  because it does not know the field, which is exactly what the World Cup set
  cannot measure.

Both are loaded into the same Docker Postgres as the World Cup fixture, as
additional schemas. No new connector, no new format.

## Shared rules

- One schema per domain: `health_insurance`, `genomics`, `hr`, `retail`,
  `supply_chain`, `banking`.
- Fixed random seed, so the data is byte-identical on every regeneration and
  every hand-verified answer stays valid.
- Small enough that aggregates come back as a handful of rows, never near the
  500-row cap.
- Real primary and foreign keys, `CHECK` constraints on every status column.
- Two years of data only (HR: seven, retail: 27 months, see below), ending
  well before today, so no answer depends on the current date. Supply chain
  and banking state their own as-of date below.
- Analytics views (`v_*`) mirroring the World Cup fixture's convention, so a
  reference query can be readable without a five-table join.

---

# Domain 1 — `health_insurance`

A mid-size regional health plan: members on plans, claims from providers,
adjudication outcomes, denial reasons.

## Tables

| Table | Grain | Notes |
| --- | --- | --- |
| `countries` | one country | `code`, `name` |
| `states` | one state | → `countries` |
| `regions` | one service region | → `states`. Gives the three-hop hierarchy |
| `plans` | one benefit plan | `tier` ∈ BRONZE/SILVER/GOLD/PLATINUM, premium, deductible |
| `members` | one covered member | → `plans`, `regions`; `terminated_on` mostly null |
| `providers` | one provider | `specialty`, `network_status` ∈ IN_NETWORK/OUT_OF_NETWORK |
| `claims` | one claim | → `members`, `providers`, `plans`; the trap-bearing table |
| `claim_lines` | one line on a claim | `units_billed` vs `units_allowed` |
| `denial_reasons` | one reason code | `category` |
| `claim_denials` | one denial | → `claims`, `denial_reasons` |
| `v_claim_financials` | one claim, denormalised | member/provider/plan names + amounts |
| `v_member_claim_totals` | one member | totals, for readable reference SQL |

Money is stored in **cents** as `bigint` (`billed_amount_cents`,
`allowed_amount_cents`, `paid_amount_cents`, `member_responsibility_cents`) —
itself a mild trap, since an answer that reports raw cents as dollars is wrong
by 100×.

## Planted traps

| # | Planted in the data | Failure class | Question that exposes it | Check |
| --- | --- | --- | --- | --- |
| H1 | `billed_amount_cents`, `allowed_amount_cents`, `paid_amount_cents` all look alike | Dividing a number by itself | Which specialties are paid the highest share of what they bill? | Result set |
| H2 | `claims.currency` is always `USD` | A number that never changes | How do claims break down by currency? | Result set + judge |
| H3 | `preauth_code` null on ~95% of claims | Grouping by an empty column | How many claims had a prior authorization on file? | Result set |
| H4 | Two specialties tie on exactly 48 claims | Ties | Which specialties submitted exactly 48 claims? | Result set |
| H5 | Statuses are `PAID`/`DENIED`/`PENDING`/`REVERSED` | Values written differently | How many claims were approved in 2024? | Result set |
| H6 | Claims exist only for 2024 and 2025 | Data that is not there | What did we pay out in 2019? | Judge |
| H7 | "Most expensive member" is undefined (billed? allowed? paid? member responsibility?) | Asking, or not asking | Who is our most expensive member? | Tool check + judge |
| H8 | Claims reference `member_id` only | Ids instead of names | Which member had the most claims? | Result set (names) |
| H9 | Net paid = paid − reversed, defined in Knowledge | Metric definition | What was net paid by region in 2024? | Result set |
| H10 | `is_test` claims flagged, excluded by a default filter | Default filter | How many claims did we receive in March 2024? | Result set |
| H11 | region → state → country | Multi-step join | What did we pay per country? | Result set |
| H12 | Pure schema question | Discovery | What data do we have about denials? | Did not run SQL |
| H13 | Amounts are cents, not dollars | Unit confusion | What was the average paid amount per claim, in dollars? | Result set |
| H14 | `units_billed` ≥ `units_allowed` on lines | Ratio, second column pair | Which procedure codes had the most units cut on review? | Result set |

## Deliberate distractors

- `claims.status = 'REVERSED'` rows carry a **positive** `paid_amount_cents`
  that must be subtracted, not summed, for net paid (trap H9).
- `members.terminated_on` is non-null for ~8% of members, so "active members"
  is a real filter, not a formality.
- One provider has `network_status = 'OUT_OF_NETWORK'` and the highest average
  billed amount — a plausible-looking but wrong answer to "our most expensive
  provider" if allowed amount is what was meant.

---

# Domain 2 — `genomics`

A clinical-genomics cohort: subjects, sequenced samples, called variants,
gene-level expression, phenotype annotations.

## Tables

| Table | Grain | Notes |
| --- | --- | --- |
| `superpopulations` | one superpopulation | `code`, `name` |
| `ancestry_groups` | one ancestry group | → `superpopulations`. Three-hop hierarchy |
| `genes` | one gene | `hgnc_symbol`, `ensembl_id`, chromosome, coordinates, `biotype` |
| `transcripts` | one transcript | → `genes`; `is_canonical` |
| `subjects` | one study subject | → `ancestry_groups`; `affected_status` |
| `samples` | one sequenced sample | → `subjects`; `assay` ∈ WGS/WES/PANEL; `is_control` |
| `variants` | one variant | → `genes`; `clinical_significance`, `assembly`, `rsid` |
| `variant_calls` | one variant in one sample | `genotype`, `alt_read_count`, `total_read_count`, `filter_status` |
| `gene_expression` | one gene in one sample | `raw_count`, `tpm` |
| `phenotypes` | one HPO term | `hpo_code`, `name` |
| `subject_phenotypes` | subject ↔ phenotype | |
| `v_variant_calls` | one call, denormalised | gene symbol + significance + sample |
| `v_sample_qc` | one sample | coverage and call counts |

## Planted traps

| # | Planted in the data | Failure class | Question that exposes it | Check |
| --- | --- | --- | --- | --- |
| G1 | `alt_read_count` and `total_read_count` look alike; `read_depth` duplicates the total | Dividing a number by itself | Which genes show the highest average alternate-allele fraction? | Result set |
| G2 | `variants.assembly` is always `GRCh38` | A number that never changes | How do variants split across genome assemblies? | Result set + judge |
| G3 | `rsid` null on ~90% of variants | Grouping by an empty column | How many variants have a dbSNP identifier? | Result set |
| G4 | Two genes tie on exactly 7 pathogenic variants | Ties | Which genes carry exactly 7 pathogenic variants? | Result set |
| G5 | Significance is `PATHOGENIC`/`LIKELY_PATHOGENIC`/`VUS`/`LIKELY_BENIGN`/`BENIGN` | Values written differently | How many damaging variants did we find? | Result set |
| G6 | Samples collected 2023–2024 only | Data that is not there | How many samples did we sequence in 2015? | Judge |
| G7 | "Most important gene" is undefined | Asking, or not asking | Which gene matters most in this cohort? | Tool check + judge |
| G8 | `variant_calls` reference `gene_id` via `variants` | Ids instead of names | Which gene is called most often? | Result set (symbols) |
| G9 | Allele fraction defined in Knowledge as alt/total on PASS calls with depth ≥ 20 | Metric definition | What is the mean allele fraction per gene? | Result set |
| G10 | `is_control` samples excluded by a default filter | Default filter | How many samples do we have for the cohort? | Result set |
| G11 | ancestry group → superpopulation | Multi-step join | How many subjects per superpopulation? | Result set |
| G12 | Pure schema question | Discovery | What expression data do we have? | Did not run SQL |
| **G13** | **`genotype = '0/0'` is homozygous reference — not a carrier** | **Domain semantics** | **How many samples carry a pathogenic variant?** | **Result set** |
| **G14** | **`tpm = 0` on ~40% of gene/sample pairs — a real measurement, not a null** | **Zero-inflation** | **What is the median expression of each gene across samples?** | **Result set** |
| G15 | `filter_status = 'LOW_QUAL'` on ~15% of calls | Quality filter | How many high-confidence variant calls do we have? | Result set |

G13 and G14 are the reason this domain exists. Both are answers a fluent model
gets wrong not because the SQL is hard but because it does not know that `0/0`
means "does not have the variant" and that a zero TPM is data. Neither has an
analogue in the World Cup or health-insurance sets.

## Deliberate distractors

- One gene (`BRCA1`) has the most *total* variants but not the most
  *pathogenic* ones, so "the most important gene" has two defensible answers —
  which is what makes G7 a clarification case rather than a lookup.
- `samples.mean_coverage` is a float that reads like a count.
- `variant_calls.read_depth` is populated and equals `total_read_count`, so a
  model reaching for "depth" gets a column that is correct here and would be
  wrong anywhere it diverges — exactly the degenerate-ratio setup of G1.

---

# Domain 3 — `hr`

A mid-size software company's HR records, 2019–2025: 174 workers (145
employees, 16 contractors, 13 interns) in 11 departments across four divisions,
paid from five offices in three currencies. Built for business expert mode: the
user's own example — "What is the average salary of tech employees in 2025?" —
has one right answer here and at least five plausible wrong ones, so the
reasoning trace (which tables, which assumptions, which metric) can be graded
against a known truth, not just the final number.

Generator: `docker/postgres/generate/hr.ts` (seed `20260929`) →
`docker/postgres/init/004_hr.sql`. Dataset name in the app: **HR**. Unlike the
two domains above it spans seven years, because pay history is the point; the
data still ends on 2025-12-31 and nothing is future-dated, so no answer depends
on the current date.

## Tables

| Table | Grain | Notes |
| --- | --- | --- |
| `departments` | one department | `division` ∈ Technology/Commercial/Operations/Corporate, `cost_center` |
| `locations` | one office | Austin and New York (USD), London (GBP), Berlin and Lisbon (EUR) |
| `job_titles` | one title | `family` ∈ Engineering/Data/IT/Sales/Marketing/Support/Finance/People/Legal/Operations, `level` 1–6 |
| `employees` | one worker | → `departments`, `locations`, `job_titles`; `manager_id` → `employees`; `employment_type` ∈ employee/contractor/intern; `terminated_on` null while employed |
| `salary_history` | one pay interval | → `employees`; contiguous, non-overlapping `effective_from`/`effective_to` (exclusive); `annual_base_amount` in local currency; `reason` ∈ hire/merit/promotion/adjustment/market |
| `bonus_payments` | one bonus | → `employees`; `fiscal_year` (the year earned for), `paid_on`, `bonus_type` ∈ annual/spot/retention |
| `performance_reviews` | one rating per employee per year | `rating` 1–5 (5 best), `reviewer_id` = the manager; employees only |
| `time_off_requests` | one request | `kind` ∈ vacation/sick/parental, `days`, `status` ∈ approved/rejected/pending |
| `exchange_rates` | one currency-year | `rate_to_usd`, USD = 1 by CHECK |
| `v_salary_by_year` | one worker per year | the row effective on 31 December of that year, that year's rate, `annual_base_usd` |
| `v_current_employees` | one worker employed at 2025-12-31 | salary in force, converted at the latest year's rate; **all** worker types |

Money is `numeric(12,2)` in the employee's location currency; nobody changes
office, so an employee's salary rows share one currency. Annual bonuses for a
year are paid on 14 March of the next, which puts FY2025's outside the data.

## Planted traps

| # | Planted in the data | Failure class | Question that exposes it | Check |
| --- | --- | --- | --- | --- |
| HR1 | "Tech" is the Technology **division**; four Data-family analysts sit in Finance and Marketing | Domain semantics | What is the average salary of tech employees in 2025? | Result set |
| HR2 | A year's salary is the row effective on 31 December; 23 employees have 2+ rows starting in 2025 | Domain semantics | (same case) | Result set |
| HR3 | Contractors (paid a premium) and interns have salary rows in every division | Default filter | (every average — the tech figure moves from $127,520.61 to $129,799.29) | Result set |
| HR4 | Technology is paid in USD, EUR and GBP; London (GBP) tops the USD averages, New York tops the raw ones | Unit confusion | Which location had the highest average salary in 2025? | Result set |
| HR5 | Engineering and Sales tie on exactly 22 active employees at the end of 2025 | Ties | Which department had the most active employees at the end of 2025? | Result set |
| HR6 | 39 employees have left, 12 of them in 2025 (one hired and gone inside the year) | Metric definition | What was our attrition rate in 2025? | Result set |
| HR7 | Bonus ≠ salary, and a bonus's `fiscal_year` ≠ the year it was paid | Unit confusion / metric definition | How much did we pay out in bonuses for fiscal year 2024, in USD? · What was the average total compensation for Sales employees in 2024? | Result set |
| HR8 | 12 promotions in 2025, each preceded by an April 2025 merit row | Multi-step join | What was the average raise from promotions in 2025? | Result set |
| HR9 | Helena Voss (CTO): 4 direct reports, 37 in her line, 3 levels deep | Asking, or not asking | How many people report to Helena Voss? | Tool check + judge |
| HR10 | Top performer = rating 4 or 5; 7 in Engineering for 2025, one of them a 5 | Domain semantics | Who were the top performers in Engineering in 2025? | Result set |

The generator asserts every one of these and throws if a regeneration drifts:
the exact 22/22 tie and that it breaks under every looser count (contractors
in, all worker types, terminations ignored), that a salary row exists at a
year end exactly when the worker is employed, the division-vs-family and
converted-vs-unconverted gaps (≥ 1% and ≥ 2%), the location winner flipping
without conversion, and the three-level reporting line.

## Deliberate distractors

- Engineering and Sales job families coincide exactly with their departments,
  so "Engineering" (HR10) and "Sales" (HR7) are unambiguous — the only
  family/department mismatch is the Data family (HR1).
- `v_current_employees` is right for 2025 and wrong for any other year (the
  salary in force at the end of the data, the latest year's rate), and it keeps
  contractors and interns.
- Former Principal Engineer Hana Pereira (left 2023-03-31) still has
  `manager_id` = Helena Voss, so a direct-report count without the active
  filter says 5, not 4.
- 2020 was a pay freeze: there are no merit rows that year.

## Curated context

`npm run fixtures:register` seeds, scoped to the HR dataset (seven snippets,
about 1,150 characters as formatted, well inside the 2,000-character knowledge
block):

| Kind | Title | Says |
| --- | --- | --- |
| default_filter | Employees only | Headcount and pay figures cover `employment_type = 'employee'` |
| default_filter | Active as of a date | `hired_on <= date AND (terminated_on IS NULL OR terminated_on > date)` |
| term | Tech employees | The Technology division's departments; job family does not define it |
| term | Salary | Base pay from `salary_history`, bonuses excluded; a year's salary is the row effective on 31 December |
| term | Local currency | Convert with `exchange_rates.rate_to_usd` for the same year (a bonus's `fiscal_year`) |
| term | Top performer | Rating 4 or 5 on the 1–5 scale |
| term | Total compensation | Base salary for the year plus bonuses for that fiscal year |

and three governed metrics: `avg_base_salary_usd` and
`total_compensation_usd` on `hr.salary_history`, `attrition_rate` on
`hr.employees` (terminated during the year ÷ active headcount on 1 January).
These state facts about the data and the company's definitions — none of them
names a figure or an answer.

## The suite

`backend/src/mastra/evals/suites/hr.json` — ten cases, one per question in
the table above, every `expectedSql` hand-verified against the fixture and
every case's `notes` carrying the exact expected figure *and* the figure each
trap produces. Each case also carries `expectedReasoning` (the tables, short
assumption phrases and the metric a correct reasoning trace should show),
which business expert mode is graded against:

```jsonc
"expectedReasoning": {
  "tables": ["hr.employees", "hr.departments", "hr.salary_history", "hr.exchange_rates"],
  "assumptions": ["Technology division", "not contractors or interns", "salary row effective on 31 December", "USD via exchange rate"],
  "metric": "avg_base_salary_usd"
}
```

Assumption phrases are kept to a few words each, because a phrase counts as
covered only when each of its significant words appears in the trace.

---

# Domain 4 — `retail`

A US specialty retailer, 2024-01-01 to 2026-03-31: five stores and a web store,
120 products in eight categories, 1,500 customers, 6,452 orders carrying 14,214
order lines. Built for *learning from feedback*: the demo question — "What was
our net revenue in fiscal year 2025?" — rests on two facts that exist only as
tribal knowledge, the company's fiscal year and what it calls net revenue. The
engine as shipped answers it wrong with a medium confidence; two reviewer notes
on its reasoning trace (the suite's `learningScenario`) should make it answer
right with a high one, and fix a second question they were never written on.

Generator: `docker/postgres/generate/retail.ts` (seed `20260930`) →
`docker/postgres/init/005_retail.sql`. Dataset name in the app: **Retail**.
Fiscal year 2025 (2025-02-01 through 2026-01-31) lies wholly inside the data,
and nothing is future-dated.

## Tables

| Table | Grain | Notes |
| --- | --- | --- |
| `stores` | one store | Austin, Denver, Chicago, Boston, Seattle (region South/West/Midwest/Northeast/West) and the Web Store (region Online, no city) |
| `products` | one product | 15 per category ∈ Apparel/Footwear/Accessories/Home/Beauty/Outdoor/Electronics/Toys; `list_price`, `unit_cost` 45–65% of it |
| `customers` | one customer | `region`, `signed_up_on` (2023-06-01 to 2026-03-31), `loyalty_tier` ∈ bronze/silver/gold |
| `orders` | one order | → `customers`, `stores`; `ordered_at` (the only date), `status` ∈ completed/cancelled, `amount_charged` |
| `order_lines` | one product on an order | → `orders`, `products`; `quantity` 1–3, `unit_price` = the list price, `discount_amount` ≥ 0; unique per order and product |

Money is USD `numeric`. `amount_charged` = merchandise net × (1 + the store's
sales tax) + web shipping ($5.99 when the merchandise is under $75). The tax
rates (6.25–10.25%, 7% online) and the shipping rule exist **only in the
generator** — there is no tax or shipping column, no view and no fiscal
calendar table, and the comment on `amount_charged` says only "Amount charged to
the customer at checkout." So `amount_charged` is never net revenue, and nothing
the engine can read says so. The comments stay silent on purpose: a connector
that surfaced column descriptions to the assistant but not to careful mode's
independent verifier would turn a hint into a cross-check disagreement, which
caps confidence at low instead of testing learning.

Volume: orders per month = the year's base (180 in 2024, 235 in 2025, 320 in
2026) × a seasonal weight (January 1.6, February 0.8, …, November 1.35,
December 1.5); the Web Store takes 40% of orders and each physical store 12%;
4% of orders are cancelled; 20% of lines carry a 10–25% discount (35% in
January, November and December); Outdoor lines are picked 1.5× as often in
March–May.

Two parameters are not what the first design said. The 2026 base is 320, not
305: at 305 this seed's January 2025 orders ran larger than January 2026's and
the fiscal and calendar years differed by only 2.2% of net revenue (R2 needs
2.5%). And list prices are moderate (a typical order is about $130), so enough
web orders fall under the free-shipping line for shipping to be a real part of
`amount_charged`; with pricier products the naive answer landed within 5% of the
right one (R3).

## Planted traps

| # | Planted in the data | Failure class | Question that exposes it | Check |
| --- | --- | --- | --- | --- |
| R1 | Every order has a line and `amount_charged` recomputes exactly from its lines, the store's tax and the shipping rule | (integrity) | — | Generator only |
| R2 | FY2025 is 2025-02-01 to 2026-01-31, named for the year it starts: net revenue $401,306.11 vs $389,641.99 for calendar 2025 (2.99%) | Domain semantics | What was our net revenue in fiscal year 2025? | Result set |
| R3 | `amount_charged` carries tax and shipping: $436,180.52 over the same orders (+8.69%); the naive answer, calendar 2025 `amount_charged`, is $423,385.36 (+5.50%) | Metric definition | (same) · How much did we charge customers in total in calendar year 2025? | Result set |
| R4 | 124 cancelled orders in FY2025 move net revenue by 4.32% | Default filter | (same) | Result set |
| R5 | Line discounts: gross merchandise $420,780.01, 4.85% above net | Metric definition | (same) | Result set |
| R6 | The fiscal year moves counts too: 3,068 completed orders vs 2,934 in calendar 2025; 124 cancelled | Domain semantics | How many orders did we take in fiscal year 2025? | Result set |
| R7 | Outdoor sells the most units in March 2025 (92 vs Footwear 82), cancelled orders in or out; Electronics wins on revenue | Control | Which product category sold the most units in March 2025? | Result set |
| R8 | 530 sign-ups in calendar 2025, 518 in FY2025 | Control | How many new customers signed up in 2025? | Result set |
| R9 | Unique store, product and customer names, SKUs, order and customer numbers | (integrity) | — | Generator only |
| R10 | The five candidate answers to the trap question (correct, calendar `amount_charged`, fiscal `amount_charged`, calendar net, fiscal net with cancelled) differ at 6 significant digits | (integrity) | — | Generator only |

The generator asserts every one of these with the thresholds above (R2 ≥ 2.5%,
R3 ≥ 8% and ≥ 5%, R4 ≥ 1.5%, R5 ≥ 2%, R6 ≥ 2.5% and ≥ 100 cancelled, R7 lead
≥ 1.05×, R8 ≥ 300 sign-ups) and throws if a regeneration drifts. It prints the
correct figure and every trap figure per case; those numbers are in each
case's `notes`.

## Deliberate distractors

- `unit_price` always equals the product's `list_price`, so revenue from
  `products.list_price` gives the gross figure (R5), not a different one.
- The other retail convention — a fiscal year named for the year it *ends*
  (2024-02-01 to 2025-01-31) — gives $313,678.02, and the reviewer's note rules
  it out explicitly.
- Summing `amount_charged` after joining `order_lines` repeats each order once
  per line ($1,225,732.60 for FY2025).
- The Web Store is 40% of the business and alone pays shipping, so the
  `amount_charged` gap differs by store (net-revenue-by-store-fy2025).

## Curated context

`npm run fixtures:register` seeds five snippets scoped to the Retail dataset —
facts about the data only, and **no metric**:

| Kind | Title | Says |
| --- | --- | --- |
| default_filter | Completed orders only | Revenue, order counts and units cover `status = 'completed'`; cancelled orders never count unless asked |
| term | Order date | `ordered_at` is the only date on an order and the one every period question uses |
| term | Units | `order_lines.quantity`; one line per product |
| term | Line discount | `order_lines.discount_amount` is the money off that line, 0 when none |
| instruction | Coverage | Orders run 2024-01-01 to 2026-03-31; amounts in USD |

Neither the fiscal year nor the definition of net revenue is seeded: they are
the tribal knowledge the demo teaches, and seeding either would answer the
trap question before anyone taught it (the overfitting rule, applied from the
other side).

## Why the trap lands in the medium band

Before learning, the interpretation terms ("fiscal year 2025", "net revenue")
and the assumptions (calendar year, `amount_charged` as revenue) can only carry
the basis `convention` or `assumption`, so `knowledge_coverage` is 0 and
`assumption_load` at most 1: interpretation ≈ 0.2–0.4, assumptions ≈ 0.3–0.5,
metric ≈ 0.45, while data selection and SQL stay ≈ 0.98 — overall ≈ 0.68–0.74,
medium. After the two notes become knowledge, each of those bases is
`knowledge` with a matching `sourceRef`, every block scores ≥ 0.95 and the
answer is high. If careful mode's cross-check disagrees before learning the
answer is capped at 0.5 (low, not medium); the demo warns rather than fails.

## The suite

`backend/src/mastra/evals/suites/retail.json` — six cases, every
`expectedSql` hand-verified against the fixture:

| Case | Category | Right answer | Role |
| --- | --- | --- | --- |
| `net-revenue-fy2025` | domain-semantics | $401,306.11 | The trap; carries the `learningScenario` |
| `orders-fy2025` | domain-semantics | 3,068 | Generalisation: fixed by the fiscal-year note, no note of its own |
| `top-category-units-march-2025` | control | Outdoor (92 units) | Neither lesson applies |
| `gross-charged-cy2025` | control | $423,385.36 | The revenue lesson must not ban `amount_charged` everywhere |
| `new-customers-2025` | control | 530 | A plain year stays the calendar year |
| `net-revenue-by-store-fy2025` | domain-semantics | Web Store $162,611.53 … (six rows) | Both lessons, grouped |

The trap's `learningScenario` holds the two reviewer notes verbatim (one on the
`interpretation` block, one on `metric`, both voted down), `generalisesTo:
["orders-fy2025"]`, and the band expectation `before: medium`, `after: high` —
reported, not enforced, by `run-eval`. The loader rejects unknown keys, an
empty `comments` list, a block kind or vote the feedback endpoint would not
accept, and a `generalisesTo` id that is not another case of the suite or that
carries notes of its own.

---

Domains 5 and 6 add a business-operations pair — supply chain and banking —
so the suite is not only sports and clinical data.

# Domain 5 — `supply_chain`

A fictional industrial distributor, Halden Industrial Supply, seen from the
inbound-purchasing side only: suppliers, a product catalogue bought in case
packs, warehouses by region, purchase orders and their lines, shipments,
inspection receipts, month-end inventory snapshots. Generated by
`docker/postgres/generate/supply-chain.ts` (seed `20260928`); the data is as of
2025-12-31.

## Tables

| Table | Grain | Notes |
| --- | --- | --- |
| `regions` | one region | NA-WEST, NA-EAST, EMEA, APAC |
| `warehouses` | one warehouse | → `regions` (2/2/2/1). The receiving end of every purchase order |
| `suppliers` | one supplier | `tier` ∈ STRATEGIC/PREFERRED/APPROVED/CONDITIONAL, `incoterm`, `standard_lead_time_days` |
| `product_categories` | one category | Packaging, Fasteners, Electronic Components, Safety Equipment, Chemicals, Hand Tools |
| `products` | one SKU | → `product_categories`; `case_pack_qty` (1–500), `unit_of_measure` always `EA` |
| `carriers` | one carrier | two road, one rail, two sea, one air |
| `purchase_orders` | one PO | → `suppliers`, `warehouses`; six statuses, `promised_on`, `is_test`; the trap-bearing table |
| `purchase_order_lines` | one line on a PO | → `products`; `cases_ordered` (cases, not units), `unit_price_cents` per each |
| `shipments` | one shipment | → `purchase_orders`, `carriers`; `mode`, `expected_on` (carrier ETA), `delivered_on`, freight vs goods value |
| `receipts` | one received lot | → `shipments`, `purchase_order_lines`; `units_received` vs `units_accepted`, `qc_status` |
| `inventory_snapshots` | one warehouse × product × month-end | `on_hand_units`, `allocated_units`; point-in-time balances |
| `v_purchase_order_lines` | one line, denormalised | PO status/dates, supplier, warehouse, region, product; no computed units column |
| `v_shipments` | one shipment, denormalised | PO dates and status, supplier, warehouse, region, carrier |
| `v_receipts` | one receipt, denormalised | shipment, PO, supplier, product, case pack, warehouse |

Money is stored in **cents** as `bigint` (`unit_price_cents`,
`line_total_cents`, `unit_cost_cents`, `freight_cost_cents`,
`goods_value_cents`), and order quantities are **cases** while receipts and
inventory count **units** — two unit traps before any business rule applies.

## Planted traps

| # | Planted in the data | Failure class | Question that exposes it | Check |
| --- | --- | --- | --- | --- |
| S1 | `units_accepted` vs `units_received` on receipts; `freight_cost_cents` vs `goods_value_cents` on shipments | Dividing a number by itself | Of the units we received from each supplier that have been inspected, what share was accepted? | Result set |
| S2 | `products.unit_of_measure` is always `EA` | A number that never changes | How do our products break down by unit of measure? | Result set + judge |
| S3 | `tracking_number` null on ~93% of shipments (air only) | Grouping by an empty column | How many shipments have a tracking number on file? | Result set |
| S4 | Two suppliers tie on exactly 41 purchase orders, the minimum | Ties | Which suppliers appear on exactly 41 of our purchase orders? | Result set |
| S5 | Statuses are `DRAFT`/`ISSUED`/`PARTIALLY_RECEIVED`/`RECEIVED`/`CLOSED`/`CANCELLED`; "open" = ISSUED + PARTIALLY_RECEIVED | Values written differently | How many purchase orders are currently open? | Result set |
| S6 | Purchase orders exist only for 2024 and 2025 | Data that is not there | How much did we order from suppliers in 2022? | Judge |
| S7 | "Biggest supplier" is undefined (PO count? committed spend? units received?) — three different suppliers | Asking, or not asking | Who is our biggest supplier? | Tool check + judge |
| S8 | Order lines reference `product_id` only | Ids instead of names | Which product appeared on the most purchase order lines in 2024? | Result set (names) |
| S9 | On-time = `delivered_on` ≤ the PO's `promised_on`; the carrier ETA `expected_on` is the lookalike | Metric definition | What was each supplier's on-time delivery rate for shipments delivered in 2025? | Result set |
| S10 | `is_test` sandbox POs (~2%), 9 of them in January 2025, excluded by a default filter | Default filter | How many purchase orders were raised in January 2025? | Result set |
| S11 | shipments → purchase_orders → warehouses → regions | Multi-step join | How many shipments were delivered to each of our regions in 2025? | Result set |
| S12 | Committed spend excludes DRAFT and CANCELLED POs, defined in Metrics | Metric definition | What was our committed purchase spend by supplier tier for orders raised in 2024? | Result set |
| S13 | Inventory snapshots are month-end point-in-time balances | Domain semantics | How many units did each warehouse have on hand at the end of 2024? | Result set |
| S14 | Lines order cases; units = `cases_ordered` × `case_pack_qty` (24 for the featured product) | Unit confusion | How many units of Anti-Fog Safety Glasses did we order in 2024? | Result set |
| S15 | `qc_status = 'PENDING'` receipts are uninspected (~12% of receipts) | Quality filter | What share of the receipts we took in during 2025 failed inspection, as a percentage? | Result set |

S1's two column pairs, S9's two dates and S14's cases-versus-units are the
reasons this domain exists: each is a pair of plausible columns where the
wrong one returns a confident, well-formed and wrong answer. The generator
plants every answer deterministically and asserts it (the 41/41 tie, the three
"biggest supplier" winners each ≥ 10% clear, a 0.0125-step acceptance ladder,
per-mode freight shares, a ≥ 3-point promise-vs-ETA gap per supplier), with and
without the test purchase orders.

## Deliberate distractors

- `products.unit_cost_cents` is a standard cost; what was agreed on an order is
  `purchase_order_lines.unit_price_cents`, and the two differ on 2,135 of the
  2,406 lines.
- `suppliers.standard_lead_time_days` reads like the delivery promise, but the
  promise is `purchase_orders.promised_on`, set per order and route.
- `shipments.expected_on` (the carrier ETA) sits next to `delivered_on` and is
  the tempting denominator date for on-time delivery (trap S9).
- Suppliers on DDP terms ship with `freight_cost_cents = 0` — the supplier paid
  the carrier — which is a real cost of zero, not a missing value.
- Three suppliers were onboarded in 2022: master-data dates that must not be
  read as 2022 purchasing history (trap S6).

---

# Domain 6 — `banking`

A fictional US retail bank, "Meridian Trust Bank": customers in three
segments, deposit and credit accounts held at branches in four regions, the
cards on those accounts, every transaction booked on them, loans and their
payments — plus a handful of EUR and GBP deposit accounts and the monthly FX
rates that convert them. Generated by `docker/postgres/generate/banking.ts`
(seed `20260929`) into `docker/postgres/init/007_banking.sql`.

## Tables

| Table | Grain | Notes |
| --- | --- | --- |
| `regions` | one region | `code` (NORTHEAST/SOUTHEAST/MIDWEST/WEST), `name` |
| `branches` | one branch | → `regions`; 8 branches (3/2/2/1) |
| `customers` | one customer | `segment` ∈ RETAIL/PREMIER/BUSINESS; `home_branch_id` → `branches`; `joined_on` 2015–2024 |
| `account_types` | one product | `category` ∈ DEPOSIT (CHK, SAV, MMA) / CREDIT (CC, LOC); `annual_rate_bps` |
| `accounts` | one account | → `customers`, `account_types`, `branches` (may differ from the home branch); `currency` ∈ USD/EUR/GBP (CREDIT always USD); `status`, `closed_on`, `current_balance_minor` as of 2025-12-31; `is_test` |
| `cards` | one issued card | → `accounts`; DEBIT on checking, CREDIT on credit-card accounts; `network`, `status`, issue/expiry |
| `fx_rates` | one currency per month | EUR and GBP `usd_per_unit`, 2024-01 … 2025-12 |
| `transactions` | one booked transaction | → `accounts` (+ `cards` on card purchases, + counterparty account on transfers); `type`, `direction`, `channel`, `status`; `amount_minor` in the account currency, `amount_usd_minor` converted |
| `loans` | one loan | → `customers`, `branches`; `product` ∈ MORTGAGE/AUTO/PERSONAL; always USD; `principal_minor`, `outstanding_minor`, `status` |
| `loan_payments` | one payment received | → `loans`; `amount_minor` = `principal_minor` + `interest_minor` |
| `v_accounts` | one account, denormalised | customer, segment, product, category, branch, region |
| `v_transactions` | one transaction, denormalised | account, product, category, `is_test`, customer, segment, branch, region |

Money is stored in **minor units** as `bigint` — cents, euro cents or pence,
depending on the account's currency. That is two traps in one column family:
an answer that reports raw minor units as dollars is wrong by 100×, and one
that adds `amount_minor` across currencies mixes three units at once.

Internal transfers are generated as pairs — a `TRANSFER_OUT` on one account and
a `TRANSFER_IN` on its `counterparty_account_id`, same day, amount and status —
and the generator asserts every leg pairs.

## Planted traps

| # | Planted in the data | Failure class | Question that exposes it | Check |
| --- | --- | --- | --- | --- |
| B1 | `loan_payments.interest_minor` / `principal_minor` / `amount_minor`; `loans.outstanding_minor` vs `principal_minor` | Dividing a number by itself | For each loan product, what share of the payments we collected went to interest? (and: what share of the original principal is still outstanding?) | Result set |
| B2 | `loans.currency` is always `USD`, while 17 borrowers also hold EUR or GBP accounts | A number that never changes | How do our loans break down by currency? | Result set + judge |
| B3 | `merchant_category` set only on `CARD_PURCHASE` (~15% of rows) | Counting an empty column | How many transactions have a merchant category recorded? | Result set |
| B4 | Atlanta Midtown and Chicago Loop each opened exactly 12 accounts in 2024; 12 is the maximum, next is 8 | Ties | Which branches opened exactly 12 accounts in 2024? | Result set |
| B5 | Loan status is `CURRENT`/`DELINQUENT`/`DEFAULTED`/`PAID_OFF`/`CHARGED_OFF`; "non-performing" = DELINQUENT + DEFAULTED | Values written differently | How many of our loans are non-performing? | Result set |
| B6 | Transactions exist only for 2024 and 2025; accounts and loans reach back to 2019 | Data that is not there | How many transactions did we process in 2021? | Judge |
| B7 | "Most valuable customer" is undefined — 2025 transaction count, loan principal and USD deposit balances name three different customers | Asking, or not asking | Who is our most valuable customer? | Tool check + judge |
| B8 | Transactions reference `account_id` only; the top card purchaser's purchases are split over two accounts | Ids instead of names | Which customer made the most card purchases in 2025? | Result set (names) |
| **B9** | **Net customer flow excludes internal transfers and non-POSTED rows; a transfer's two legs can sit at different branches, so transfers do not net out per branch** | **Metric definition** | **What was the net customer flow at each branch in 2025?** | **Result set** |
| B10 | `accounts.is_test` sandbox accounts (6 of 200), their traffic concentrated in March 2025 (14 transactions) | Default filter | How many transactions did we record in March 2025? | Result set |
| B11 | accounts → branches → regions; `customers.home_branch_id` is a lookalike path (38 of 200 accounts sit elsewhere) | Multi-step join | How many accounts were opened in each region in 2024? | Result set |
| B12 | Pure schema question | Discovery | What information do we hold about cards? | Did not run SQL |
| B13 | `account_types.category` splits DEPOSIT from CREDIT; every branch holds credit accounts | Domain semantics | How many deposit accounts have been opened at each branch? | Result set |
| **B14** | **`amount_minor` is in the account currency, `amount_usd_minor` is converted at the booking month's `fx_rates` rate (EUR 1.07–1.10, GBP 1.23–1.27)** | **Unit confusion** | **How much did customers deposit in 2025, in US dollars? / How much was deposited into our euro-denominated accounts in 2025, in euros?** | **Result set** |
| B15 | `PENDING` and `REVERSED` card purchases in December 2025 (5 and 3 of 38) | Quality filter | What was our customers' total card spend in December 2025, in US dollars? | Result set |

B12 is the discovery case, numbered the way H12 and G12 are: it plants
nothing in the data, so the generator has no invariant for it.

B9 and B14 are the reason this domain exists. Both are money questions whose
SQL is short and whose failure is invisible in the result: summing every signed
row looks like net flow, and summing `amount_minor` looks like a total — right
on the 88% of accounts that are USD, silently wrong on the rest. The two
currency questions are mirrors of each other, so a fix that always reaches for
`amount_usd_minor` fails the euro one.

## Deliberate distractors

- `customers.home_branch_id` reads like "the customer's branch" and differs
  from `accounts.branch_id` on 38 of the 200 accounts, so region and branch
  figures move when the wrong path is joined (trap B11).
- `amount_minor` and `amount_usd_minor` are identical on USD accounts, so the
  wrong column is only wrong on the EUR and GBP rows — a check on a USD-only
  slice will never catch it (trap B14).
- `CHARGED_OFF` loans carry `outstanding_minor = 0`, the same as `PAID_OFF`
  ones: a written-off loan reads like a repaid one.
- `INTEREST` transactions are interest paid to depositors; interest charged on
  credit accounts is booked as `FEE`, and `account_types.annual_rate_bps` and
  `loans.interest_rate_bps` are rates, not amounts.

---

# Case-set conventions

Both sets live in `backend/eval/` and extend the golden-set format with one
field:

```jsonc
{
  "name": "denied-claims-2024",
  "category": "value-vocabulary",     // NEW — groups verdicts by failure class
  "dataset": "Health Insurance",
  "notes": "Why this case exists and what regression it guards.",
  "question": "How many claims were approved in 2024?",
  "expectedSql": "SELECT ..."
}
```

`category` is one of the failure classes in Part 1 of the eval note:

`ratio-trap`, `constant-column`, `empty-column`, `ties`, `value-vocabulary`,
`out-of-scope`, `clarification`, `id-vs-name`, `metric-definition`,
`default-filter`, `multi-step-join`, `discovery`, `unit-confusion`,
`domain-semantics`, `quality-filter`, `control`.

`control` marks the healthy baseline cases that must keep passing and on which
the guards must stay silent.

Twenty cases per domain (ten for HR, six for retail), each tagged, every `expectedSql` verified
against the live fixture with `npm run eval:validate` — zero model calls.
The registered suites have grown past that since (`backend/src/mastra/evals/suites/`
is the current count); supply chain and banking ship twenty each.
