import {
  lastSuccessfulSqlRecord,
  runResultSetCheck,
  RESULT_SET_CHECK_ID,
  RESULT_SET_ROW_LIMIT,
} from './result-set-check';
import { setDatasetToolServices } from '../tool-services';
import type { DatasetToolServices, DatasetSnapshot } from '../tool-services';
import type { ToolDataRecord } from '../../modules/sessions/entities/session.entity';

function stubServices(
  overrides: Partial<DatasetToolServices> = {},
): DatasetToolServices {
  return {
    createVisual: jest.fn(),
    updateVisual: jest.fn(),
    getDatasets: jest.fn(),
    sampleRows: jest.fn(),
    runReadOnlySql: jest.fn(),
    ...overrides,
  } as unknown as DatasetToolServices;
}

const snapshot: DatasetSnapshot[] = [
  { name: 'World Cup', datasourceId: 'ds-1', tables: ['world_cup.matches'] },
];

describe('lastSuccessfulSqlRecord', () => {
  it('returns undefined when there are no run_readonly_sql records', () => {
    const records: ToolDataRecord[] = [{ tool: 'list_entities', input: 'x' }];
    expect(lastSuccessfulSqlRecord(records)).toBeUndefined();
  });

  it('skips errored sql calls and picks the last successful one', () => {
    const records: ToolDataRecord[] = [
      { tool: 'run_readonly_sql', input: 'SELECT 1', rows: [{ a: 1 }] },
      { tool: 'run_readonly_sql', input: 'SELECT bad', error: 'boom' },
    ];
    // The errored call is last, so the successful one before it should win.
    expect(lastSuccessfulSqlRecord(records)?.input).toBe('SELECT 1');
  });

  it('returns the most recent successful call when several succeeded', () => {
    const records: ToolDataRecord[] = [
      { tool: 'run_readonly_sql', input: 'SELECT 1', rows: [] },
      { tool: 'run_readonly_sql', input: 'SELECT 2', rows: [{ a: 2 }] },
    ];
    expect(lastSuccessfulSqlRecord(records)?.input).toBe('SELECT 2');
  });
});

describe('runResultSetCheck', () => {
  afterEach(() => {
    // Leave no stub installed between tests.
    setDatasetToolServices(stubServices());
  });

  it('returns undefined when the case has no expectedSql', async () => {
    const result = await runResultSetCheck(
      undefined,
      ['World Cup'],
      snapshot,
      [],
    );
    expect(result).toBeUndefined();
  });

  it('fails when the agent never ran a successful SQL call', async () => {
    const result = await runResultSetCheck(
      'SELECT 1',
      ['World Cup'],
      snapshot,
      [{ tool: 'run_readonly_sql', input: 'bad', error: 'boom' }],
    );
    expect(result?.id).toBe(RESULT_SET_CHECK_ID);
    expect(result?.passed).toBe(false);
    expect(result?.reason).toMatch(/no successful run_readonly_sql/);
  });

  it('fails when no datasource can be resolved', async () => {
    const result = await runResultSetCheck(
      'SELECT 1',
      ['World Cup'],
      [{ name: 'World Cup', tables: [] }],
      [{ tool: 'run_readonly_sql', input: 'SELECT 1', rows: [{ a: 1 }] }],
    );
    expect(result?.passed).toBe(false);
    expect(result?.reason).toMatch(/could not resolve a datasource/);
  });

  it('passes when the agent rows match the expectedSql rows', async () => {
    const runReadOnlySql = jest.fn().mockResolvedValue({
      columns: ['champion'],
      rows: [{ champion: 'Argentina' }],
    });
    setDatasetToolServices(stubServices({ runReadOnlySql }));

    const result = await runResultSetCheck(
      'SELECT champion FROM tournaments',
      ['World Cup'],
      snapshot,
      [
        {
          tool: 'run_readonly_sql',
          input: 'SELECT team FROM tournaments',
          rows: [{ team: 'Argentina' }],
        },
      ],
    );

    expect(result?.passed).toBe(true);
    expect(result?.score).toBe(1);
    expect(result?.reason).toBeUndefined();
    expect(runReadOnlySql).toHaveBeenCalledWith(
      'ds-1',
      'SELECT champion FROM tournaments',
      RESULT_SET_ROW_LIMIT,
      ['World Cup'],
    );
  });

  it('fails with a reason when the rows differ', async () => {
    const runReadOnlySql = jest.fn().mockResolvedValue({
      columns: ['champion'],
      rows: [{ champion: 'Argentina' }],
    });
    setDatasetToolServices(stubServices({ runReadOnlySql }));

    const result = await runResultSetCheck(
      'SELECT champion FROM tournaments',
      ['World Cup'],
      snapshot,
      [
        {
          tool: 'run_readonly_sql',
          input: 'SELECT team FROM tournaments',
          rows: [{ team: 'France' }],
        },
      ],
    );

    expect(result?.passed).toBe(false);
    expect(result?.reason).toMatch(/did not match/);
  });

  it('scores 0 with a reason when expectedSql fails to run', async () => {
    const runReadOnlySql = jest
      .fn()
      .mockRejectedValue(new Error('syntax error at or near "FORM"'));
    setDatasetToolServices(stubServices({ runReadOnlySql }));

    const result = await runResultSetCheck(
      'SELECT champion FORM tournaments',
      ['World Cup'],
      snapshot,
      [{ tool: 'run_readonly_sql', input: 'SELECT 1', rows: [{ a: 1 }] }],
    );

    expect(result?.passed).toBe(false);
    expect(result?.reason).toMatch(/expectedSql failed to run/);
    expect(result?.reason).toMatch(/syntax error/);
  });

  function reference(rows: Record<string, unknown>[], truncated = false) {
    const runReadOnlySql = jest.fn().mockResolvedValue({ rows, truncated });
    setDatasetToolServices(stubServices({ runReadOnlySql }));
    return runReadOnlySql;
  }

  function sql(
    rows: Record<string, unknown>[],
    input = 'SELECT answer',
  ): ToolDataRecord {
    return { tool: 'run_readonly_sql', input, rows };
  }

  it('uses the top-scorer answer even when a broader leaderboard follows it', async () => {
    const query = reference([{ player: 'Lionel Messi', goals: 4 }]);
    const result = await runResultSetCheck(
      'SELECT reference',
      ['World Cup'],
      snapshot,
      [
        sql([{ full_name: 'Lionel Messi', goals: '4' }]),
        sql([
          { full_name: 'Lionel Messi', goals: '4' },
          { full_name: 'Kylian Mbappe', goals: '3' },
        ]),
      ],
    );
    expect(result?.passed).toBe(true);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('uses all four shootouts even when the last query only checks tournament coverage', async () => {
    const shootouts = [
      { year: 2018, home: 'Russia', away: 'Croatia', winner: 'Croatia' },
      { year: 2022, home: 'Croatia', away: 'Brazil', winner: 'Croatia' },
      {
        year: 2022,
        home: 'Netherlands',
        away: 'Argentina',
        winner: 'Argentina',
      },
      { year: 2022, home: 'Argentina', away: 'France', winner: 'Argentina' },
    ];
    reference(shootouts);
    const result = await runResultSetCheck(
      'SELECT reference',
      ['World Cup'],
      snapshot,
      [
        sql(
          shootouts.map((row) => ({ ...row, stage: 'knockout', penalties: 4 })),
        ),
        sql([
          { year: 2018, name: '2018 FIFA World Cup' },
          { year: 2022, name: '2022 FIFA World Cup' },
        ]),
      ],
    );
    expect(result?.passed).toBe(true);
  });

  it('uses possession counts even when match-level examples follow them', async () => {
    reference([
      { higher_possession_team_won: '2', higher_possession_team_lost: '6' },
    ]);
    const result = await runResultSetCheck(
      'SELECT reference',
      ['World Cup'],
      snapshot,
      [
        sql([
          {
            matches: '8',
            winner_had_more_count: '2',
            winner_had_less_count: '6',
            tie_count: '0',
            pct_winner_had_more: '25.0',
          },
        ]),
        sql([
          {
            winner: 'Argentina',
            loser: 'Netherlands',
            winner_possession_pct: '52.00',
            loser_possession_pct: '48.00',
          },
        ]),
      ],
    );
    expect(result?.passed).toBe(true);
  });

  it('allows repeated venue facts only when the case explicitly uses distinct rows', async () => {
    reference([{ venue: 'Lusail Stadium', attendance: 88966 }]);
    const records = [
      sql([
        {
          stadium: 'Lusail Stadium',
          city: 'Lusail',
          attendance: 88966,
          match: 61,
        },
        {
          stadium: 'Lusail Stadium',
          city: 'Lusail',
          attendance: 88966,
          match: 64,
        },
      ]),
    ];
    expect(
      (
        await runResultSetCheck(
          'SELECT reference',
          ['World Cup'],
          snapshot,
          records,
        )
      )?.passed,
    ).toBe(false);
    expect(
      (
        await runResultSetCheck(
          'SELECT reference',
          ['World Cup'],
          snapshot,
          records,
          { distinctRows: true },
        )
      )?.passed,
    ).toBe(true);
  });

  it.each(
    [
      [
        { stadium: 'Lusail Stadium', attendance: 88966 },
        { stadium: 'Lusail Stadium', attendance: 88000 },
      ],
      [
        { stadium: 'Lusail Stadium', attendance: 88966 },
        { stadium: 'Other Stadium', attendance: 88966 },
      ],
      [{ stadium: 'Lusail Stadium' }],
      [],
    ].map((rows) => ({ rows })),
  )('rejects incorrect or missing distinct facts: %p', async ({ rows }) => {
    reference([{ venue: 'Lusail Stadium', attendance: 88966 }]);
    const result = await runResultSetCheck(
      'SELECT reference',
      ['World Cup'],
      snapshot,
      [sql(rows)],
      { distinctRows: true },
    );
    expect(result?.passed).toBe(false);
  });

  it('does not discard extra rows from a leaderboard to manufacture a match', async () => {
    reference([{ player: 'Lionel Messi', goals: 4 }]);
    const result = await runResultSetCheck(
      'SELECT reference',
      ['World Cup'],
      snapshot,
      [
        sql([
          { player: 'Lionel Messi', goals: 4 },
          { player: 'Kylian Mbappe', goals: 3 },
        ]),
      ],
    );
    expect(result?.passed).toBe(false);
  });

  it('requires every reference fact, even when a narrower SQL result agrees', async () => {
    reference([{ won: 2, lost: 6 }]);
    expect(
      (
        await runResultSetCheck('SELECT reference', ['World Cup'], snapshot, [
          sql([{ won: 2 }]),
        ])
      )?.passed,
    ).toBe(false);
  });

  it('does not combine incomplete results from different queries', async () => {
    reference([{ team: 'Argentina' }, { team: 'Croatia' }]);
    expect(
      (
        await runResultSetCheck('SELECT reference', ['World Cup'], snapshot, [
          sql([{ team: 'Argentina' }]),
          sql([{ team: 'Croatia' }]),
        ])
      )?.passed,
    ).toBe(false);
  });

  it.each([
    { error: 'failed' },
    { tool: 'sample_rows' },
    { truncated: true },
    { rowCount: 2 },
    { rows: undefined },
  ])('does not accept unusable evidence: %p', async (overrides) => {
    reference([{ team: 'Argentina' }]);
    expect(
      (
        await runResultSetCheck('SELECT reference', ['World Cup'], snapshot, [
          { ...sql([{ team: 'Argentina' }]), ...overrides },
          sql([{ team: 'France' }]),
        ])
      )?.passed,
    ).toBe(false);
  });

  it('does not confuse missing rows with a verified empty result', async () => {
    reference([]);
    expect(
      (
        await runResultSetCheck('SELECT reference', ['World Cup'], snapshot, [
          { tool: 'run_readonly_sql', input: 'SELECT answer' },
        ])
      )?.passed,
    ).toBe(false);
    expect(
      (
        await runResultSetCheck('SELECT reference', ['World Cup'], snapshot, [
          sql([]),
        ])
      )?.passed,
    ).toBe(true);
  });

  it('fails if the reference itself is truncated', async () => {
    reference([{ team: 'Argentina' }], true);
    const result = await runResultSetCheck(
      'SELECT reference',
      ['World Cup'],
      snapshot,
      [sql([{ team: 'Argentina' }])],
    );
    expect(result?.passed).toBe(false);
    expect(result?.reason).toContain('reference result is truncated');
  });
});
