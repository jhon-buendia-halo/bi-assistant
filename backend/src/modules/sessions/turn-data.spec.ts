import type { Agent } from '@mastra/core/agent';
import { queryEntitiesProvenance } from '../../mastra/tool-services';
import type { ToolDataRecord } from './entities/session.entity';
import { synthesizeToolOnlyTurn, toolDataRecord } from './turn-data';

/** A model-visible tool result whose full (sql-carrying) twin was kept aside
 * by the tool, the way `model.tools.ts` registers it. */
function keptAside(full: Record<string, unknown>): Record<string, unknown> {
  const visible: Record<string, unknown> = { ...full };
  delete visible.sql;
  delete visible.correctedSql;
  queryEntitiesProvenance.set(visible, full as never);
  return visible;
}

describe('toolDataRecord — logical entities (agents.md 5.1, sessions-chat R63)', () => {
  it('stores the logical entities a query_entities call touched, from the result kept aside', () => {
    const visible = keptAside({
      columns: ['name', 'wins'],
      rows: [{ name: 'Argentina', wins: 3 }],
      entities: ['matches', 'teams'],
      sql: 'SELECT "teams"."common_name" AS "name" FROM "main"."public"."matches" JOIN "main"."public"."teams" ON 1=1 LIMIT 100',
      warnings: [
        'wins is 1 on every row, so it cannot explain any difference between them.',
      ],
    });

    const record = toolDataRecord(
      'query_entities',
      {
        query: { from: 'matches', select: [{ attr: 'teams.name' }] },
        rationale: 'winners',
      },
      visible,
    );

    expect(record?.input).toContain('"main"."public"."matches"');
    expect(record).toEqual(
      expect.objectContaining({
        tool: 'query_entities',
        entities: ['matches', 'teams'],
        logicalQuery: JSON.stringify({
          from: 'matches',
          select: [{ attr: 'teams.name' }],
        }),
        warnings: [
          'wins is 1 on every row, so it cannot explain any difference between them.',
        ],
      }),
    );
  });

  it('stores the sampled entity for a sample_records call', () => {
    const visible = keptAside({
      columns: ['match_id'],
      rows: [{ match_id: 1 }],
      entities: ['matches'],
      sql: 'SELECT "matches"."match_id" FROM "main"."public"."matches" LIMIT 10',
    });

    const record = toolDataRecord(
      'sample_records',
      { entity: 'Matches', rationale: 'peek' },
      visible,
    );

    expect(record?.entities).toEqual(['matches']);
  });

  it('keeps the sampled entity on a failed sample, and none on a failed query_entities', () => {
    const failedSample = toolDataRecord(
      'sample_records',
      { entity: 'matches', rationale: 'peek' },
      {
        error: {
          code: 'execution_error',
          message: 'the data source rejected the query (engine error)',
          path: '',
        },
      },
    );
    const failedQuery = toolDataRecord(
      'query_entities',
      { query: { from: 'nope', select: [{ attr: 'x' }] }, rationale: 'r' },
      {
        error: { code: 'unknown_entity', message: 'from: nope', path: 'from' },
      },
    );

    expect(failedSample?.entities).toEqual(['matches']);
    expect(failedSample?.error).toContain('execution_error');
    expect(failedQuery).not.toHaveProperty('entities');
  });

  it('stores no logical entities for run_raw_sql; its record stays flagged outside the model', () => {
    const record = toolDataRecord(
      'run_raw_sql',
      {
        entity: 'matches',
        sql: 'SELECT * FROM main.public.matches',
        rationale: 'fallback',
      },
      { columns: ['n'], rows: [{ n: 1 }], outsideModel: true },
    );

    expect(record).not.toHaveProperty('entities');
    expect(record?.outsideModel).toBe(true);
    expect(record?.input).toBe('SELECT * FROM main.public.matches');
  });
});

describe('synthesizeToolOnlyTurn — no physical SQL back to the model (agents.md 5.5)', () => {
  const logicalQuery = JSON.stringify({
    from: 'tournaments',
    select: [{ attr: 'year' }, { attr: 'champion' }],
  });
  const data: ToolDataRecord[] = [
    {
      tool: 'query_entities',
      input:
        'SELECT "tournaments"."year" AS "year" FROM "main"."world_cup"."tournaments" AS "tournaments" LIMIT 100',
      columns: ['year', 'champion'],
      rows: [{ year: 2022, champion: 'Argentina' }],
      rowCount: 1,
      rationale: 'champions by year',
      warnings: ['a warning'],
      logicalQuery,
      entities: ['tournaments'],
    },
    {
      tool: 'sample_records',
      input:
        'SELECT "teams"."team_id" FROM "main"."world_cup"."teams" AS "teams" LIMIT 10',
      columns: ['team_id'],
      rows: [{ team_id: 1 }],
      rowCount: 1,
      entities: ['teams'],
    },
    {
      tool: 'run_raw_sql',
      input: 'SELECT COUNT(*) AS n FROM main.world_cup.matches',
      columns: ['n'],
      rows: [{ n: 964 }],
      rowCount: 1,
      outsideModel: true,
    },
  ];

  async function promptFor(records: ToolDataRecord[]): Promise<string> {
    const generate = jest.fn().mockResolvedValue({ text: 'Argentina won.' });
    await synthesizeToolOnlyTurn(
      { generate } as unknown as Agent,
      'Who won?',
      records,
      new AbortController().signal,
      {},
    );
    return (generate.mock.calls[0] as [string])[0];
  }

  function sentRecords(prompt: string): Record<string, unknown>[] {
    return JSON.parse(prompt.split('Tool results: ')[1]) as Record<
      string,
      unknown
    >[];
  }

  it('sends the logical query and the sampled entity as input, never the compiled SQL', async () => {
    const prompt = await promptFor(data);

    const [query, sample] = sentRecords(prompt);
    expect(JSON.stringify([query, sample])).not.toContain('SELECT');
    expect(query).toEqual({
      tool: 'query_entities',
      input: logicalQuery,
      columns: ['year', 'champion'],
      rows: [{ year: 2022, champion: 'Argentina' }],
      rowCount: 1,
      rationale: 'champions by year',
      warnings: ['a warning'],
      entities: ['tournaments'],
    });
    expect(sample).toEqual(
      expect.objectContaining({
        tool: 'sample_records',
        input: 'teams',
        entities: ['teams'],
      }),
    );
  });

  it('sends a run_raw_sql record with its statement and the outside-the-model flag', async () => {
    const prompt = await promptFor(data);

    const raw = sentRecords(prompt)[2];
    expect(raw).toEqual(
      expect.objectContaining({
        tool: 'run_raw_sql',
        input: 'SELECT COUNT(*) AS n FROM main.world_cup.matches',
        outsideModel: true,
      }),
    );
  });

  it('asks for the source entities without pointing at the SQL', async () => {
    const prompt = await promptFor(data);

    expect(prompt).toContain(
      'Give concrete findings, comparisons, a short takeaway, and name the source entities where possible.',
    );
    expect(prompt).not.toContain('from the SQL');
  });

  it('caps the rows sent per record at 50', async () => {
    const rows = Array.from({ length: 80 }, (_, i) => ({ n: i }));
    const prompt = await promptFor([
      { ...data[0], rows, rowCount: rows.length },
    ]);

    expect(sentRecords(prompt)[0].rows).toHaveLength(50);
  });
});
