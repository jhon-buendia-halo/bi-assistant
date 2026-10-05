import { KnowledgeSnippet } from '../../knowledge/models/knowledge.model';
import { ColumnProfile } from '../services/datasets-api.service';
import {
  entityKeysMatch,
  formatCardinality,
  groupKnowledgeByColumn,
  knowledgeForColumn,
  matchesColumn,
  normalizeEntityKey,
  profileSummary,
  relativeTime,
  visibleTopValues,
} from './column-profile.utils';

function snippet(overrides: Partial<KnowledgeSnippet> = {}): KnowledgeSnippet {
  return {
    id: 's1',
    kind: 'instruction',
    scope: null,
    title: 'Currency is always USD',
    body: 'Every row is billed in US dollars.',
    entities: ['health_insurance.health_insurance.claims'],
    column: 'currency',
    enabled: true,
    source: 'user',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('normalizeEntityKey / entityKeysMatch', () => {
  it('keeps the last two dot-segments', () => {
    expect(normalizeEntityKey('main.health.claims')).toBe('health.claims');
    expect(normalizeEntityKey('health.claims')).toBe('health.claims');
    expect(normalizeEntityKey('claims')).toBe('claims');
  });

  it('matches exactly or on the last two segments', () => {
    expect(entityKeysMatch('main.health.claims', 'main.health.claims')).toBe(
      true,
    );
    expect(entityKeysMatch('main.health.claims', 'other.health.claims')).toBe(
      true,
    );
    expect(entityKeysMatch('main.health.claims', 'main.health.members')).toBe(
      false,
    );
    expect(entityKeysMatch('', 'main.health.claims')).toBe(false);
  });
});

describe('matchesColumn', () => {
  it('matches a snippet scoped to the same entity and column', () => {
    expect(
      matchesColumn(snippet(), 'main.health_insurance.claims', 'currency'),
    ).toBe(true);
  });

  it('matches on schema.table even when the catalog segment differs', () => {
    expect(
      matchesColumn(
        snippet({ entities: ['health_insurance.claims'] }),
        'main.health_insurance.claims',
        'currency',
      ),
    ).toBe(true);
  });

  it('rejects a different column', () => {
    expect(
      matchesColumn(snippet(), 'main.health_insurance.claims', 'status'),
    ).toBe(false);
  });

  it('rejects a snippet with no column (whole-entity note)', () => {
    expect(
      matchesColumn(
        snippet({ column: undefined }),
        'main.health_insurance.claims',
        'currency',
      ),
    ).toBe(false);
  });

  it('rejects a different entity', () => {
    expect(
      matchesColumn(snippet(), 'main.health_insurance.members', 'currency'),
    ).toBe(false);
  });
});

describe('knowledgeForColumn / groupKnowledgeByColumn', () => {
  const entityKey = 'main.health_insurance.claims';
  const currency = snippet({ id: 's1', column: 'currency' });
  const status = snippet({
    id: 's2',
    column: 'status',
    entities: ['health_insurance.claims'],
  });
  const otherEntity = snippet({
    id: 's3',
    column: 'currency',
    entities: ['main.health_insurance.members'],
  });
  const snippets = [currency, status, otherEntity];

  it('filters to snippets scoped to the given entity and column', () => {
    expect(knowledgeForColumn(snippets, entityKey, 'currency')).toEqual([
      currency,
    ]);
  });

  it('groups matching snippets by column name', () => {
    const map = groupKnowledgeByColumn(snippets, entityKey);
    expect(map.get('currency')).toEqual([currency]);
    expect(map.get('status')).toEqual([status]);
    expect(map.has('nonexistent')).toBe(false);
  });
});

describe('relativeTime', () => {
  const now = new Date('2026-09-23T12:00:00.000Z');

  it('returns an empty string for an absent or invalid timestamp', () => {
    expect(relativeTime(undefined, now)).toBe('');
    expect(relativeTime('not-a-date', now)).toBe('');
  });

  it('reports "just now" within the threshold', () => {
    expect(relativeTime('2026-09-23T11:59:30.000Z', now)).toBe('just now');
  });

  it('reports minutes, hours, days, weeks, months and years', () => {
    expect(relativeTime('2026-09-23T11:55:00.000Z', now)).toBe(
      '5 minutes ago',
    );
    expect(relativeTime('2026-09-23T09:00:00.000Z', now)).toBe('3 hours ago');
    expect(relativeTime('2026-09-21T12:00:00.000Z', now)).toBe('2 days ago');
    expect(relativeTime('2026-09-09T12:00:00.000Z', now)).toBe('2 weeks ago');
    expect(relativeTime('2026-07-23T12:00:00.000Z', now)).toBe('2 months ago');
    expect(relativeTime('2024-09-23T12:00:00.000Z', now)).toBe('2 years ago');
  });

  it('singularizes one unit', () => {
    expect(relativeTime('2026-09-23T11:00:00.000Z', now)).toBe('1 hour ago');
  });
});

describe('profileSummary', () => {
  function profile(overrides: Partial<ColumnProfile> = {}): ColumnProfile {
    return {
      sampledRows: 1000,
      nullRate: 0,
      distinctCount: 3,
      constant: false,
      profiledAt: '2026-09-23T00:00:00.000Z',
      ...overrides,
    };
  }

  it('formats null rate as a rounded percentage', () => {
    expect(profileSummary(profile({ nullRate: 0.126 })).nullRatePct).toBe(
      '13% null',
    );
  });

  it('pluralizes the distinct count', () => {
    expect(profileSummary(profile({ distinctCount: 1 })).distinctLabel).toBe(
      '1 distinct value',
    );
    expect(profileSummary(profile({ distinctCount: 5 })).distinctLabel).toBe(
      '5 distinct values',
    );
  });

  it('formats a min…max range only when both are present', () => {
    expect(
      profileSummary(profile({ min: '1', max: '99' })).rangeLabel,
    ).toBe('1…99');
    expect(profileSummary(profile({ min: '1' })).rangeLabel).toBeUndefined();
  });

  it('maps magnitude to a human hint', () => {
    expect(
      profileSummary(profile({ magnitude: 'cents-like' })).magnitudeHint,
    ).toBe('cents — ÷100 for dollars');
    expect(
      profileSummary(profile({ magnitude: undefined })).magnitudeHint,
    ).toBeUndefined();
  });

  it('carries the constant flag through', () => {
    expect(profileSummary(profile({ constant: true })).constant).toBe(true);
  });
});

describe('formatCardinality', () => {
  it('formats the short table name, column and cardinality', () => {
    expect(
      formatCardinality({
        entity: 'main.health_insurance.providers',
        column: 'id',
        source: 'declared',
        cardinality: 'many-to-one',
      }),
    ).toBe('→ providers.id · many-to-one');
  });

  it('omits the cardinality suffix when unknown or absent', () => {
    expect(
      formatCardinality({
        entity: 'main.health_insurance.providers',
        column: 'id',
        source: 'inferred',
        cardinality: 'unknown',
      }),
    ).toBe('→ providers.id');
    expect(
      formatCardinality({
        entity: 'main.health_insurance.providers',
        column: 'id',
        source: 'inferred',
      }),
    ).toBe('→ providers.id');
  });

  it('returns undefined when there is no reference', () => {
    expect(formatCardinality(undefined)).toBeUndefined();
  });
});

describe('visibleTopValues', () => {
  const values = Array.from({ length: 12 }, (_, i) => ({
    value: `v${i}`,
    count: i,
  }));

  it('shows everything under the limit', () => {
    const result = visibleTopValues(values.slice(0, 5), false);
    expect(result.shown.length).toBe(5);
    expect(result.hiddenCount).toBe(0);
  });

  it('collapses beyond the default limit of 8', () => {
    const result = visibleTopValues(values, false);
    expect(result.shown.length).toBe(8);
    expect(result.hiddenCount).toBe(4);
  });

  it('shows everything once expanded', () => {
    const result = visibleTopValues(values, true);
    expect(result.shown.length).toBe(12);
    expect(result.hiddenCount).toBe(0);
  });

  it('treats an absent list as empty', () => {
    const result = visibleTopValues(undefined, false);
    expect(result.shown).toEqual([]);
    expect(result.hiddenCount).toBe(0);
  });
});
