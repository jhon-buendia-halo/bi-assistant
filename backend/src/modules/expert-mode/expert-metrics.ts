/**
 * How business expert mode is measured — the eval harness's half of the
 * reasoning-trace contract (`entities/reasoning-trace.entity.ts`).
 *
 * The mode makes two claims, and each gets its own number:
 *
 * 1. **"Confidence means something."** A trace's overall confidence should rank
 *    right answers above wrong ones. That is the headline metric: the AUROC of
 *    overall confidence against the eval verdict (PASS = correct). 0.5 is a
 *    coin toss, 1.0 is a perfect ranking.
 * 2. **"High means almost sure."** The constraint: of the answers shown in the
 *    high band, at least `HIGH_BAND_ACCURACY_TARGET` must be correct. A
 *    confidence score that ranks well but labels half its wrong answers "high"
 *    would still mislead the reader.
 *
 * Coverage (did the trace name the expected tables, assumptions and metric) is
 * reported beside them as a diagnostic: a well-ranked confidence on a trace
 * that explains the wrong things is not an explanation.
 *
 * Pure module — no Nest, no I/O, no model calls — so the CLI (`scripts/run-eval.ts`),
 * the suite loader and unit tests can all import it. Every function returns
 * `undefined` for "not measurable" rather than a silent 0: missing evidence is
 * not negative evidence, the same rule the confidence signals follow.
 */
import type {
  AssumptionsBlock,
  ConfidenceBand,
  DataSelectionBlock,
  InterpretationBlock,
  MetricBlock,
  ReasoningBlock,
  ReasoningBlockKind,
  ReasoningTrace,
} from './entities/reasoning-trace.entity';

/** The "almost sure" constraint: accuracy inside the high band must reach this. */
export const HIGH_BAND_ACCURACY_TARGET = 0.9;

/**
 * What a case expects a correct trace to explain. Written by the case author
 * next to `expectedSql`, validated by the suite loader.
 */
export interface ExpectedReasoning {
  /** `schema.table` entities the data-selection block must choose. */
  tables?: string[];
  /** Short phrases the assumptions / term mappings / metric must cover. */
  assumptions?: string[];
  /** The metric the answer should compute — a governed metric name or a phrase. */
  metric?: string;
}

/* ------------------------------------------------------------- ranking */

/** One graded answer: its overall confidence and whether it was right. */
export interface ScoredOutcome {
  score: number;
  correct: boolean;
}

/**
 * Area under the ROC curve of `score` as a predictor of `correct`, computed as
 * the Mann–Whitney U statistic: the probability that a randomly chosen correct
 * answer scores higher than a randomly chosen wrong one, with ties counting
 * one half. Ties get average (mid) ranks, which is what makes a constant score
 * come out at exactly 0.5 instead of depending on sort order.
 *
 * `undefined` when either class is empty — with no wrong answers (or no right
 * ones) there is nothing to rank against, and 1.0 or 0.0 would both be lies.
 * Entries with a non-finite score are ignored as not measured.
 */
export function auroc(scores: readonly ScoredOutcome[]): number | undefined {
  const valid = scores.filter((entry) => Number.isFinite(entry.score));
  const positives = valid.filter((entry) => entry.correct).length;
  const negatives = valid.length - positives;
  if (positives === 0 || negatives === 0) return undefined;

  const sorted = [...valid].sort((a, b) => a.score - b.score);
  let positiveRankSum = 0;
  for (let start = 0; start < sorted.length;) {
    let end = start;
    while (
      end + 1 < sorted.length &&
      sorted[end + 1].score === sorted[start].score
    ) {
      end++;
    }
    // 1-based ranks start+1 … end+1 share their average.
    const midrank = (start + end) / 2 + 1;
    for (let i = start; i <= end; i++) {
      if (sorted[i].correct) positiveRankSum += midrank;
    }
    start = end + 1;
  }
  const u = positiveRankSum - (positives * (positives + 1)) / 2;
  return u / (positives * negatives);
}

/** One graded answer as the reader saw it: the band shown and the verdict. */
export interface BandedOutcome {
  band: ConfidenceBand;
  correct: boolean;
}

export interface SelectiveAccuracy {
  band: ConfidenceBand;
  /** Answers whose overall confidence fell in the band. */
  n: number;
  /** Of those, how many were correct. */
  correct: number;
  /** `correct / n`; absent when no answer fell in the band. */
  accuracy?: number;
  /** `n / rows` — how much of the run the band speaks for; absent for no rows. */
  coverage?: number;
}

/**
 * Accuracy of the answers shown in exactly `band` — "when the trace said high,
 * how often was it right". Coverage is reported with it, because 100% accuracy
 * on one answer out of forty is not a band anyone can lean on.
 */
export function selectiveAccuracy(
  rows: readonly BandedOutcome[],
  band: ConfidenceBand,
): SelectiveAccuracy {
  const inBand = rows.filter((row) => row.band === band);
  const correct = inBand.filter((row) => row.correct).length;
  return {
    band,
    n: inBand.length,
    correct,
    ...(inBand.length ? { accuracy: round4(correct / inBand.length) } : {}),
    ...(rows.length ? { coverage: round4(inBand.length / rows.length) } : {}),
  };
}

/* ------------------------------------------------------------- coverage */

/**
 * The words a phrase is matched on: lower-cased runs of letters at least four
 * long. Short words ("in", "the", "usd", "avg") are too common — or too
 * abbreviable — to be evidence that a trace said the thing. Exported so the
 * suite loader can reject a phrase that has none (it would match anything).
 */
export function significantWords(phrase: string): string[] {
  const words: string[] = (phrase ?? '').toLowerCase().match(/\p{L}+/gu) ?? [];
  return [...new Set(words.filter((word) => word.length >= 4))];
}

/**
 * Fraction of the expected `schema.table` entities the data-selection block
 * chose, matched by suffix at a dot boundary (`hr.employees` covers
 * `world_cup.hr.employees`, never `world_cup.xhr.employees`) and
 * case-insensitively. Rejected entities do not count — naming a table only to
 * dismiss it is not choosing it. A trace with no data-selection block (no SQL
 * ran) covers nothing.
 *
 * `undefined` when nothing is expected or there is no trace to inspect.
 */
export function tablesCoverage(
  expected: readonly string[] | undefined,
  trace: ReasoningTrace | undefined,
): number | undefined {
  const wanted = [...new Set((expected ?? []).map(normalizeEntity))].filter(
    Boolean,
  );
  if (!wanted.length || !trace) return undefined;
  const chosen = (
    findBlock<DataSelectionBlock>(trace, 'data-selection')?.tables ?? []
  ).map((table) => normalizeEntity(table.entity));
  const covered = wanted.filter((entity) =>
    chosen.some((choice) => choice === entity || choice.endsWith(`.${entity}`)),
  ).length;
  return round4(covered / wanted.length);
}

/**
 * Fraction of the expected assumption phrases the trace covers. A phrase is
 * covered when every significant word of it (see `significantWords`) appears,
 * as a substring, in the lower-cased concatenation of the assumption
 * statements, the term mappings (term and what it became) and the metric block
 * (name, formula, grain). A phrase with no significant word cannot be
 * evidenced and counts as not covered (the suite loader rejects those).
 *
 * `undefined` when nothing is expected or there is no trace to inspect.
 */
export function assumptionsCoverage(
  expected: readonly string[] | undefined,
  trace: ReasoningTrace | undefined,
): number | undefined {
  const phrases = (expected ?? []).filter((phrase) => phrase?.trim());
  if (!phrases.length || !trace) return undefined;
  const text = reasoningText(trace);
  const covered = phrases.filter((phrase) => {
    const words = significantWords(phrase);
    return words.length > 0 && words.every((word) => text.includes(word));
  }).length;
  return round4(covered / phrases.length);
}

/**
 * Whether the metric block defines the expected metric: either its name or its
 * `sourceRef` equals the expected text once case and punctuation are ignored
 * (`avg_base_salary_usd` ≡ "Avg base salary USD"), or every significant word
 * of the expected text appears in the block's name, formula, grain and
 * `sourceRef`. The " (unverified)" marker the service appends to an ungrounded
 * reference is ignored here — whether the metric is *grounded* is the
 * confidence signal's question; this one only asks whether it is the right
 * metric. A trace with no metric block does not match.
 *
 * `undefined` when no metric is expected or there is no trace to inspect.
 */
export function metricMatched(
  expected: string | undefined,
  trace: ReasoningTrace | undefined,
): boolean | undefined {
  if (!expected?.trim() || !trace) return undefined;
  const metric = findBlock<MetricBlock>(trace, 'metric');
  if (!metric) return false;
  const sourceRef = stripUnverified(metric.sourceRef);
  const want = normalizeName(expected);
  if (
    [metric.name, sourceRef]
      .filter((value): value is string => !!value)
      .some((value) => normalizeName(value) === want)
  ) {
    return true;
  }
  const words = significantWords(expected);
  if (!words.length) return false;
  const text = [metric.name, metric.formula, metric.grain, sourceRef]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();
  return words.every((word) => text.includes(word));
}

/* ------------------------------------------------------------ per case */

export interface BlockScore {
  score: number;
  band: ConfidenceBand;
}

/** What the eval harness records about one answer's trace. */
export interface ExpertCaseRecord {
  /** Whether the answer carried a reasoning trace at all. */
  traced: boolean;
  /** `trace.overall.score`. */
  confidence?: number;
  /** `trace.overall.band`. */
  band?: ConfidenceBand;
  tablesCoverage?: number;
  assumptionsCoverage?: number;
  metricMatched?: boolean;
  /** Each block's own confidence, keyed by block kind. */
  blocks?: Partial<Record<ReasoningBlockKind, BlockScore>>;
}

/** Measure one answer's trace against what its case expects. */
export function expertCaseRecord(
  trace: ReasoningTrace | undefined,
  expected?: ExpectedReasoning,
): ExpertCaseRecord {
  if (!trace) return { traced: false };
  const blocks: Partial<Record<ReasoningBlockKind, BlockScore>> = {};
  for (const block of trace.blocks ?? []) {
    if (block?.confidence) {
      blocks[block.kind] = {
        score: block.confidence.score,
        band: block.confidence.band,
      };
    }
  }
  const tables = tablesCoverage(expected?.tables, trace);
  const assumptions = assumptionsCoverage(expected?.assumptions, trace);
  const metric = metricMatched(expected?.metric, trace);
  return {
    traced: true,
    ...(trace.overall ? { confidence: trace.overall.score } : {}),
    ...(trace.overall ? { band: trace.overall.band } : {}),
    ...(tables !== undefined ? { tablesCoverage: tables } : {}),
    ...(assumptions !== undefined ? { assumptionsCoverage: assumptions } : {}),
    ...(metric !== undefined ? { metricMatched: metric } : {}),
    blocks,
  };
}

/* ------------------------------------------------------------- per run */

/** One graded attempt: its trace measurements and its verdict. */
export interface ExpertAttempt {
  record: ExpertCaseRecord;
  /** The eval verdict was PASS. */
  correct: boolean;
}

/**
 * A case the harness ran but does not grade (no reference SQL — typically a
 * clarification case). Only trace presence is recorded: a clarification turn
 * must carry no trace.
 */
export interface ExpertProbe {
  record: ExpertCaseRecord;
  /** The turn ended in a clarifying question. */
  clarified: boolean;
}

export interface CoverageMean {
  mean: number;
  /** Traced answers the mean is over (those whose case expected something). */
  n: number;
}

export interface ExpertRunSummary {
  /** Graded answers (PASS or FAIL) produced in expert mode. */
  graded: number;
  /** Of those, how many carried a trace. Only traced answers are scored below. */
  traced: number;
  /** Traced answers that passed / failed — the two classes the AUROC ranks. */
  tracedPassed: number;
  tracedFailed: number;
  /** Headline: AUROC of overall confidence vs PASS; absent with a single class. */
  auroc?: number;
  /** Selective accuracy per band. `bands.high` carries the constraint. */
  bands: Record<ConfidenceBand, SelectiveAccuracy>;
  highBandTarget: number;
  /** `bands.high.accuracy >= highBandTarget`; absent when no answer was high. */
  meetsHighBandTarget?: boolean;
  coverage: {
    tables?: CoverageMean;
    assumptions?: CoverageMean;
    metric?: { matched: number; n: number; rate: number };
  };
  /** Ungraded cases that were run for trace presence (see `ExpertProbe`). */
  probes?: {
    run: number;
    traced: number;
    clarified: number;
    /** Clarification turns that nevertheless carried a trace — should be 0. */
    tracedClarifications: number;
  };
}

/**
 * Fold every graded attempt of a run into the headline, the constraint and the
 * coverage means. Answers without a trace are counted (`graded − traced` is
 * the failure rate of the trace itself) but cannot be ranked, so they are left
 * out of every score rather than entered as confidence 0.
 */
export function summarizeExpert(
  attempts: readonly ExpertAttempt[],
  probes: readonly ExpertProbe[] = [],
): ExpertRunSummary {
  const traced = attempts.filter(
    (attempt) =>
      attempt.record.traced && typeof attempt.record.confidence === 'number',
  );
  const tracedPassed = traced.filter((attempt) => attempt.correct).length;
  const area = auroc(
    traced.map((attempt) => ({
      score: attempt.record.confidence as number,
      correct: attempt.correct,
    })),
  );
  const banded = traced
    .filter((attempt) => attempt.record.band)
    .map((attempt) => ({
      band: attempt.record.band as ConfidenceBand,
      correct: attempt.correct,
    }));
  const bands = {
    high: selectiveAccuracy(banded, 'high'),
    medium: selectiveAccuracy(banded, 'medium'),
    low: selectiveAccuracy(banded, 'low'),
  };

  const coverage: ExpertRunSummary['coverage'] = {};
  const tables = meanOf(traced.map((attempt) => attempt.record.tablesCoverage));
  if (tables) coverage.tables = tables;
  const assumptions = meanOf(
    traced.map((attempt) => attempt.record.assumptionsCoverage),
  );
  if (assumptions) coverage.assumptions = assumptions;
  const metrics = traced
    .map((attempt) => attempt.record.metricMatched)
    .filter((value): value is boolean => value !== undefined);
  if (metrics.length) {
    const matched = metrics.filter(Boolean).length;
    coverage.metric = {
      matched,
      n: metrics.length,
      rate: round4(matched / metrics.length),
    };
  }

  return {
    graded: attempts.length,
    traced: traced.length,
    tracedPassed,
    tracedFailed: traced.length - tracedPassed,
    ...(area !== undefined ? { auroc: round4(area) } : {}),
    bands,
    highBandTarget: HIGH_BAND_ACCURACY_TARGET,
    ...(bands.high.accuracy !== undefined
      ? {
          meetsHighBandTarget: bands.high.accuracy >= HIGH_BAND_ACCURACY_TARGET,
        }
      : {}),
    coverage,
    ...(probes.length
      ? {
          probes: {
            run: probes.length,
            traced: probes.filter((probe) => probe.record.traced).length,
            clarified: probes.filter((probe) => probe.clarified).length,
            tracedClarifications: probes.filter(
              (probe) => probe.clarified && probe.record.traced,
            ).length,
          },
        }
      : {}),
  };
}

/* -------------------------------------------------------------- helpers */

function findBlock<T extends ReasoningBlock>(
  trace: ReasoningTrace,
  kind: T['kind'],
): T | undefined {
  return (trace.blocks ?? []).find((block) => block?.kind === kind) as
    T | undefined;
}

/** What an assumption phrase is matched against — see `assumptionsCoverage`. */
function reasoningText(trace: ReasoningTrace): string {
  const parts: string[] = [];
  for (const item of findBlock<AssumptionsBlock>(trace, 'assumptions')?.items ??
    []) {
    parts.push(item.statement);
  }
  for (const term of findBlock<InterpretationBlock>(trace, 'interpretation')
    ?.terms ?? []) {
    parts.push(term.term, term.mappedTo);
  }
  const metric = findBlock<MetricBlock>(trace, 'metric');
  if (metric) parts.push(metric.name, metric.formula, metric.grain);
  return parts.filter(Boolean).join('\n').toLowerCase();
}

function normalizeEntity(entity: string): string {
  return (entity ?? '').replace(/"/g, '').trim().toLowerCase();
}

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function stripUnverified(value: string | undefined): string | undefined {
  return value?.replace(/\s*\(unverified\)\s*$/i, '').trim() || undefined;
}

function meanOf(
  values: readonly (number | undefined)[],
): CoverageMean | undefined {
  const measured = values.filter(
    (value): value is number => typeof value === 'number',
  );
  if (!measured.length) return undefined;
  const total = measured.reduce((sum, value) => sum + value, 0);
  return { mean: round4(total / measured.length), n: measured.length };
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
