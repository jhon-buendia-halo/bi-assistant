import { VerifiedQueriesService } from './verified-queries.service';
import type { VerifiedQueryDoc } from './entities/verified-query.entity';

const pair = (
  id: string,
  question: string,
  sql: string,
  logicalQuery?: string,
): VerifiedQueryDoc => ({
  id,
  question,
  sql,
  ...(logicalQuery ? { logicalQuery } : {}),
  entities: [],
  sourceSessionId: 'session-1',
  sourceMessageAt: `2024-01-01T00:00:0${id}.000Z`,
});

const stored = [
  pair('1', 'How many claims were denied last year?', 'SELECT 1'),
  pair('2', 'Average cost per member per month', 'SELECT 2'),
  pair('3', 'Which providers denied the most claims?', 'SELECT 3'),
];

function build(docs: VerifiedQueryDoc[] = stored) {
  const repository = {
    list: jest.fn().mockResolvedValue(docs),
    save: jest
      .fn()
      .mockImplementation((doc: VerifiedQueryDoc) => Promise.resolve(doc)),
    deleteForMessage: jest.fn().mockResolvedValue(1),
  };
  return {
    service: new VerifiedQueriesService(repository as never),
    repository,
  };
}

describe('VerifiedQueriesService.findSimilar', () => {
  it('ranks pairs by shared content words', async () => {
    const { service } = build();

    const found = await service.findSimilar('how many claims were denied?');

    expect(found[0].question).toBe('How many claims were denied last year?');
    expect(found.map((d) => d.id)).not.toContain('2');
  });

  it('ignores stopwords so unrelated questions score zero', async () => {
    const { service } = build();

    expect(await service.findSimilar('what is the weather in Madrid')).toEqual(
      [],
    );
  });

  it('caps the result at k', async () => {
    const { service } = build([
      pair('1', 'claims denied by provider', 'SELECT 1'),
      pair('2', 'claims denied by member', 'SELECT 2'),
      pair('3', 'claims denied by month', 'SELECT 3'),
      pair('4', 'claims denied by state', 'SELECT 4'),
    ]);

    expect(await service.findSimilar('claims denied', 2)).toHaveLength(2);
  });

  it('returns nothing for an empty question', async () => {
    const { service } = build();

    expect(await service.findSimilar('   ')).toEqual([]);
  });
});

describe('VerifiedQueriesService.referenceBlock', () => {
  it('renders Q/Query pairs (never SQL text) when something similar has a logicalQuery', async () => {
    const { service } = build([
      pair(
        '1',
        'How many claims were denied last year?',
        'SELECT 1',
        '{"from":"claims","select":[{"agg":"count","alias":"n"}]}',
      ),
      ...stored.slice(1),
    ]);

    const block = await service.referenceBlock('claims denied last year');

    expect(block).toContain('Verified reference queries');
    expect(block).toContain('Q: How many claims were denied last year?');
    expect(block).toContain(
      'Query: {"from":"claims","select":[{"agg":"count","alias":"n"}]}',
    );
    expect(block).not.toContain('SELECT 1');
  });

  it('omits a SQL-only legacy pair entirely (ADR-0007 §4 — no SQL reaches the assistant)', async () => {
    const { service } = build(); // none of `stored` has a logicalQuery

    const block = await service.referenceBlock('claims denied last year');

    expect(block).toBeUndefined();
  });

  it('is undefined when nothing matches', async () => {
    const { service } = build();

    expect(await service.referenceBlock('unrelated trivia topic')).toBe(
      undefined,
    );
  });
});

describe('VerifiedQueriesService.verifierReferenceBlock', () => {
  it('includes a SQL-only legacy pair as a bare reference question, never its SQL', async () => {
    const { service } = build();

    const block = await service.verifierReferenceBlock(
      'claims denied last year',
    );

    expect(block).toContain('Q: How many claims were denied last year?');
    expect(block).not.toContain('SELECT 1');
  });

  it('shows the logical query for a pair that has one', async () => {
    const { service } = build([
      pair(
        '1',
        'How many claims were denied last year?',
        'SELECT 1',
        '{"from":"claims","select":[{"agg":"count","alias":"n"}]}',
      ),
      ...stored.slice(1),
    ]);

    const block = await service.verifierReferenceBlock(
      'claims denied last year',
    );

    expect(block).toContain(
      'Query: {"from":"claims","select":[{"agg":"count","alias":"n"}]}',
    );
  });

  it('is undefined when nothing matches', async () => {
    const { service } = build();

    expect(
      await service.verifierReferenceBlock('unrelated trivia topic'),
    ).toBeUndefined();
  });
});

describe('VerifiedQueriesService.isVerifiedSql', () => {
  const library = [
    {
      ...pair(
        '1',
        'Denied claims',
        'SELECT count(*)\n  FROM main.health.claims',
      ),
      datasourceId: 'ds-1',
    },
    pair('2', 'Anything', 'SELECT 2'),
  ];

  it('matches regardless of case, whitespace and a trailing semicolon', async () => {
    const { service } = build(library);

    expect(
      await service.isVerifiedSql('select COUNT(*) from main.health.claims ;'),
    ).toBe(true);
  });

  it('does not match a different statement', async () => {
    const { service } = build(library);

    expect(await service.isVerifiedSql('select count(*) from other')).toBe(
      false,
    );
  });

  it('rejects a match recorded on another datasource', async () => {
    const { service } = build(library);

    expect(
      await service.isVerifiedSql(
        'SELECT count(*) FROM main.health.claims',
        'ds-2',
      ),
    ).toBe(false);
  });

  it('accepts a pair stored without a datasource', async () => {
    const { service } = build(library);

    expect(await service.isVerifiedSql('select 2', 'ds-9')).toBe(true);
  });

  it('is false for an empty statement', async () => {
    const { service } = build(library);

    expect(await service.isVerifiedSql('   ')).toBe(false);
  });
});

describe('VerifiedQueriesService.save', () => {
  it('trims the pair and keys it to the source answer', async () => {
    const { service, repository } = build();

    await service.save({
      question: '  How many claims?  ',
      sql: '  SELECT 1  ',
      sourceSessionId: 'session-1',
      sourceMessageAt: '2024-01-01T00:00:03.000Z',
    });

    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        question: 'How many claims?',
        sql: 'SELECT 1',
        entities: [],
        sourceSessionId: 'session-1',
        sourceMessageAt: '2024-01-01T00:00:03.000Z',
      }),
    );
  });
});
