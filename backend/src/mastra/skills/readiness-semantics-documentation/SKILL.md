---
name: readiness-semantics-documentation
description: Use when reading or explaining D4 (semantics and documentation) of a readiness assessment — description coverage of the columns and critical fields, schema notes and layers, declared references, cryptic names, and what is not evaluated.
---

# Semantics and documentation (D4)

Tools for this skill: [[tool:describe_entity]].

[[tool:assess_readiness]] measures documentation from the datasets' saved schema and sets D4's level; you read and explain it.

## What assess_readiness measures
| Aspect | Measure |
|---|---|
| Column coverage | Share of columns with a useful description |
| Critical fields | Share of the card's critical fields with a useful description |
| Schema notes | Whether each schema has a description and a layer |
| References | Declared join targets of key columns |
| Names | Cryptic names (`fld_07`, `x_amt2`) |

Always not evaluated here: governed metric definitions and lineage. The app's curated knowledge, when the request carries it, is context, not a governed semantic layer.

## A useful description
Says what the column represents, its unit, how it is computed when derived, and its special cases. "Amount" is not useful; "Net order amount in COP, without taxes or shipping; negative for returns" is.

## Signals
- Under 50 % of the critical fields documented: level 2 at most.
- A critical metric with several definitions in use: a high gap.
- A documented grain that differs from what quality measured: a high gap.
- For an AI agent or RAG use, no machine-readable descriptions also weighs on D6.

## Drill-down
On request, read [[tool:describe_entity]] and list the undocumented critical fields and the cryptic names. No query is needed.

## Output
A coverage table, the undocumented fields and ambiguous terms, and D4's level with its evidence ids, as returned.
