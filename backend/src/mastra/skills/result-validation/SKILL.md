---
name: result-validation
description: Use when a query has returned and before you answer from it — the sanity checks that catch empty or partial results, totals that do not reconcile, duplicates from joins, outliers and constant values, and questions outside the data's coverage.
---

# Validate a result before answering

Tools for this skill: [[tool:run_readonly_sql]].

Run these checks on every result you are about to answer from. When one fails, fix the query and run it again; when it cannot be fixed, answer with what holds and put the problem in "Caveats". Each check is at most one extra small query, never a reason to stop.

## Empty or partial results
- No rows: check the filter before saying "none". Is the value spelled and cased as stored, is the date range inside the data, is the join dropping rows? Only report "none" once the filter is confirmed.
- The row limit was reached (the result says so): the rows are a sample, not the whole. Re-run as an aggregation, or say the numbers are partial.
- A query that failed is not an empty result: never answer from it.

## Totals that should reconcile
- Parts must add up to the whole: the rows of a breakdown sum to the total of the same measure without the breakdown, and shares sum to about 100 %. When they do not, a filter, a join or NULLs differ between the two queries.
- Two queries that answer the same number the same way must agree. When they disagree, find out why before giving either.

## Duplicates from joins
- After a join, compare `COUNT(*)` with `COUNT(DISTINCT key)` of the entity you count. When they differ, the join fanned out and the sums are inflated: aggregate before joining.
- A ranking that lists the same name twice comes from a join or a grouping on an id that is not unique: group by the key, then join the name.

## Outliers and constant values
- A value far outside the rest (a negative count, a share over 100 %, a year in the future) is usually a query fault or a data problem: check the rows behind it before reporting it as a finding.
- A measure identical on every row — above all 1 or 0 — is a fault in your own query (an expression divided by itself, a count of the grouping key). Fix it before answering.
- A ranking only ranks when the values differ: when everything ties, say so.

## Coverage
- Before an answer that depends on scope (a year, a tournament, a segment), confirm the data holds it: `SELECT DISTINCT` or `MIN`/`MAX` of the scope column.
- When the question asks about something the data does not cover, say what is covered instead, from the data, and stop. Never fill the gap from general knowledge: no real-world totals, scores, winners or background.
- Before sending, check every number, name and date in your answer against a result of this turn. Remove any that came from memory, even when it is correct.
- When your answer covers only part of what was asked (some years missing, a dataset left out), say which part.
