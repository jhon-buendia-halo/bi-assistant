import {
  EMPTY_QUALITY_FILTERS,
  formatErrorRate,
  formatLastEval,
  formatPassRate,
  formatPerQuestion,
  qualityRangeStart,
  qualityTone,
  toQualityQuery,
} from './agent-quality.model';

describe('agent quality model', () => {
  const now = new Date(2026, 10, 22, 15, 30);

  it('starts periods at local midnight', () => {
    expect(qualityRangeStart('week', now)).toEqual(new Date(2026, 10, 16));
    expect(qualityRangeStart('month', now)).toEqual(new Date(2026, 9, 24));
    expect(qualityRangeStart('quarter', now)).toEqual(new Date(2026, 7, 25));
    expect(qualityRangeStart('any', now)).toBeNull();
  });

  it('builds a query with only the set values', () => {
    expect(toQualityQuery({ ...EMPTY_QUALITY_FILTERS, range: 'any' })).toEqual(
      {},
    );
    expect(
      toQualityQuery(
        { agent: 'assistant', set: 's', model: 'm', range: 'week' },
        now,
      ),
    ).toEqual({
      agent: 'assistant',
      set: 's',
      model: 'm',
      from: new Date(2026, 10, 16).toISOString(),
    });
  });

  it('picks tones', () => {
    expect(qualityTone(1)).toBe('success');
    expect(qualityTone(0.8)).toBe('warning');
    expect(qualityTone(0.79)).toBe('danger');
  });

  it('formats figures', () => {
    expect(formatPassRate(7, 9)).toBe('7/9 · 78%');
    expect(formatPerQuestion(2.345)).toBe('2.3');
    expect(formatPerQuestion(null)).toBe('—');
    expect(formatErrorRate(0.125)).toBe('12.5 %');
    expect(formatErrorRate(null)).toBe('—');
    expect(formatLastEval(new Date(2026, 10, 21, 12).toISOString())).toBe(
      'Nov 21',
    );
  });
});
