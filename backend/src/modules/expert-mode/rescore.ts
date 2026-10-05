/**
 * Re-scores a persisted reasoning trace as if its final SQL had just matched
 * a user-approved verified query — the same confidence lift a first-time
 * approval gets from `ExpertModeService.buildTrace`, without a fresh model
 * call. Used on a thumbs-up against a pinned answer (`answer-pins`): the
 * trace stored on the pin is rescored once and the result replaces it, both
 * on the pin and on the mirrored session message.
 *
 * Pure: no DI, no I/O — same discipline as `confidence.ts`.
 */
import {
  BLOCK_SIGNAL_WEIGHTS,
  makeSignal,
  overallConfidence,
  scoreSignals,
  verifiedMeasurement,
} from './confidence';
import type {
  ConfidenceSignal,
  ReasoningBlock,
  ReasoningTrace,
} from './entities/reasoning-trace.entity';

/**
 * Adds (or replaces) the `verified_match` signal on the `sql` and `metric`
 * blocks and rescores them, then recomputes `overall`. The cross-check
 * status feeding `overall` is recovered from the existing overall
 * `cross_check` signal (present only on careful-mode traces) rather than
 * re-derived — this function never re-runs anything, it only reflects a new
 * fact (the answer is now verified) onto scores that already exist.
 * Idempotent: replacing an existing `verified_match` signal with an
 * identical one is a no-op.
 */
export function withVerifiedMatch(trace: ReasoningTrace): ReasoningTrace {
  const measurement = verifiedMeasurement(true) as NonNullable<
    ReturnType<typeof verifiedMeasurement>
  >;

  const blocks: ReasoningBlock[] = trace.blocks.map((block) => {
    if (block.kind !== 'sql' && block.kind !== 'metric') return block;
    const weight = BLOCK_SIGNAL_WEIGHTS[block.kind].verified_match;
    if (weight === undefined) return block;
    const signals = [
      ...block.confidence.signals.filter((s) => s.id !== 'verified_match'),
      makeSignal('verified_match', measurement, weight),
    ];
    return { ...block, confidence: scoreSignals(signals) };
  });

  // The overall `cross_check` signal (when present) is the block-independent
  // evidence `ExpertModeService` attached at build time: value 1 for an
  // agreeing careful-mode check, 0 for a disagreeing one. Absent means
  // careful mode never ran for this trace.
  const crossCheckSignal = trace.overall.signals.find(
    (s) => s.id === 'cross_check',
  );
  const crossCheck: 'agree' | 'disagree' | undefined =
    crossCheckSignal === undefined
      ? undefined
      : crossCheckSignal.value === 1
        ? 'agree'
        : 'disagree';

  const sqlWeight = BLOCK_SIGNAL_WEIGHTS.sql.verified_match;
  const overallSignals: ConfidenceSignal[] = trace.overall.signals.filter(
    (s) => s.id !== 'verified_match',
  );
  if (sqlWeight !== undefined) {
    overallSignals.push(
      makeSignal(
        'verified_match',
        {
          ...measurement,
          note: `${measurement.note} — floors the overall confidence at 85%`,
        },
        sqlWeight,
      ),
    );
  }

  const overall = overallConfidence(
    blocks.map((block) => ({ kind: block.kind, confidence: block.confidence })),
    { crossCheck, verified: true, signals: overallSignals },
  );

  return { ...trace, blocks, overall };
}
