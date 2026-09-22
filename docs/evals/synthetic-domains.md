# Synthetic eval domains: health insurance and genomics

Design document for the second and third eval fixtures. It is the single source
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

- One schema per domain: `health_insurance`, `genomics`.
- Fixed random seed, so the data is byte-identical on every regeneration and
  every hand-verified answer stays valid.
- Small enough that aggregates come back as a handful of rows, never near the
  500-row cap.
- Real primary and foreign keys, `CHECK` constraints on every status column.
- Two years of data only, ending well before today, so no answer depends on the
  current date.
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

Twenty cases per domain, each tagged, every `expectedSql` verified against the
live fixture with `npm run eval:validate` — zero model calls.
