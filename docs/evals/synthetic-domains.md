# Synthetic eval domains: health insurance, genomics and HR

Design document for the second, third and fourth eval fixtures. It is the single source
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

- One schema per domain: `health_insurance`, `genomics`, `hr`.
- Fixed random seed, so the data is byte-identical on every regeneration and
  every hand-verified answer stays valid.
- Small enough that aggregates come back as a handful of rows, never near the
  500-row cap.
- Real primary and foreign keys, `CHECK` constraints on every status column.
- Two years of data only (HR: seven, see below), ending well before today, so
  no answer depends on the current date.
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

Twenty cases per domain (ten for HR), each tagged, every `expectedSql` verified
against the live fixture with `npm run eval:validate` — zero model calls.
