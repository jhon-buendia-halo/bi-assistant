import { reasonabilityCheck } from './reasonability.check';
import { DEFAULT_THRESHOLDS } from '../types';
import type { CheckContext, EntityProfile, FieldProfile } from '../types';

const NOW = new Date('2026-06-15T12:00:00Z');
const CTX: CheckContext = { thresholds: DEFAULT_THRESHOLDS, now: NOW };

function field(p: Partial<FieldProfile>): FieldProfile {
  return {
    name: 'col',
    type: 'integer',
    semanticType: 'numeric',
    nullable: true,
    ...p,
  };
}

function entity(fields: FieldProfile[]): EntityProfile {
  return {
    namespace: 'public',
    name: 'orders',
    rowCount: 100,
    fields,
    keys: [],
  };
}

describe('reasonabilityCheck', () => {
  it('flags negative values in a numeric column', () => {
    const e = entity([
      field({
        name: 'amount',
        semanticType: 'numeric',
        min: '-12.50',
        max: '500',
      }),
    ]);
    const { findings } = reasonabilityCheck(e, CTX);
    expect(findings).toHaveLength(1);
    expect(findings[0].dimension).toBe('reasonability');
    expect(findings[0].field).toBe('amount');
  });

  it('does not flag non-negative numerics', () => {
    const e = entity([
      field({ name: 'qty', semanticType: 'numeric', min: '0', max: '99' }),
    ]);
    expect(reasonabilityCheck(e, CTX).findings).toHaveLength(0);
  });

  it('flags future-dated temporal values', () => {
    const future = `${NOW.getUTCFullYear() + 5}-01-01 00:00:00`;
    const e = entity([
      field({
        name: 'created_at',
        type: 'timestamptz',
        semanticType: 'temporal',
        min: '2020-01-01',
        max: future,
      }),
    ]);
    const { findings } = reasonabilityCheck(e, CTX);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('medium');
    expect(findings[0].description).toMatch(/future-dated/);
  });

  it('flags implausibly old temporal values', () => {
    const e = entity([
      field({
        name: 'dob',
        type: 'date',
        semanticType: 'temporal',
        min: '1850-06-01',
        max: '1990-01-01',
      }),
    ]);
    const { findings } = reasonabilityCheck(e, CTX);
    expect(findings).toHaveLength(1);
    expect(findings[0].description).toMatch(/implausibly old/);
  });

  it('ignores well-formed recent dates', () => {
    const e = entity([
      field({
        name: 'ts',
        type: 'date',
        semanticType: 'temporal',
        min: '2020-01-01',
        max: '2024-12-31',
      }),
    ]);
    expect(reasonabilityCheck(e, CTX).findings).toHaveLength(0);
  });

  it('counts one check per numeric or temporal field (denominator)', () => {
    const e = entity([
      field({ name: 'amount', semanticType: 'numeric', min: '0', max: '9' }),
      field({
        name: 'ts',
        type: 'date',
        semanticType: 'temporal',
        min: '2020-01-01',
        max: '2024-12-31',
      }),
      field({ name: 'note', type: 'text', semanticType: 'text' }), // not eligible
    ]);
    expect(reasonabilityCheck(e, CTX).checksRun).toBe(2);
  });
});

// F1.20.6a — ratio/percentage bounds implied by the column name.
describe('reasonabilityCheck (ratio bounds)', () => {
  it('flags a percentage column whose max exceeds 100', () => {
    const e = entity([field({ name: 'completion_pct', min: '0', max: '250' })]);
    const { findings } = reasonabilityCheck(e, CTX);
    const hit = findings.find((f) => f.description.includes('exceeds'));
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe('medium');
  });

  it('flags a fraction/share column whose max exceeds 1', () => {
    const e = entity([field({ name: 'market_share', min: '0', max: '7.5' })]);
    const hits = reasonabilityCheck(e, CTX).findings.filter((f) =>
      f.description.includes('exceeds'),
    );
    expect(hits).toHaveLength(1);
  });

  it('does not flag in-bounds values or unrelated names', () => {
    const e = entity([
      field({ name: 'discount_pct', min: '0', max: '100' }),
      field({ name: 'win_probability', min: '0', max: '1' }),
      field({ name: 'amount', min: '0', max: '5000' }),
    ]);
    const hits = reasonabilityCheck(e, CTX).findings.filter((f) =>
      f.description.includes('exceeds'),
    );
    expect(hits).toHaveLength(0);
  });
});

// F1.20.6b — swapped temporal ranges (conservative: only fires when the end
// column's whole range precedes the start's).
describe('reasonabilityCheck (swapped ranges)', () => {
  function temporalField(name: string, min: string, max: string): FieldProfile {
    return field({ name, type: 'date', semanticType: 'temporal', min, max });
  }

  it('flags a start/end pair whose end range wholly precedes the start range', () => {
    const e = entity([
      temporalField('start_date', '2023-01-01', '2024-06-01'),
      temporalField('end_date', '2021-01-01', '2022-06-01'),
    ]);
    const hits = reasonabilityCheck(e, CTX).findings.filter((f) =>
      f.description.includes('swapped'),
    );
    expect(hits).toHaveLength(1);
    expect(hits[0].severity).toBe('low');
  });

  it('does not fire on partial overlap (open-ended rows are normal)', () => {
    const e = entity([
      temporalField('start_date', '2023-01-01', '2024-06-01'),
      temporalField('end_date', '2022-06-01', '2024-12-31'), // min earlier, max later — overlap
    ]);
    const hits = reasonabilityCheck(e, CTX).findings.filter((f) =>
      f.description.includes('swapped'),
    );
    expect(hits).toHaveLength(0);
  });

  it('does not fire when no name pair exists', () => {
    const e = entity([
      temporalField('created_at', '2023-01-01', '2024-06-01'),
      temporalField('shipped_at', '2021-01-01', '2022-06-01'),
    ]);
    const hits = reasonabilityCheck(e, CTX).findings.filter((f) =>
      f.description.includes('swapped'),
    );
    expect(hits).toHaveLength(0);
  });
});

describe('reasonabilityCheck (fixed now, boundaries)', () => {
  const temporalF = (name: string, min: string, max: string) =>
    field({ name, type: 'date', semanticType: 'temporal', min, max });

  it('uses ctx.now for the future-year cutoff', () => {
    const ok = entity([temporalF('d', '2020-01-01', '2026-12-31')]);
    const bad = entity([temporalF('d', '2020-01-01', '2027-01-01')]);
    expect(reasonabilityCheck(ok, CTX).findings).toHaveLength(0);
    const f = reasonabilityCheck(bad, CTX).findings;
    expect(f).toHaveLength(1);
    expect(f[0].severity).toBe('medium');
  });

  it('flags ancient dates past the threshold and honours a custom one', () => {
    expect(
      reasonabilityCheck(
        entity([temporalF('d', '1900-01-01', '2020-01-01')]),
        CTX,
      ).findings,
    ).toHaveLength(0);
    const ctx: CheckContext = {
      now: NOW,
      thresholds: {
        ...DEFAULT_THRESHOLDS,
        reasonability: { ancientYear: 2000 },
      },
    };
    const f = reasonabilityCheck(
      entity([temporalF('d', '1999-01-01', '2020-01-01')]),
      ctx,
    ).findings;
    expect(f).toHaveLength(1);
    expect(f[0].severity).toBe('low');
  });

  it('can raise future and ancient findings on the same column', () => {
    const e = entity([temporalF('d', '1800-01-01', '2999-01-01')]);
    expect(reasonabilityCheck(e, CTX).findings).toHaveLength(2);
  });

  it('ratio bounds: pct bound 100 vs ratio bound 1, boundary passes, counts a check', () => {
    const e = entity([
      field({ name: 'x_pct', min: '0', max: '100' }),
      field({ name: 'y_ratio', min: '0', max: '1.0001' }),
    ]);
    const r = reasonabilityCheck(e, CTX);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].field).toBe('y_ratio');
    expect(r.findings[0].severity).toBe('medium');
    expect(r.checksRun).toBe(4);
  });

  it('swapped ranges: from/to and begin/finish pairs, low severity, counts a check', () => {
    const e = entity([
      temporalF('valid_from', '2023-01-01', '2024-06-01'),
      temporalF('valid_to', '2021-01-01', '2022-06-01'),
    ]);
    const r = reasonabilityCheck(e, CTX);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].field).toBe('valid_from, valid_to');
    expect(r.findings[0].severity).toBe('low');
    expect(r.checksRun).toBe(3);
    const e2 = entity([
      temporalF('begin_dt', '2023-01-01', '2024-06-01'),
      temporalF('finish_dt', '2021-01-01', '2022-06-01'),
    ]);
    expect(reasonabilityCheck(e2, CTX).findings).toHaveLength(1);
  });

  it('skips non-parseable swapped-range values', () => {
    const e = entity([
      temporalF('start_date', 'x', 'y'),
      temporalF('end_date', '2021-01-01', '2022-06-01'),
    ]);
    expect(
      reasonabilityCheck(e, CTX).findings.filter((f) =>
        f.description.includes('swapped'),
      ),
    ).toHaveLength(0);
  });
});
