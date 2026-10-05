/**
 * Business expert mode — deterministic confidence scoring.
 *
 * The model never writes a `Confidence`. Every score here is a weighted mean
 * of named, measured signals, so the reader can see why a block is high or
 * low and the same inputs always give the same number. Three rules:
 *
 * - Missing is not zero. A signal that could not be measured (no cross-check
 *   ran, no terms to cover) is omitted and the remaining weights renormalise.
 * - The model's own estimate (`self_report`) is one low-weight signal among
 *   several: verbalized confidence clusters at 80-100% regardless of
 *   difficulty, so it may nudge a score but never carry it.
 * - Two measured outcomes override the average: an independent re-derivation
 *   that disagrees caps the whole answer at 0.5, a match with a user-approved
 *   verified query floors it at 0.85.
 *
 * Pure: no DI, no I/O. `ExpertModeService` gathers the measurements.
 */
import {
  CONFIDENCE_BANDS,
  GROUNDED_BASES,
  type Confidence,
  type ConfidenceBand,
  type ConfidenceSignal,
  type ConfidenceSignalId,
  type EvidenceBasis,
  type ReasoningBlockKind,
} from './entities/reasoning-trace.entity';

/** What one signal measured: a 0..1 value and the line that explains it. */
export interface Measurement {
  value: number;
  note: string;
}

export type Measurements = Partial<Record<ConfidenceSignalId, Measurement>>;

export const SIGNAL_LABELS: Record<ConfidenceSignalId, string> = {
  schema_grounding: 'Schema grounding',
  join_grounding: 'Join grounding',
  knowledge_coverage: 'Knowledge coverage',
  execution: 'Execution',
  cross_check: 'Independent cross-check',
  verified_match: 'Verified query match',
  assumption_load: 'Assumption load',
  self_report: 'Model self-assessment',
};

/** Which signals feed each block, and how much each one counts. */
export const BLOCK_SIGNAL_WEIGHTS: Record<
  ReasoningBlockKind,
  Partial<Record<ConfidenceSignalId, number>>
> = {
  interpretation: {
    knowledge_coverage: 0.4,
    assumption_load: 0.2,
    self_report: 0.1,
  },
  'data-selection': {
    schema_grounding: 0.35,
    join_grounding: 0.25,
    execution: 0.15,
    cross_check: 0.15,
    self_report: 0.1,
  },
  assumptions: {
    knowledge_coverage: 0.35,
    assumption_load: 0.25,
    self_report: 0.1,
  },
  metric: {
    knowledge_coverage: 0.4,
    cross_check: 0.2,
    verified_match: 0.2,
    execution: 0.1,
    self_report: 0.1,
  },
  sql: {
    cross_check: 0.3,
    execution: 0.25,
    schema_grounding: 0.25,
    verified_match: 0.2,
    self_report: 0.1,
  },
};

/** How much each block counts towards the whole answer's confidence. */
export const OVERALL_BLOCK_WEIGHTS: Record<ReasoningBlockKind, number> = {
  sql: 0.3,
  'data-selection': 0.25,
  assumptions: 0.2,
  interpretation: 0.15,
  metric: 0.1,
};

/** A disagreeing independent re-derivation caps the answer here. */
export const CROSS_CHECK_DISAGREE_CAP = 0.5;
/** A match with a user-approved verified query floors the answer here. */
export const VERIFIED_FLOOR = 0.85;

/** Execution outcome values — see `executionMeasurement`. */
const EXECUTION_CLEAN = 1;
const EXECUTION_REPAIRED_OR_TRUNCATED = 0.75;
const EXECUTION_EMPTY_OR_WARNED = 0.5;
/** Pure guesses at which assumption load bottoms out at 0. */
const GUESSES_AT_ZERO = 3;

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

const clamp01 = (value: number): number =>
  Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;

/** The band a score falls in — `CONFIDENCE_BANDS` is the only source. */
export function bandFor(score: number): ConfidenceBand {
  if (score >= CONFIDENCE_BANDS.high) return 'high';
  if (score >= CONFIDENCE_BANDS.medium) return 'medium';
  return 'low';
}

/** A signal with its label, value clamped and rounded. */
export function makeSignal(
  id: ConfidenceSignalId,
  measurement: Measurement,
  weight: number,
): ConfidenceSignal {
  return {
    id,
    label: SIGNAL_LABELS[id],
    value: round2(clamp01(measurement.value)),
    weight,
    note: measurement.note,
  };
}

/** Σ value·weight / Σ weight over the given signals, 2 decimals, banded. */
export function scoreSignals(signals: ConfidenceSignal[]): Confidence {
  const weight = signals.reduce((total, s) => total + s.weight, 0);
  const score =
    weight > 0
      ? round2(
          signals.reduce((total, s) => total + s.value * s.weight, 0) / weight,
        )
      : 0;
  return { score, band: bandFor(score), signals };
}

/**
 * One block's confidence from the measurements that apply to it. Signals the
 * block does not weigh are ignored; weighed signals that were not measured
 * are omitted (and the rest renormalise).
 */
export function blockConfidence(
  kind: ReasoningBlockKind,
  measurements: Measurements,
): Confidence {
  const weights = BLOCK_SIGNAL_WEIGHTS[kind];
  const signals: ConfidenceSignal[] = [];
  for (const [id, weight] of Object.entries(weights) as [
    ConfidenceSignalId,
    number,
  ][]) {
    const measurement = measurements[id];
    if (measurement) signals.push(makeSignal(id, measurement, weight));
  }
  return scoreSignals(signals);
}

/**
 * The whole answer: the weighted mean of the present blocks' scores
 * (renormalised over the blocks that exist), then the two measured
 * overrides. `signals` is informational — the block-independent evidence the
 * reader should see next to the overall number.
 */
export function overallConfidence(
  blocks: { kind: ReasoningBlockKind; confidence: Confidence }[],
  context: {
    crossCheck?: 'agree' | 'disagree' | 'error';
    verified: boolean;
    signals: ConfidenceSignal[];
  },
): Confidence {
  let weight = 0;
  let total = 0;
  for (const block of blocks) {
    const w = OVERALL_BLOCK_WEIGHTS[block.kind] ?? 0;
    weight += w;
    total += w * block.confidence.score;
  }
  let score = weight > 0 ? total / weight : 0;
  if (context.crossCheck === 'disagree') {
    score = Math.min(score, CROSS_CHECK_DISAGREE_CAP);
  }
  if (context.verified) score = Math.max(score, VERIFIED_FLOOR);
  const rounded = round2(score);
  return { score: rounded, band: bandFor(rounded), signals: context.signals };
}

// ------------------------------------------------------------ measurements

/**
 * How cleanly the final SQL ran: 1 clean; 0.75 auto-repaired or clipped at
 * the row limit; 0.5 zero rows or result-guard warnings; 0 failed / no SQL.
 * The worst applicable outcome wins.
 */
export function executionMeasurement(run: {
  ran: boolean;
  repaired?: boolean;
  truncated?: boolean;
  rowCount?: number;
  warnings?: number;
}): Measurement {
  if (!run.ran) {
    return {
      value: 0,
      note: 'no query ran successfully — the answer is not backed by a result set',
    };
  }
  const rows = run.rowCount ?? 0;
  const problems: string[] = [];
  let value = EXECUTION_CLEAN;
  if (run.repaired) {
    problems.push('auto-repaired after an error');
    value = Math.min(value, EXECUTION_REPAIRED_OR_TRUNCATED);
  }
  if (run.truncated) {
    problems.push('hit the row limit, so the result may be incomplete');
    value = Math.min(value, EXECUTION_REPAIRED_OR_TRUNCATED);
  }
  if (rows === 0) {
    problems.push('returned 0 rows');
    value = Math.min(value, EXECUTION_EMPTY_OR_WARNED);
  }
  if (run.warnings) {
    problems.push(
      `${run.warnings} result-guard warning${run.warnings === 1 ? '' : 's'}`,
    );
    value = Math.min(value, EXECUTION_EMPTY_OR_WARNED);
  }
  const rowNote = `${rows} row${rows === 1 ? '' : 's'}`;
  return {
    value,
    note: problems.length
      ? `ran, but ${problems.join('; ')} (${rowNote})`
      : `ran cleanly — ${rowNote}`,
  };
}

/**
 * Share of the SQL's table and column references that exist in the
 * session's datasets. `undefined` when nothing could be checked.
 */
export function schemaGroundingMeasurement(refs: {
  tables: { found: number; total: number };
  columns: { found: number; total: number };
}): Measurement | undefined {
  const total = refs.tables.total + refs.columns.total;
  if (total === 0) return undefined;
  const found = refs.tables.found + refs.columns.found;
  const columns = refs.columns.total
    ? ` and ${refs.columns.found}/${refs.columns.total} columns`
    : '';
  return {
    value: found / total,
    note: `${refs.tables.found}/${refs.tables.total} tables${columns} are in the session's datasets`,
  };
}

/**
 * Share of the SQL's join pairs that follow a declared or inferred
 * relationship. No joins at all is a clean 1; joins that could not be
 * checked (a side is a CTE or derived table) are left out, and when none
 * could be checked the signal is omitted.
 */
export function joinGroundingMeasurement(joins: {
  grounded: number;
  measured: number;
  unverifiable: number;
}): Measurement | undefined {
  if (joins.measured === 0) {
    return joins.unverifiable > 0 ? undefined : { value: 1, note: 'no joins' };
  }
  const skipped = joins.unverifiable
    ? ` (${joins.unverifiable} more could not be checked)`
    : '';
  return {
    value: joins.grounded / joins.measured,
    note: `${joins.grounded}/${joins.measured} join${joins.measured === 1 ? '' : 's'} follow a declared or inferred relationship${skipped}`,
  };
}

/**
 * Share of claims backed by a grounded basis (knowledge, metric, verified
 * query, schema or data) rather than convention or a guess. `noun` names the
 * claims in the note ("terms", "assumptions", "metric definition").
 * `undefined` when there is nothing to cover.
 */
export function coverageMeasurement(
  bases: EvidenceBasis[],
  noun: string,
): Measurement | undefined {
  if (!bases.length) return undefined;
  const grounded = bases.filter((basis) => GROUNDED_BASES.has(basis)).length;
  return {
    value: grounded / bases.length,
    note: `${grounded}/${bases.length} ${noun} backed by knowledge, metrics, verified queries, schema or data`,
  };
}

/** 1 with no pure guesses, falling to 0 at three or more. */
export function assumptionLoadMeasurement(
  bases: EvidenceBasis[],
  noun: string,
): Measurement {
  const guesses = bases.filter((basis) => basis === 'assumption').length;
  return {
    value: Math.max(0, 1 - guesses / GUESSES_AT_ZERO),
    note: guesses
      ? `${guesses} of ${bases.length} ${noun} ${guesses === 1 ? 'is a guess' : 'are guesses'} with nothing in the context backing ${guesses === 1 ? 'it' : 'them'}`
      : bases.length
        ? `no pure guesses among ${bases.length} ${noun}`
        : `no ${noun} to lean on`,
  };
}

/** Agree 1, disagree 0; an errored or skipped check is not evidence. */
export function crossCheckMeasurement(
  check: { status: 'agree' | 'disagree' | 'error'; note?: string } | undefined,
): Measurement | undefined {
  if (!check || check.status === 'error') return undefined;
  return check.status === 'agree'
    ? {
        value: 1,
        note:
          check.note ||
          'an independent re-derivation returned the same results',
      }
    : {
        value: 0,
        note:
          check.note ||
          'an independent re-derivation returned different results',
      };
}

/** 1 when the final SQL matches a user-approved verified query, else omitted. */
export function verifiedMeasurement(
  verified: boolean,
): Measurement | undefined {
  return verified
    ? { value: 1, note: 'the final SQL matches a user-approved verified query' }
    : undefined;
}

/** The model's verbalized confidence, omitted when it gave none. */
export function selfReportMeasurement(
  value: number | undefined,
): Measurement | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const clamped = clamp01(value);
  return {
    value: clamped,
    note: `the explaining model rated this block ${Math.round(clamped * 100)}% (weak evidence on its own)`,
  };
}
