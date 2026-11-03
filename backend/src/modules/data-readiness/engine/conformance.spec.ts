// Golden conformance suite (BA-251, R27). Runs the engine over labelled source
// profiles copied from the reference project's gold corpus and holds it to the
// reference floors (evals/expected.json, standards.dmbok).
//
// The reference corpus was generated against 2026-08-17 ("today" for the
// staleness math), so the engine's `now` is pinned to that date.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { runAssessment } from './check-engine';
import {
  addCounts,
  computeMetrics,
  scoreCounts,
  ZERO_COUNTS,
} from './gold-scorer';
import type { Counts, GoldLabel } from './gold-scorer';
import { DEFAULT_THRESHOLDS } from './types';
import type { Dimension, SourceProfile } from './types';

const GOLD_DIR = path.join(__dirname, '__fixtures__', 'gold');
const NOW = new Date('2026-08-17T12:00:00Z');

/** Reference floors: evals/expected.json, standards.dmbok. */
const MIN_SUPPORT = 15;
const POOLED_FLOOR = { precision: 0.86, recall: 0.77, f1: 0.815 };
const DIMENSION_FLOORS: Partial<
  Record<Dimension, { precision?: number; recall?: number; f1?: number }>
> = {
  accessibility: { precision: 0.99, recall: 0.99 },
  completeness: { precision: 0.71, recall: 0.815, f1: 0.76 },
  consistency: { precision: 0.875, recall: 0.99, f1: 0.93 },
  integrity: { precision: 0.99, recall: 0.87, f1: 0.93 },
  reasonability: { precision: 0.67, recall: 0.75, f1: 0.705 },
  timeliness: { precision: 0.99, recall: 0.99, f1: 0.99 },
  uniqueness: { precision: 0.905, recall: 0.695, f1: 0.785 },
  validity: { precision: 0.99, recall: 0.65, f1: 0.785 },
};
/** Dimensions the engine deliberately has no deterministic check for. */
const EMITS_NO_FINDINGS: Dimension[] = ['accuracy', 'currency'];

interface Fixture {
  name: string;
  profile: SourceProfile;
  labels: GoldLabel[];
}

function load(dialect: string): Fixture[] {
  const dir = path.join(GOLD_DIR, dialect);
  // Fixture folders only: stray files such as macOS .DS_Store are skipped.
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
    .map((name) => {
      const base = path.join(dir, name);
      // Reference profiles may carry extra fields (e.g. provenance): the
      // engine ignores what it does not know, so the cast is lenient.
      const profile = JSON.parse(
        fs.readFileSync(path.join(base, 'profile.json'), 'utf8'),
      ) as SourceProfile;
      const labels = fs
        .readFileSync(path.join(base, 'labels.jsonl'), 'utf8')
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#') && !l.startsWith('//'))
        .map((l) => JSON.parse(l) as GoldLabel);
      return { name: `${dialect}/${name}`, profile, labels };
    });
}

const postgres = load('postgres');
const databricks = load('databricks');
const fixtures = [...postgres, ...databricks];

describe('golden conformance (R27)', () => {
  const run = (f: Fixture) =>
    runAssessment(f.profile, { thresholds: DEFAULT_THRESHOLDS, now: NOW });

  it('covers at least 20 PostgreSQL and 20 Databricks profiles', () => {
    expect(postgres.length).toBeGreaterThanOrEqual(20);
    expect(databricks.length).toBeGreaterThanOrEqual(20);
  });

  it('is deterministic for the same profile and now', () => {
    for (const f of fixtures) {
      expect(run(f)).toEqual(run(f));
    }
  });

  describe('floors', () => {
    let pooled: Counts = { ...ZERO_COUNTS };
    const perDimension: Partial<Record<Dimension, Counts>> = {};
    const emitted = new Set<Dimension>();

    beforeAll(() => {
      for (const f of fixtures) {
        const result = run(f);
        result.findings.forEach((x) => emitted.add(x.dimension));
        const s = scoreCounts(result.findings, f.labels);
        pooled = addCounts(pooled, s.overall);
        for (const [d, c] of Object.entries(s.perDimension)) {
          perDimension[d as Dimension] = addCounts(
            perDimension[d as Dimension] ?? ZERO_COUNTS,
            c,
          );
        }
      }
    });

    it('meets the pooled precision, recall and F1 floors', () => {
      const m = computeMetrics(pooled);
      expect(m.precision).toBeGreaterThanOrEqual(POOLED_FLOOR.precision);
      expect(m.recall).toBeGreaterThanOrEqual(POOLED_FLOOR.recall);
      expect(m.f1).toBeGreaterThanOrEqual(POOLED_FLOOR.f1);
    });

    it.each(Object.keys(DIMENSION_FLOORS))(
      'meets the %s floors where support allows',
      (dimension) => {
        const counts = perDimension[dimension as Dimension];
        const support = counts
          ? counts.truePositives + counts.falseNegatives
          : 0;
        // The reference gate skips slices thinner than minSupport.
        if (!counts || support < MIN_SUPPORT) return;
        const m = computeMetrics(counts);
        const floor = DIMENSION_FLOORS[dimension as Dimension]!;
        if (floor.precision !== undefined) {
          expect(m.precision).toBeGreaterThanOrEqual(floor.precision);
        }
        if (floor.recall !== undefined) {
          expect(m.recall).toBeGreaterThanOrEqual(floor.recall);
        }
        if (floor.f1 !== undefined) {
          expect(m.f1).toBeGreaterThanOrEqual(floor.f1);
        }
      },
    );

    it('keeps the dimensions without a deterministic check silent', () => {
      for (const d of EMITS_NO_FINDINGS) {
        expect(emitted.has(d)).toBe(false);
      }
    });

    it('has labelled support for every assessed dimension', () => {
      for (const d of Object.keys(DIMENSION_FLOORS)) {
        const c = perDimension[d as Dimension];
        expect(
          (c?.truePositives ?? 0) + (c?.falseNegatives ?? 0),
        ).toBeGreaterThan(0);
      }
    });
  });
});
