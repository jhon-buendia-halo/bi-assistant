---
name: sql-analysis
description: Use when writing the SQL of an analysis — a ranking or top-N that may tie, a ratio or share, a period-over-period comparison, a distinct count across joins, columns with NULLs, or a query for a specific datasource dialect (PostgreSQL, Databricks SQL, SQLite).
---

# SQL analysis patterns

Tools for this skill: [[tool:run_readonly_sql]], [[tool:sample_rows]].

Write one read-only SELECT (or WITH) per call, in the dialect of the entity's datasource, with fully-qualified names. Aggregate in the query; bring back the few rows the answer needs.

## Top-N and ties
- Rank with a window function, not a bare `ORDER BY … LIMIT n`: `RANK() OVER (ORDER BY total DESC) AS rnk`, then keep `rnk <= n` in an outer query. Every row tied at the cut-off comes back.
- When the rows at the cut-off tie, say so and name every tied row ("Brazil and Germany share second place with 18 wins").
- Order by the measure and by a name as a tie-breaker, so the order is stable.
- "Top per group" (best team per tournament): `ROW_NUMBER()` or `RANK() OVER (PARTITION BY group ORDER BY measure DESC)`.

## Ratios and shares
- A ratio needs two different measures: `SUM(goals) * 1.0 / NULLIF(COUNT(DISTINCT match_id), 0)`. Never divide an expression by itself.
- Multiply by `1.0` (or cast to a decimal) before dividing: integer division truncates in PostgreSQL and SQLite.
- Guard the denominator with `NULLIF(…, 0)`.
- A share of the total: `measure * 1.0 / SUM(measure) OVER ()`. Shares of one breakdown add up to 100 %; check that they do.
- Say what the ratio is per ("goals per match", "share of all goals").

## Period over period
- Group by the period (year, quarter, month) and compare with `LAG(measure) OVER (ORDER BY period)`: change = `measure - LAG(…)`, growth = `(measure - LAG(…)) * 1.0 / NULLIF(LAG(…), 0)`.
- Compare like with like: a partial period (the current year, a tournament still running) is not comparable to a full one. Say so, or compare the same span of both.
- Truncate dates per dialect: PostgreSQL and Databricks `date_trunc('month', d)`; SQLite `strftime('%Y-%m', d)`.

## Distinct counts and join fan-out
- `COUNT(DISTINCT key)` counts entities; `COUNT(*)` counts rows. Pick the one the question means.
- A join to a child table repeats the parent row once per child, so `SUM` and `COUNT(*)` over the parent's columns inflate. Aggregate the child first in a subquery or CTE, then join the result, one row per key.
- After a join, compare `COUNT(*)` with `COUNT(DISTINCT parent_key)`: when they differ, the join fanned out.
- Join on the key columns the context's join hints name, not on a guessed name.

## NULLs
- `COUNT(column)`, `SUM`, `AVG`, `MIN` and `MAX` skip NULLs; `COUNT(*)` does not. An average over a column with NULLs is the average of the known values: say so when many are missing.
- `WHERE column <> 'x'` drops the NULL rows too; add `OR column IS NULL` when they belong in the result.
- `NOT IN (subquery)` returns nothing when the subquery holds a NULL; use `NOT EXISTS`.
- Show missing values as a group of their own (`COALESCE(column, '(unknown)')`) rather than hiding them, when they matter to the answer.

## Dialects
- PostgreSQL: `ILIKE` for case-insensitive matching; `::numeric` casts; `date_trunc`, `EXTRACT(YEAR FROM d)`; `FILTER (WHERE …)` on aggregates; identifiers in double quotes.
- Databricks SQL: `catalog.schema.table` names; `lower(c) LIKE` for case-insensitive matching; `date_trunc('MONTH', d)`, `year(d)`; `count_if(cond)`; identifiers in backticks.
- SQLite (REST API datasets): no `ILIKE` (`LIKE` is case-insensitive for ASCII); dates are text, so use `strftime`; no `FULL OUTER JOIN` in older versions; `CAST(x AS REAL)` before dividing.
- Before filtering on a text value, check its exact spelling and case with [[tool:sample_rows]] or the sample values `describe_entity` shows.
