---
name: readiness-source-inventory
description: Use when mapping the scope card to the conversation's datasets, or reading D1 (availability and access) — which entities provide each critical field, what assess_readiness measured for D1 and what stays not evaluated.
---

# Source inventory (D1)

Tools for this skill: [[tool:list_entities]], [[tool:describe_entity]], [[tool:run_readonly_sql]].

## Before the assessment
1. List the entities with [[tool:list_entities]] and find the critical entities and fields of the scope card, synonyms included (`client`, `customer`, `account`).
2. For each candidate, read [[tool:describe_entity]]: its columns, types, descriptions, date ranges, declared references and its schema's layer (`landing`, `normalized`, `consumption`).
3. Map each critical field to the entity that provides it. A field with no source is a critical gap.
4. When two entities provide the same data, note a possible conflict and which one is the source of truth, if the requester defined it. If none is defined, that is an escalation.

## What assess_readiness measures for D1
- Whether each dataset resolves and each critical entity answers a `COUNT(*)`: its row count and, with a date column, its date range.
- The owner from `owners` on the scope card: the app keeps no owner metadata, so with no owner named G2 fails and D1 is 1.
- Always not evaluated here: owner metadata and a support channel. Say so under "Scope and method".

## Reading the result
- An entity that does not answer is level 0 and fails G1.
- No owner for a critical dataset: G2 and an escalation.
- Access in this app is programmatic (SQL through the datasource), so a missing owner, not access, usually caps D1.

## Drill-down
When asked "how big is it" or "since when", one aggregate with [[tool:run_readonly_sql]]: `COUNT(*)`, `MIN`/`MAX` of the date column. Never list rows.

## Output
An inventory table (entity, layer, grain, rows, date range, owner) and the map of critical fields to entities, with D1's level and its evidence ids as assess_readiness returned them.
