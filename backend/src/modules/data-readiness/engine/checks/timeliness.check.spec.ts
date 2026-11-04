import { timelinessCheck } from './timeliness.check';
import { DEFAULT_THRESHOLDS } from '../types';
import type { CheckContext, EntityProfile, FieldProfile } from '../types';

const NOW = new Date('2026-06-15T12:00:00Z');
const CTX: CheckContext = { thresholds: DEFAULT_THRESHOLDS, now: NOW };

function temporal(name: string, max: string): FieldProfile {
  return {
    name,
    type: 'timestamptz',
    semanticType: 'temporal',
    nullable: true,
    max,
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

function isoDaysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString();
}

describe('timelinessCheck', () => {
  it('flags a table whose newest record is older than the staleness threshold', () => {
    const { findings } = timelinessCheck(
      entity([temporal('created_at', isoDaysAgo(800))]),
      CTX,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].dimension).toBe('timeliness');
    expect(findings[0].field).toBe('created_at');
    expect(findings[0].severity).toBe('medium'); // > 2x threshold (365)
  });

  it('uses the most recent temporal field across the table', () => {
    const { findings } = timelinessCheck(
      entity([
        temporal('created_at', isoDaysAgo(800)),
        temporal('updated_at', isoDaysAgo(10)),
      ]),
      CTX,
    );
    expect(findings).toHaveLength(0); // newest (updated_at, 10d) is fresh
  });

  it('does not flag fresh tables', () => {
    const { findings } = timelinessCheck(
      entity([temporal('created_at', isoDaysAgo(30))]),
      CTX,
    );
    expect(findings).toHaveLength(0);
  });

  it('ignores future-dated maxima (a Reasonability concern, not Timeliness)', () => {
    const { findings } = timelinessCheck(
      entity([temporal('created_at', isoDaysAgo(-100))]),
      CTX,
    );
    expect(findings).toHaveLength(0);
  });

  it('returns nothing when there is no parseable temporal field', () => {
    const { findings } = timelinessCheck(
      entity([
        {
          name: 'qty',
          type: 'integer',
          semanticType: 'numeric',
          nullable: false,
          max: '99',
        },
      ]),
      CTX,
    );
    expect(findings).toHaveLength(0);
  });

  it('counts the entity as one check only when it has a parseable temporal field (denominator)', () => {
    // A freshness-checkable table runs one check whether or not it is stale.
    expect(
      timelinessCheck(entity([temporal('created_at', isoDaysAgo(30))]), CTX)
        .checksRun,
    ).toBe(1);
    // No parseable temporal field → not freshness-checkable → zero.
    expect(
      timelinessCheck(
        entity([
          {
            name: 'qty',
            type: 'integer',
            semanticType: 'numeric',
            nullable: false,
            max: '99',
          },
        ]),
        CTX,
      ).checksRun,
    ).toBe(0);
  });

  // F1.20.5a — integer year columns are freshness signals.
  it('flags a stale year-int column (SurveyYear style)', () => {
    const oldYear = NOW.getUTCFullYear() - 4;
    const { findings, checksRun } = timelinessCheck(
      entity([
        {
          name: 'SurveyYear',
          type: 'int',
          semanticType: 'numeric',
          nullable: true,
          max: String(oldYear),
        },
      ]),
      CTX,
    );
    expect(checksRun).toBe(1);
    expect(findings).toHaveLength(1);
    expect(findings[0].field).toBe('SurveyYear');
  });

  it('a current-year year-int column is fresh (no finding, one check)', () => {
    const thisYear = NOW.getUTCFullYear();
    const result = timelinessCheck(
      entity([
        {
          name: 'survey_year',
          type: 'int',
          semanticType: 'numeric',
          nullable: true,
          max: String(thisYear),
        },
      ]),
      CTX,
    );
    expect(result.checksRun).toBe(1);
    expect(result.findings).toHaveLength(0);
  });

  it('ignores implausible year values (not a year signal)', () => {
    const result = timelinessCheck(
      entity([
        {
          name: 'year',
          type: 'int',
          semanticType: 'numeric',
          nullable: true,
          max: '99999',
        },
      ]),
      CTX,
    );
    expect(result.checksRun).toBe(0);
  });

  // F1.20.5b — catalog last-altered fallback when no temporal/year column exists.
  it('falls back to entity.lastModifiedAt and flags a stale table', () => {
    const e = {
      ...entity([
        {
          name: 'qty',
          type: 'integer',
          semanticType: 'numeric' as const,
          nullable: false,
          max: '9',
        },
      ]),
      lastModifiedAt: isoDaysAgo(900),
    };
    const { findings, checksRun } = timelinessCheck(e, CTX);
    expect(checksRun).toBe(1);
    expect(findings).toHaveLength(1);
    expect(findings[0].field).toBe('(table last altered)');
  });

  it('a freshly-altered table with no date columns passes (one check, no finding)', () => {
    const e = { ...entity([]), lastModifiedAt: isoDaysAgo(3) };
    const result = timelinessCheck(e, CTX);
    expect(result.checksRun).toBe(1);
    expect(result.findings).toHaveLength(0);
  });

  it('temporal columns take precedence over lastModifiedAt', () => {
    const e = {
      ...entity([temporal('created_at', isoDaysAgo(10))]),
      lastModifiedAt: isoDaysAgo(900),
    };
    expect(timelinessCheck(e, CTX).findings).toHaveLength(0);
  });
});

describe('timelinessCheck (severity boundaries, fixed now)', () => {
  const run = (days: number) =>
    timelinessCheck(entity([temporal('created_at', isoDaysAgo(days))]), CTX);

  it('is fresh exactly at the threshold and low just past it', () => {
    expect(run(365).findings).toHaveLength(0);
    const low = run(366).findings;
    expect(low).toHaveLength(1);
    expect(low[0].severity).toBe('low');
  });

  it('is low at exactly 2x the threshold and medium beyond it', () => {
    expect(run(730).findings[0].severity).toBe('low');
    expect(run(731).findings[0].severity).toBe('medium');
  });

  it('honours a custom staleDays threshold', () => {
    const ctx: CheckContext = {
      now: NOW,
      thresholds: { ...DEFAULT_THRESHOLDS, timeliness: { staleDays: 30 } },
    };
    const e = entity([temporal('created_at', isoDaysAgo(45))]);
    expect(timelinessCheck(e, ctx).findings[0].severity).toBe('low');
  });

  it('computes year-column age from Dec 31 of that year against ctx.now', () => {
    const y = (n: number) =>
      timelinessCheck(
        entity([
          {
            name: 'fiscal_yr',
            type: 'int',
            semanticType: 'numeric',
            nullable: true,
            max: String(n),
          },
        ]),
        CTX,
      );
    expect(y(2026).findings).toHaveLength(0);
    expect(y(2025).findings).toHaveLength(0);
    expect(y(2024).findings[0].severity).toBe('low');
    expect(y(2022).findings[0].severity).toBe('medium');
  });

  it('ignores an unparseable lastModifiedAt', () => {
    const e = { ...entity([]), lastModifiedAt: 'nope' };
    expect(timelinessCheck(e, CTX).checksRun).toBe(0);
  });
});
