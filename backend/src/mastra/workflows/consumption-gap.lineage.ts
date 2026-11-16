/**
 * Lineage inference for Consumption Gap Analysis (agents.md 5.20, ADR-0051):
 * which column feeds which, layer to layer, when no lineage is declared.
 * Pure code, no framework import.
 *
 * 1. `lineageCandidates`: pairs of columns in adjacent layers (Landing →
 *    Normalized, Normalized → Consumption; Landing → Consumption only when
 *    the run has no Normalized table) whose normalised names match, with a
 *    compatible type family.
 * 2. `overlapQuery`: one read-only statement per candidate whose two
 *    entities share a datasource (Postgres or Databricks): the share of the
 *    target's distinct values found in the source.
 * 3. `lineageFromChecks`: the edges kept, with method, confidence and overlap.
 *
 * CONTRACT STUB: the signatures below are the contract; the bodies are
 * written by the lineage unit.
 */
import type {
  ColumnRef,
  LayerTable,
  Lineage,
} from './consumption-gap-analysis.schemas';
import type {
  GapQuery,
  GapQueryResult,
} from './consumption-gap-analysis.steps';

/** The most candidate pairs checked by a query in one run. */
export const LINEAGE_MAX_CHECKS = 40;

/** A candidate edge before (or without) its value check. */
export interface LineageCandidate {
  from: ColumnRef;
  to: ColumnRef;
  method: 'name' | 'similar-name';
  /** 0 to 1, from the name match and the type families. */
  confidence: number;
}

/**
 * A column or table name reduced to what it means: lower case, layer
 * prefixes (`raw_`, `stg_`, `src_`, `int_`, `dim_`, `fct_`, `fact_`, `agg_`,
 * `v_`) and storage suffixes (`_str`, `_txt`, `_raw`, `_text`) removed.
 */
export function normaliseName(name: string): string {
  void name;
  throw new Error('not implemented');
}

/** Candidate edges, best first, at most `limit` (default 200). */
export function lineageCandidates(
  tables: readonly LayerTable[],
  limit?: number,
): LineageCandidate[] {
  void tables;
  void limit;
  throw new Error('not implemented');
}

/**
 * The value-overlap statements for the candidates worth checking (at most
 * `LINEAGE_MAX_CHECKS`, best first), one per candidate whose two entities
 * share a Postgres or Databricks datasource. Each query's `id` is
 * `lineage-<n>`; its rationale names both columns in plain words.
 */
export function lineageQueries(
  candidates: readonly LineageCandidate[],
  tables: readonly LayerTable[],
): Array<GapQuery & { candidate: LineageCandidate }> {
  void candidates;
  void tables;
  throw new Error('not implemented');
}

/** The edges kept once the checks have run (a failed check keeps the name edge). */
export function lineageFromChecks(
  candidates: readonly LineageCandidate[],
  checks: ReadonlyArray<{
    query: GapQuery & { candidate: LineageCandidate };
    result: GapQueryResult | undefined;
  }>,
): Lineage {
  void candidates;
  void checks;
  throw new Error('not implemented');
}
