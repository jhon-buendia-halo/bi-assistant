import { baselineDelta, useCaseKey } from './baseline';
import { loadStats } from './measure-freshness';
import type { ReadinessAssessment } from './readiness.types';

describe('baseline', () => {
  it('keys the same use case and datasets alike, whatever the spelling and order', () => {
    expect(useCaseKey('  Revenue  Dashboard, por región ', ['b', 'a'])).toBe(
      useCaseKey('revenue dashboard por region', ['a', 'b', 'a']),
    );
    expect(useCaseKey('x', ['a'])).not.toBe(useCaseKey('x', ['a', 'b']));
  });

  it('shows every dimension move and only the gates that changed', () => {
    const previous = {
      id: 'p1',
      createdAt: '2026-11-01T00:00:00.000Z',
      rubricVersion: '1.0',
      verdict: 'not-ready',
      dimensions: [
        { dimension: 'D1', applicable: true, level: 3 },
        { dimension: 'D2', applicable: true, level: 1 },
        { dimension: 'D6', applicable: false, level: 'N/E' },
      ],
      gates: [
        { gate: 'G1', status: 'pass' },
        { gate: 'G5', status: 'fail' },
      ],
    } as unknown as ReadinessAssessment;
    const current = {
      dimensions: [
        { dimension: 'D1', applicable: true, level: 3 },
        { dimension: 'D2', applicable: true, level: 2 },
      ],
      gates: [
        { gate: 'G1', status: 'pass' },
        { gate: 'G5', status: 'pass' },
      ],
    } as unknown as ReadinessAssessment;
    expect(baselineDelta(previous, current)).toEqual({
      previousId: 'p1',
      previousAt: '2026-11-01T00:00:00.000Z',
      previousRubricVersion: '1.0',
      previousVerdict: 'not-ready',
      dimensions: [
        { dimension: 'D1', from: 3, to: 3 },
        { dimension: 'D2', from: 1, to: 2 },
      ],
      gates: [{ gate: 'G5', from: 'fail', to: 'pass' }],
    });
  });
});

describe('load proxy (D3)', () => {
  const today = new Date('2026-11-26T00:00:00Z');
  const days = (n: number, step: number) =>
    Array.from({ length: n }, (_, i) =>
      new Date(today.getTime() - (1 + i * step) * 86_400_000)
        .toISOString()
        .slice(0, 10),
    ).sort();

  it('daily rows on every day: every period on time', () => {
    expect(loadStats(days(30, 1), today, 24)).toMatchObject({
      daysWithRows: 30,
      medianGapDays: 1,
      onTimeShare: 1,
    });
  });

  it('weekly rows for a daily use: a 7-day median gap and few periods on time', () => {
    const s = loadStats(days(5, 7), today, 24);
    expect(s.medianGapDays).toBe(7);
    expect(s.onTimeShare).toBeCloseTo(5 / 30, 5);
  });

  it('a monthly cadence has no share inside a 30-day window', () => {
    expect(loadStats(days(1, 30), today, 24 * 30).onTimeShare).toBeNull();
  });
});
