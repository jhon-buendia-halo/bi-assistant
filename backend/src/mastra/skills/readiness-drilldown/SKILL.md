---
name: readiness-drilldown
description: Use when the user asks to see the records behind a readiness finding, or asks a data-quality question about the session's data (which rows are null, invalid, inconsistent, duplicated, orphaned, stale or unreasonable) — the SQL recipe per dimension and how to present the rows.
---

# Readiness drill-down

Tools for this skill: [[tool:describe_entity]], [[tool:run_readonly_sql]].

## Before the query
1. Find the table and the column: from a finding in a report read in this conversation (its entity and field), or from the user's words. When the user names a column but not its table and no report has been read yet, call get_readiness_report for the dataset and take the entity from the finding on that column. Never search information_schema for it. If the table is still unclear, ask.
2. Name the table as the dataset stores it: the "named like" key of its dataset in the orientation block shows the form (catalog.schema.table). A finding's entity is schema.table, so put the same catalog in front of it.
3. The session can hold several datasources: always pass the datasourceId from the dataset's line in the orientation block to describe_entity and run_readonly_sql. Never run a query on every datasource.
4. Call describe_entity on the table for its exact column names, key columns and datasource kind.
5. Write one SELECT in that datasource's dialect: PostgreSQL for postgres, Databricks SQL for databricks. Only read; never write or change anything.

## Recipes
`t` is the table, `c` the column, `k` its key column(s), `id_cols` up to four columns that tell a person which record it is (a name, a title, a date). Return the key columns, then `id_cols`, then the problem column. Add `count(*) OVER () AS total_rows` to a row query so one query gives both the total and the first rows, and end it with `ORDER BY k LIMIT 50`.

- Completeness (missing values): `SELECT k, id_cols, c, count(*) OVER () AS total_rows FROM t WHERE c IS NULL ORDER BY k LIMIT 50`. A count by column: `SUM(CASE WHEN c IS NULL THEN 1 ELSE 0 END)`.
- Validity (values that break their format), always with `c IS NOT NULL AND`:
  - PostgreSQL: `c !~* '<pattern>'`; Databricks: `NOT c RLIKE '(?i)<pattern>'`.
  - Patterns, as the engine uses them: email `^[^@\s]+@[^@\s]+\.[^@\s]+$` (PostgreSQL: `[:space:]` for `\s`), phone `^[+0-9().\s-]{7,}$`, URL `^https?://`, UUID `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`, date-like text `^\d{4}-\d{2}-\d{2}` (PostgreSQL: `[0-9]` for `\d`).
- Consistency (values that differ only by case or spaces): `SELECT lower(trim(c)) AS normalised, count(DISTINCT c) AS variants, min(c) AS example_a, max(c) AS example_b FROM t WHERE c IS NOT NULL GROUP BY lower(trim(c)) HAVING count(DISTINCT c) > 1 ORDER BY variants DESC LIMIT 50`.
- Uniqueness (duplicates): `SELECT k, count(*) AS copies FROM t GROUP BY k HAVING count(*) > 1 ORDER BY copies DESC LIMIT 50`. For the full rows, join this back to `t` on `k`.
- Integrity (orphans): `SELECT ch.*, count(*) OVER () AS total_rows FROM child ch LEFT JOIN parent p ON p.pk = ch.fk WHERE ch.fk IS NOT NULL AND p.pk IS NULL LIMIT 50`.
- Timeliness (stale data): `SELECT max(c) AS newest, min(c) AS oldest, count(*) AS row_count FROM t`; give the newest date and how many days ago it was.
- Reasonability (implausible values): negatives `c < 0`; future dates `c > current_date`; very old dates `c < DATE '1900-01-01'`; percentages `c > 100`; ratios `c > 1`; swapped ranges `start_col > end_col`.
- Accessibility is not a query: the connection cannot read the table. Say so and point to the datasource's grants.

## Present
- Lead with the count: "<n> rows in <table> have no <column>."
- Then a table of up to 20 rows in the answer itself: key, identifying and problem columns, at most six columns. Say how many more there are when total_rows is larger. Do not open query rows with show_in_panel.
- Describe only the rows the query returned. About rows you did not show, give only how many there are; draw no conclusion about records the query did not return (for example which rows are not null, or what the unshown rows contain). Query for them if the user asks.
- When the count differs from the finding's measured value, give both and say the data may have changed since the report was generated. Never recompute, change or replace a score.
- When the query fails, read the error, fix the query and retry once; tell the user only if it still fails.
