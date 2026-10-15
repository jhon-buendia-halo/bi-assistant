import {
  lastSuccessfulSqlRecord,
  runResultSetCheck,
  RESULT_SET_CHECK_ID,
  RESULT_SET_ROW_LIMIT,
} from './result-set-check';
import { setDatasetToolServices } from '../tool-services';
import type { DatasetToolServices, DatasetSnapshot } from '../tool-services';
import type { ToolDataRecord } from '../../modules/sessions/entities/session.entity';
import { toolDataRecord } from '../../modules/sessions/turn-data';
import { readFileSync } from 'fs';
import { join } from 'path';
import { loadEvalSets } from './eval-set-files';

function stubServices(
  overrides: Partial<DatasetToolServices> = {},
): DatasetToolServices {
  return {
    createVisual: jest.fn(),
    updateVisual: jest.fn(),
    getDatasets: jest.fn(),
    sampleRows: jest.fn(),
    runReadOnlySql: jest.fn(),
    restTarget: jest.fn(),
    exportRfpPackage: jest.fn(),
    showPanelItem: jest.fn(),
    updateWorkflow: jest.fn(),
    ...overrides,
  };
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

  it('accepts repeated venue facts, with or without distinct rows', async () => {
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
    ).toBe(true);
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
        { stadium: 'Other Stadium', attendance: 88966 },
        { stadium: 'Lusail Stadium', attendance: 88966 },
      ],
    ].map((rows) => ({ rows })),
  )(
    'accepts the distinct fact among other rows (extra rows are allowed): %p',
    async ({ rows }) => {
      reference([{ venue: 'Lusail Stadium', attendance: 88966 }]);
      const result = await runResultSetCheck(
        'SELECT reference',
        ['World Cup'],
        snapshot,
        [sql(rows)],
        { distinctRows: true },
      );
      expect(result?.passed).toBe(true);
    },
  );

  it.each(
    [
      [{ stadium: 'Lusail Stadium', attendance: 88000 }],
      [{ stadium: 'Other Stadium', attendance: 88966 }],
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

  it('accepts a leaderboard that holds the answer row (extra rows are allowed)', async () => {
    reference([{ player: 'Lionel Messi', goals: 4 }]);
    const result = await runResultSetCheck(
      'SELECT reference',
      ['World Cup'],
      snapshot,
      [
        sql([
          { player: 'Kylian Mbappe', goals: 3 },
          { player: 'Lionel Messi', goals: 4 },
        ]),
      ],
    );
    expect(result?.passed).toBe(true);
  });

  it('accepts the final among all knockout matches, with extra columns', async () => {
    reference([
      {
        home_team: 'France',
        away_team: 'Croatia',
        home_goals: 4,
        away_goals: 2,
      },
    ]);
    const result = await runResultSetCheck(
      'SELECT reference',
      ['World Cup'],
      snapshot,
      [
        sql([
          {
            stage: 'semi_final',
            home: 'France',
            away: 'Belgium',
            home_goals: 1,
            away_goals: 0,
          },
          {
            stage: 'final',
            home: 'France',
            away: 'Croatia',
            home_goals: 4,
            away_goals: 2,
          },
        ]),
      ],
    );
    expect(result?.passed).toBe(true);
  });

  it('rejects a leaderboard whose row for the answer holds the wrong figure', async () => {
    reference([{ player: 'Lionel Messi', goals: 4 }]);
    const result = await runResultSetCheck(
      'SELECT reference',
      ['World Cup'],
      snapshot,
      [
        sql([
          { player: 'Lionel Messi', goals: 3 },
          { player: 'Kylian Mbappe', goals: 8 },
        ]),
      ],
    );
    expect(result?.passed).toBe(false);
    expect(result?.reason).toContain('no row holds the reference row');
  });

  it('needs a row of its own for each reference row', async () => {
    reference([
      { team: 'Argentina', goals: 3 },
      { team: 'Argentina', goals: 3 },
    ]);
    const once = [sql([{ team: 'Argentina', goals: 3, stage: 'final' }])];
    expect(
      (
        await runResultSetCheck(
          'SELECT reference',
          ['World Cup'],
          snapshot,
          once,
        )
      )?.passed,
    ).toBe(false);
  });

  it('rejects any rows when the reference is empty', async () => {
    reference([]);
    const result = await runResultSetCheck(
      'SELECT reference',
      ['World Cup'],
      snapshot,
      [sql([{ team: 'Argentina' }])],
    );
    expect(result?.passed).toBe(false);
    expect(result?.reason).toContain('expected no rows, got 1');
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
    // Clipped in storage: two rows came back, one was kept.
    { truncated: true, rowCount: 2 },
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

  describe('a result truncated at its own row limit (R31, BA-183)', () => {
    /**
     * The real champion-2022 trace of the baseline (evidence/1.1.2): the
     * model asked for `limit: 1`, got the one right row, and the tool marked
     * it truncated because the row count reached the limit. Before BA-183
     * the check refused it, a false negative of the check, not the model.
     */
    function championCall(): { name: string; input: string; output: string } {
      const run = JSON.parse(
        readFileSync(
          join(
            __dirname,
            '../../../../evidence/1.1.2/baseline/world-cup-postgres-run1.json',
          ),
          'utf8',
        ),
      ) as {
        results: {
          id: string;
          toolCalls: { name: string; input: string; output: string }[];
        }[];
      };
      return run.results.find((r) => r.id === 'champion-2022')!.toolCalls[0];
    }

    /** The record `onStepFinish` captures from that call. */
    function championRecord(): ToolDataRecord {
      const call = championCall();
      const record = toolDataRecord(
        call.name,
        JSON.parse(call.input) as Record<string, unknown>,
        JSON.parse(call.output),
      );
      if (!record) throw new Error('no record');
      return record;
    }

    it('reads the baseline trace as one captured row, flagged truncated', () => {
      expect(JSON.parse(championCall().input)).toMatchObject({ limit: 1 });
      expect(championRecord()).toMatchObject({
        tool: 'run_readonly_sql',
        rows: [{ champion_team: 'Argentina' }],
        rowCount: 1,
        truncated: true,
      });
    });

    it('matches when the truncated capture holds every reference row', async () => {
      reference([{ champion: 'Argentina' }]);
      const result = await runResultSetCheck(
        'SELECT reference',
        ['World Cup'],
        snapshot,
        [championRecord()],
      );
      expect(result).toMatchObject({ passed: true, score: 1 });
    });

    it('still fails when the truncated capture misses a reference row', async () => {
      reference([{ champion: 'Argentina' }, { champion: 'France' }]);
      const result = await runResultSetCheck(
        'SELECT reference',
        ['World Cup'],
        snapshot,
        [championRecord()],
      );
      expect(result?.passed).toBe(false);
      expect(result?.reason).toContain(
        'the result reached its row limit (1 rows) and no row holds the reference row [france]',
      );
    });

    it('matches when the truncated capture holds the reference row among others (extra rows are allowed, BA-209)', async () => {
      reference([{ team: 'Argentina' }]);
      const result = await runResultSetCheck(
        'SELECT reference',
        ['World Cup'],
        snapshot,
        [
          {
            ...sql([{ team: 'Argentina' }, { team: 'France' }]),
            rowCount: 2,
            truncated: true,
          },
        ],
      );
      expect(result).toMatchObject({ passed: true, score: 1 });
    });
  });
});

describe('the catalog a Databricks reference runs in (agents-evals R191)', () => {
  const REFERENCE = loadEvalSets()
    .find((set) => set.id === 'world-cup-databricks-only')
    ?.cases.find((evalCase) => evalCase.id === 'dbx-only-youngest-scorer-2022')
    ?.expectedSql as string;
  const AGENT = [
    {
      tool: 'run_readonly_sql',
      input: 'SELECT …',
      rows: [{ player: 'Josko Gvardiol', age: 20 }],
    },
  ];
  function databricks(tables: string[]): DatasetSnapshot[] {
    return [
      {
        name: 'World Cup (Databricks)',
        datasourceId: 'dbx-1',
        datasourceKind: 'databricks',
        tables,
      },
    ];
  }

  afterEach(() => {
    setDatasetToolServices(stubServices());
  });

  it('runs a real reference in the catalog of the selected datasets', async () => {
    const runReadOnlySql = jest.fn().mockResolvedValue({
      columns: ['full_name', 'age_in_years'],
      rows: [{ full_name: 'Josko Gvardiol', age_in_years: 20 }],
    });
    setDatasetToolServices(stubServices({ runReadOnlySql }));

    const result = await runResultSetCheck(
      REFERENCE,
      ['World Cup (Databricks)'],
      databricks([
        'dev_sandbox.world_cup.goals',
        'dev_sandbox.world_cup.players',
      ]),
      AGENT,
    );

    expect(REFERENCE).toContain('FROM `evals`.world_cup.goals g');
    const ran = (runReadOnlySql.mock.calls as unknown[][])[0][1] as string;
    expect(ran).toBe(REFERENCE.split('`evals`.').join('`dev_sandbox`.'));
    expect(ran).not.toContain('evals');
    expect(result?.passed).toBe(true);
  });

  it('refuses datasets whose entities span catalogs, and runs nothing', async () => {
    const runReadOnlySql = jest.fn();
    setDatasetToolServices(stubServices({ runReadOnlySql }));

    const result = await runResultSetCheck(
      REFERENCE,
      ['World Cup (Databricks)'],
      databricks(['evals.world_cup.goals', 'main.world_cup.players']),
      AGENT,
    );

    expect(runReadOnlySql).not.toHaveBeenCalled();
    expect(result?.passed).toBe(false);
    expect(result?.reason).toBe(
      'expectedSql failed to run — The selected datasets span several catalogs (evals, main); ' +
        'the Databricks reference queries run in one. Select datasets whose entities are all in one catalog.',
    );
  });

  it('runs a reference on any other datasource as written', async () => {
    const runReadOnlySql = jest.fn().mockResolvedValue({
      columns: ['n'],
      rows: [{ n: 1 }],
    });
    setDatasetToolServices(stubServices({ runReadOnlySql }));
    const sql = 'SELECT 1 AS n FROM `evals`.world_cup.goals';

    await runResultSetCheck(
      sql,
      ['World Cup'],
      [
        {
          name: 'World Cup',
          datasourceId: 'ds-1',
          datasourceKind: 'postgres',
          tables: ['other.world_cup.goals'],
        },
      ],
      [{ tool: 'run_readonly_sql', input: 'SELECT 1', rows: [{ n: 1 }] }],
    );

    expect((runReadOnlySql.mock.calls as unknown[][])[0][1]).toBe(sql);
  });
});
