---
name: data-readiness
description: Use when assessing a dataset's data readiness or explaining a readiness report — what each DMBOK dimension measures, how scores and bands are computed, and how to present findings.
---

# Data readiness

Tools for this skill: [[tool:assess_data_readiness]], [[tool:get_readiness_report]], [[tool:list_readiness_reports]].

## Run or read
1. Pick the dataset: the one the user names, the only one in the session, or ask.
2. If the user wants a fresh result, or no report exists yet, call assess_data_readiness with that dataset. Otherwise call get_readiness_report for the latest, or with a report id from list_readiness_reports.
3. The scorecard opens in the panel by itself. Your answer summarises it.

## What the dimensions measure
- Completeness: nullable columns with missing values (high at 50 % or more, medium at 10 % or more, low otherwise).
- Validity: email, phone, URL, UUID and date-like text columns with values that do not match their format.
- Consistency: text values that differ only by case or surrounding spaces.
- Uniqueness: duplicate rows on a declared key, or duplicates in an id-like column when no key is declared.
- Integrity: child rows whose foreign key, declared or inferred by name, has no parent.
- Accessibility: tables the connection cannot read.
- Timeliness: tables whose newest record is over 365 days old (medium over 730).
- Reasonability: negative numbers, future or pre-1900 dates, percentages over 100 or ratios over 1, and start/end columns that look swapped.
- Accuracy and currency: not assessed; they need reference data.

## How scores work (for explaining, never for computing)
- A dimension's score is 100 minus the weighted share of its checks that found a problem (high 1.0, medium 0.4, low 0.1).
- The overall score is the mean of the eight assessed dimensions; its band is Optimised 95+, Managed 85+, Defined 70+, Repeatable 50+, else Initial.
- Quote the numbers the tool returned. Never recompute them.

## Present
- Overall score and band first; then the two or three weakest dimensions; then the most severe findings as a table (Severity, Table, Column, Measured, Recommendation).
- Comparing two reports: list both overall scores and the dimensions that moved, from list_readiness_reports and get_readiness_report results only.
