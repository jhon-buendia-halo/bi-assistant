# 1.20.3 — Faster Data Readiness assessments (BA-323)

## Live timing, Databricks `samples` catalog (124 entities), 2026-11-09

| | Before (main, the user's stored run) | After (branch) |
|---|---|---|
| Profiling | ≈ 283 s (assessment 295.6 s incl. engine; whole turn 308 s with the model) | **42.3 s** (profile only, `profileDatabricks` called directly) |
| Score | 91 Managed, 821 findings | 91 Managed, 819 findings |
| Unmeasured tables | ≈ 14, silently (statistics timed out, nothing in the report) | 16 listed: 13 `too-large` (row count > 100 M, e.g. `tpcds_sf1000.store_sales` 2,879,966,589 rows) and 3 `timed-out` (`tpcds_sf1000.web_returns`, `tpch_sf100.customer`, `tpch_sf100.partsupp`) |

Progress during that run (first lines of each 20 entities): `0.0s Listing tables…` → `9.8s Profiling samples.bakehouse.sales_transactions (20/124)…` → … → `41.2s Profiling samples.tpch_sf100.partsupp (124/124)…` → `Checking relationships…`.

A first cut folded normalized distinct counts for every text column into the statistics statement; live it made `tpch.lineitem` go from 0.54 s to 6.29 s and pushed 15 small tables into `timed-out` (91.6 s). They now run as a second statement for the R10 window columns only.

## Scores unchanged on the PostgreSQL samples

`profilePostgres` + `runAssessment` with a fixed `now` (2026-11-09T00:00:00Z) on `main` and on the branch; the JSON files here are byte-identical (`diff` empty):

- World Cup: 94 Managed, 15 entities, 13 findings — [main](scores-main-world_cup.json) / [branch](scores-branch-world_cup.json)
- US Health: 98 Optimised, 45 entities, 52 findings — [main](scores-main-us_health.json) / [branch](scores-branch-us_health.json)

## E2E

[e2e-results.txt](e2e-results.txt): `data-readiness.spec.ts` 6/6, including the new "A table too large to profile is listed as not profiled" (row cap lowered to 20 with `READINESS_MAX_PROFILED_ROWS`).

Not covered: desktop target (not requested).
