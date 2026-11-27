---
name: readiness-freshness-reliability
description: Use when reading or explaining D3 (freshness and reliability) or gate G6 of a readiness assessment — the age of the newest data against the required freshness, daily volume gaps, and what this app cannot measure.
---

# Freshness and reliability (D3)

Tools for this skill: [[tool:run_readonly_sql]].

[[tool:assess_readiness]] measures freshness and sets D3's level and G6; you read and explain them.

## What assess_readiness measures
1. Current freshness: the age, in hours, of the newest value of each critical entity's date columns (`MAX(date)`), against `requiredFreshnessHours`. Older than required fails G6. With no required freshness on the card, G6 is not evaluated, which alone makes the verdict Not ready: the scope card always sets it (readiness-scoping).
2. Volume stability: daily row counts over the last 30 days of data, when a date column exists. Missing days and sudden drops are findings.

## Always not evaluated here
Pipeline runs and SLA compliance, load history, schema change history, backfills and freshness monitoring: the app has no pipeline metadata. Say so; without them D3 cannot reach level 3's "meets the SLA on 95 % of loads" with evidence, and stays capped as the engine says.

## Reading the result
- When the data ends before today, give its last date and its age, with the unit ("the newest order is 9 days old").
- A gap is a measured fact; its cause (a failed load, a holiday, a tracking change) is an inferred risk: say which is which.
- Unannounced schema changes matter most to automated consumers (ML, agents): name it as a risk not evaluated.

## Drill-down
On request, one aggregate with [[tool:run_readonly_sql]]: rows per day for the window asked, or the newest date per segment. Filter by date, never scan all history without need.

## Output
A table per entity (newest date, age, required freshness, gaps in the last 30 days, status of G6) and D3's level with its evidence ids, as returned.
