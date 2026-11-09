# BA-306 seed facts: the US Health fixture

Facts of `backend/src/modules/testing-data/fixtures/004_us_health.sql.gz`, computed from the committed file.

- Schema `us_health`: 41 tables and 4 views (`v_monthly_cost`, `v_large_claimants`, `v_lad_loss_ratio`, `v_client_revenue`).
- Declared foreign keys (`ADD CONSTRAINT "fk_`): 55.
- Total rows: 713,760.
- Size: 12,088,897 bytes (gzipped).
- sha256: `4a7f15ee1ad9e4f86283c0f7f1fed8d7227a677b333093acb37309bfd8d7e53d`

## Rows per table

| Table | Rows |
| --- | ---: |
| `offices` | 22 |
| `service_lines` | 11 |
| `colleagues` | 180 |
| `clients` | 60 |
| `engagements` | 313 |
| `revenue` | 9,698 |
| `deliverables` | 1,424 |
| `carriers` | 34 |
| `plans` | 1,496 |
| `plan_provisions` | 1,496 |
| `plan_rates` | 5,880 |
| `renewals` | 882 |
| `stop_loss_contracts` | 247 |
| `employees` | 8,100 |
| `members` | 18,225 |
| `enrollments` | 21,924 |
| `medical_claims` | 348,950 |
| `rx_claims` | 156,774 |
| `benchmark_sources` | 8 |
| `peer_groups` | 118 |
| `benchmark_measures` | 40 |
| `benchmark_values` | 12,508 |
| `surveys` | 14 |
| `survey_questions` | 420 |
| `survey_respondents` | 4,457 |
| `survey_responses` | 105,568 |
| `survey_comments` | 3,411 |
| `survey_norms` | 120 |
| `lad_programs` | 1,302 |
| `lad_experience` | 972 |
| `disability_claims` | 2,129 |
| `leave_cases` | 4,757 |
| `state_leave_laws` | 14 |
| `client_leave_policies` | 267 |
| `client_goals` | 240 |
| `trend_assumptions` | 30 |
| `strategy_options` | 521 |
| `roadmap_items` | 908 |
| `point_solutions` | 24 |
| `client_point_solutions` | 180 |
| `data_feeds` | 36 |
| **Total** | **713,760** |

## Regenerate and verify

```
python3 scripts/generate-us-health-seed.py && shasum -a 256 backend/src/modules/testing-data/fixtures/004_us_health.sql.gz
```

The hash must equal the sha256 above. The generator is deterministic, so a rerun leaves the seed unchanged.
