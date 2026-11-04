// Golden-suite scorer (BA-251, R27). Ported from the reference project's
// evals/engine/scorers/engine-scorer.ts: a finding matches a label when
// dimension, namespace, entity and field are equal and the severities are
// within one level. Matching is greedy and one-to-one. Pure, no dependencies.

import type { Dimension, Finding, Severity } from './types';

export const SEVERITY_ORDER: Severity[] = ['info', 'low', 'medium', 'high'];

/** One hand-written ground-truth defect (a line of labels.jsonl). */
export interface GoldLabel {
  dimension: Dimension;
  namespace?: string;
  entity?: string;
  field?: string;
  severity: Severity;
  note?: string;
}

export interface Counts {
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
}

export interface Metrics extends Counts {
  /** Null when undefined (no findings / no labels). */
  precision: number | null;
  recall: number | null;
  f1: number | null;
}

export interface ScoreResult {
  overall: Metrics;
  perDimension: Partial<Record<Dimension, Metrics>>;
  /** Labels no finding matched. */
  missed: GoldLabel[];
  /** Findings no label matched. */
  falseAlarms: Finding[];
}

export const SEVERITY_TOLERANCE = 1;

type Identity = Pick<GoldLabel, 'dimension' | 'namespace' | 'entity' | 'field'>;

function key(t: Identity): string {
  return [t.dimension, t.namespace ?? '', t.entity ?? '', t.field ?? ''].join(
    '\u0000',
  );
}

function distance(a: Severity, b: Severity): number {
  return Math.abs(SEVERITY_ORDER.indexOf(a) - SEVERITY_ORDER.indexOf(b));
}

export function computeMetrics(c: Counts): Metrics {
  const precision =
    c.truePositives + c.falsePositives === 0
      ? null
      : c.truePositives / (c.truePositives + c.falsePositives);
  const recall =
    c.truePositives + c.falseNegatives === 0
      ? null
      : c.truePositives / (c.truePositives + c.falseNegatives);
  const f1 =
    precision === null || recall === null || precision + recall === 0
      ? null
      : (2 * precision * recall) / (precision + recall);
  return { ...c, precision, recall, f1 };
}

export function addCounts(a: Counts, b: Counts): Counts {
  return {
    truePositives: a.truePositives + b.truePositives,
    falsePositives: a.falsePositives + b.falsePositives,
    falseNegatives: a.falseNegatives + b.falseNegatives,
  };
}

export const ZERO_COUNTS: Counts = {
  truePositives: 0,
  falsePositives: 0,
  falseNegatives: 0,
};

/** Raw per-dimension counts, so callers can pool several datasets. */
export function scoreCounts(
  findings: Finding[],
  labels: GoldLabel[],
  tolerance: number = SEVERITY_TOLERANCE,
): {
  overall: Counts;
  perDimension: Partial<Record<Dimension, Counts>>;
  missed: GoldLabel[];
  falseAlarms: Finding[];
} {
  const buckets = new Map<string, { finding: Finding; taken: boolean }[]>();
  for (const finding of findings) {
    const k = key(finding);
    const list = buckets.get(k) ?? [];
    list.push({ finding, taken: false });
    buckets.set(k, list);
  }

  const perDimension: Partial<Record<Dimension, Counts>> = {};
  const bump = (d: Dimension, field: keyof Counts) => {
    const c = (perDimension[d] ??= { ...ZERO_COUNTS });
    c[field] += 1;
  };

  const missed: GoldLabel[] = [];
  for (const label of labels) {
    const hit = (buckets.get(key(label)) ?? []).find(
      (b) =>
        !b.taken && distance(label.severity, b.finding.severity) <= tolerance,
    );
    if (hit) {
      hit.taken = true;
      bump(label.dimension, 'truePositives');
    } else {
      missed.push(label);
      bump(label.dimension, 'falseNegatives');
    }
  }

  const falseAlarms: Finding[] = [];
  for (const list of buckets.values()) {
    for (const { finding, taken } of list) {
      if (!taken) {
        falseAlarms.push(finding);
        bump(finding.dimension, 'falsePositives');
      }
    }
  }

  const overall = Object.values(perDimension).reduce<Counts>(
    (acc, c) => addCounts(acc, c),
    { ...ZERO_COUNTS },
  );
  return { overall, perDimension, missed, falseAlarms };
}

/** Grade one dataset: precision, recall and F1 overall and per dimension. */
export function scoreFindings(
  findings: Finding[],
  labels: GoldLabel[],
  tolerance: number = SEVERITY_TOLERANCE,
): ScoreResult {
  const raw = scoreCounts(findings, labels, tolerance);
  const perDimension: Partial<Record<Dimension, Metrics>> = {};
  for (const [d, c] of Object.entries(raw.perDimension)) {
    perDimension[d as Dimension] = computeMetrics(c);
  }
  return {
    overall: computeMetrics(raw.overall),
    perDimension,
    missed: raw.missed,
    falseAlarms: raw.falseAlarms,
  };
}
