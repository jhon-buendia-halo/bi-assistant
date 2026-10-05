import {
  entityKeysMatch,
  normalizeEntityKey,
  rankMetrics,
  rankSnippets,
  scoreMetric,
  scoreSnippet,
  tokenize,
  type RankableMetric,
  type RankableSnippet,
} from './knowledge-ranking';

describe('tokenize', () => {
  it('lowercases and splits on non-alphanumerics and underscores', () => {
    expect(tokenize('Net_Paid by Region!')).toEqual(['net', 'paid', 'region']);
  });

  it('drops stopwords', () => {
    expect(tokenize('the net paid by the region')).toEqual([
      'net',
      'paid',
      'region',
    ]);
  });

  it('lightly stems plurals', () => {
    expect(tokenize('claims denials categories')).toEqual([
      'claim',
      'denial',
      'category',
    ]);
  });

  it('keeps numbers and years as-is, unstemmed', () => {
    expect(tokenize('net paid in 2024')).toEqual(['net', 'paid', '2024']);
  });

  it('does not strip a trailing "s" off a word already ending in "ss"', () => {
    expect(tokenize('claims class')).toEqual(['claim', 'class']);
  });

  it('is empty for empty/undefined input', () => {
    expect(tokenize('')).toEqual([]);
    expect(tokenize(undefined)).toEqual([]);
    expect(tokenize(null)).toEqual([]);
  });
});

describe('normalizeEntityKey / entityKeysMatch', () => {
  it('keeps the last two dot-segments', () => {
    expect(normalizeEntityKey('world_cup.health_insurance.claims')).toBe(
      'health_insurance.claims',
    );
    expect(normalizeEntityKey('health_insurance.claims')).toBe(
      'health_insurance.claims',
    );
  });

  it('matches exactly or on the last two segments', () => {
    expect(entityKeysMatch('a.b.c', 'a.b.c')).toBe(true);
    expect(
      entityKeysMatch(
        'world_cup.health_insurance.claims',
        'health_insurance.claims',
      ),
    ).toBe(true);
    expect(
      entityKeysMatch('world_cup.health_insurance.claims', 'genomics.samples'),
    ).toBe(false);
    expect(entityKeysMatch('', 'a.b')).toBe(false);
  });
});

const snippet = (
  overrides: Partial<RankableSnippet> = {},
): RankableSnippet => ({
  kind: 'term',
  title: 'Term',
  body: 'A definition',
  ...overrides,
});

describe('scoreSnippet / rankSnippets', () => {
  it('ranks a health-insurance question above an unrelated genomics snippet, with the in-scope default filter never last', () => {
    const netPaidTerm = snippet({
      title: 'Net paid',
      body: 'Net paid is paid minus reversed amounts by region.',
      entities: ['world_cup.health_insurance.claims'],
    });
    const testClaimsFilter = snippet({
      kind: 'default_filter',
      title: 'Exclude test claims',
      body: 'Exclude claims where is_test = true.',
      entities: ['world_cup.health_insurance.claims'],
    });
    const genotypeTerm = snippet({
      title: 'Genotype 0/0',
      body: 'Homozygous reference is not a carrier.',
      entities: ['world_cup.genomics.variant_calls'],
    });

    const query = {
      questionTokens: tokenize('net paid by region in 2024'),
      entityNames: [] as string[],
    };
    const ranked = rankSnippets(
      [genotypeTerm, testClaimsFilter, netPaidTerm],
      query,
    );

    expect(ranked.indexOf(netPaidTerm)).toBeLessThan(
      ranked.indexOf(genotypeTerm),
    );
    expect(ranked.indexOf(testClaimsFilter)).toBeLessThan(
      ranked.indexOf(genotypeTerm),
    );
  });

  it('gives default_filter a floor that outranks an unrelated but higher-overlap term', () => {
    const irrelevantFilter = snippet({
      kind: 'default_filter',
      title: 'Filter',
      body: 'zzz qqq',
    });
    const relevantTerm = snippet({
      kind: 'term',
      title: 'net paid net paid net paid',
      body: 'net paid net paid',
    });

    const query = {
      questionTokens: tokenize('net paid'),
      entityNames: [] as string[],
    };

    expect(scoreSnippet(irrelevantFilter, query)).toBeGreaterThan(
      scoreSnippet(relevantTerm, query),
    );
  });

  it('applies kind priors on an otherwise-tied token overlap', () => {
    const term = snippet({ kind: 'term', title: 'x', body: 'net paid' });
    const instruction = snippet({
      kind: 'instruction',
      title: 'x',
      body: 'net paid',
    });
    const query = {
      questionTokens: tokenize('net paid'),
      entityNames: [] as string[],
    };

    expect(scoreSnippet(instruction, query)).toBeGreaterThan(
      scoreSnippet(term, query),
    );
  });

  it('adds an entity-match bonus when the snippet names an in-scope entity', () => {
    const matching = snippet({
      title: 'x',
      body: 'y',
      entities: ['world_cup.health_insurance.claims'],
    });
    const nonMatching = snippet({
      title: 'x',
      body: 'y',
      entities: ['world_cup.genomics.samples'],
    });
    const query = {
      questionTokens: [] as string[],
      entityNames: ['health_insurance.claims'],
    };

    expect(scoreSnippet(matching, query)).toBeGreaterThan(
      scoreSnippet(nonMatching, query),
    );
  });

  it('scores title, body, synonyms, entities and column text', () => {
    const query = { questionTokens: ['widget'], entityNames: [] as string[] };
    expect(scoreSnippet(snippet({ title: 'Widget' }), query)).toBeGreaterThan(
      0,
    );
    expect(
      scoreSnippet(snippet({ body: 'about widgets' }), query),
    ).toBeGreaterThan(0);
    expect(
      scoreSnippet(snippet({ synonyms: ['widget'] }), query),
    ).toBeGreaterThan(0);
    expect(
      scoreSnippet(snippet({ entities: ['a.widget'] }), query),
    ).toBeGreaterThan(0);
    expect(
      scoreSnippet(snippet({ entities: ['a.b'], column: 'widget' }), query),
    ).toBeGreaterThan(0);
  });

  it("is a stable sort: ties keep the input order (today's newest-first order)", () => {
    const a = snippet({ title: 'A' });
    const b = snippet({ title: 'B' });
    const c = snippet({ title: 'C' });
    const query = {
      questionTokens: [] as string[],
      entityNames: [] as string[],
    };

    expect(rankSnippets([a, b, c], query)).toEqual([a, b, c]);
  });
});

const metric = (overrides: Partial<RankableMetric> = {}): RankableMetric => ({
  name: 'metric',
  label: 'Metric',
  expression: 'COUNT(*)',
  entity: 'a.b',
  ...overrides,
});

describe('scoreMetric / rankMetrics', () => {
  it('ranks a metric matching the question above an unrelated one', () => {
    const netPaid = metric({
      name: 'net_paid',
      label: 'Net paid',
      description: 'Paid minus reversed amounts.',
      entity: 'world_cup.health_insurance.claims',
    });
    const alleleFraction = metric({
      name: 'allele_fraction',
      label: 'Allele fraction',
      description: 'Mean fraction of alt reads.',
      entity: 'world_cup.genomics.variant_calls',
    });
    const query = {
      questionTokens: tokenize('net paid by region'),
      entityNames: [] as string[],
    };

    const ranked = rankMetrics([alleleFraction, netPaid], query);
    expect(ranked[0]).toBe(netPaid);
  });

  it('adds an entity-match bonus', () => {
    const matching = metric({ entity: 'world_cup.health_insurance.claims' });
    const nonMatching = metric({ entity: 'world_cup.genomics.samples' });
    const query = {
      questionTokens: [] as string[],
      entityNames: ['health_insurance.claims'],
    };

    expect(scoreMetric(matching, query)).toBeGreaterThan(
      scoreMetric(nonMatching, query),
    );
  });

  it('is a stable sort on ties', () => {
    const a = metric({ name: 'a' });
    const b = metric({ name: 'b' });
    const query = {
      questionTokens: [] as string[],
      entityNames: [] as string[],
    };

    expect(rankMetrics([a, b], query)).toEqual([a, b]);
  });
});
