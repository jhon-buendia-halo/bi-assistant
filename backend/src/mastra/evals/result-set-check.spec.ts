import {
  HARNESS_UNMEASURED_PREFIX,
  lastSuccessfulSqlRecord,
  resetResultSetCheckWarnings,
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

  /** What a re-run of a candidate's own SQL returns, per statement. */
  type Replay = Record<
    string,
    { rows: Record<string, unknown>[]; truncated?: boolean } | Error
  >;

  /** The bridge always answers with a `SqlRunResult`-shaped value. */
  const runResult = (value: {
    rows: Record<string, unknown>[];
    truncated?: boolean;
  }) => ({ columns: Object.keys(value.rows[0] ?? {}), ...value });

  /**
   * The bridge as the check sees it: the reference query answers with `rows`,
   * and any other statement is a re-run of a captured call. A statement the
   * test did not stub throws, so a test that expects a replay has to say so.
   */
  function reference(
    rows: Record<string, unknown>[],
    truncated = false,
    replays: Replay = {},
  ) {
    const runReadOnlySql = jest.fn(
      (_datasourceId: string, statement: string) => {
        if (statement === 'SELECT reference') {
          return Promise.resolve(runResult({ rows, truncated }));
        }
        const replay = replays[statement];
        if (replay instanceof Error) return Promise.reject(replay);
        if (replay) return Promise.resolve(runResult(replay));
        return Promise.reject(
          new Error(`no re-run stubbed for "${statement}"`),
        );
      },
    );
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

  // An unusable capture is never taken at face value: it is either re-run
  // (see the re-run tests below) or reported as unmeasured — never compared
  // as if it were the whole result.
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

  /**
   * The measurement bug this suite now pins down: `run_readonly_sql` reports
   * `truncated` whenever a result fills the row limit the model itself asked
   * for, so a `SELECT COUNT(*)` run with `limit: 1` came back "truncated"
   * while being exactly complete — and the check refused to compare it. The
   * real genomics `cohort-sample-count` capture, verbatim.
   */
  describe('captures the connector flagged as clipped', () => {
    const counted = {
      tool: 'run_readonly_sql',
      input:
        'SELECT COUNT(*) AS sample_count FROM world_cup.genomics.samples WHERE is_control = false',
      columns: ['sample_count'],
      rows: [{ sample_count: '125' }],
      rowCount: 1,
      truncated: true,
    };

    it('re-runs the statement and passes when the full result matches', async () => {
      const query = reference([{ cohort_samples: 125 }], false, {
        [counted.input]: { rows: [{ sample_count: '125' }] },
      });
      const result = await runResultSetCheck(
        'SELECT reference',
        ['World Cup'],
        snapshot,
        [counted],
      );
      expect(result?.passed).toBe(true);
      expect(query).toHaveBeenNthCalledWith(
        2,
        'ds-1',
        counted.input,
        RESULT_SET_ROW_LIMIT,
        ['World Cup'],
      );
    });

    it('does not pass a clipped page whose full result has extra rows', async () => {
      reference([{ team: 'Argentina' }], false, {
        'SELECT answer': {
          rows: [{ team: 'Argentina' }, { team: 'France' }],
        },
      });
      const result = await runResultSetCheck(
        'SELECT reference',
        ['World Cup'],
        snapshot,
        [{ ...sql([{ team: 'Argentina' }]), truncated: true }],
      );
      expect(result?.passed).toBe(false);
      expect(result?.reason).toContain('re-run of the captured SQL');
      expect(result?.reason).not.toContain(HARNESS_UNMEASURED_PREFIX);
    });

    it('still refuses a result that is genuinely past the comparison cap', async () => {
      reference([{ team: 'Argentina' }], false, {
        'SELECT answer': { rows: [{ team: 'Argentina' }], truncated: true },
      });
      const result = await runResultSetCheck(
        'SELECT reference',
        ['World Cup'],
        snapshot,
        [{ ...sql([{ team: 'Argentina' }]), truncated: true }],
      );
      expect(result?.passed).toBe(false);
      expect(result?.reason).toContain(HARNESS_UNMEASURED_PREFIX);
      expect(result?.reason).toContain(`over ${RESULT_SET_ROW_LIMIT} rows`);
    });

    it('re-runs a capture the transcript cap clipped', async () => {
      const rows = Array.from({ length: 200 }, (_, i) => ({ n: i }));
      reference([{ n: 0 }], false, {
        'SELECT answer': { rows: [{ n: 0 }] },
      });
      const result = await runResultSetCheck(
        'SELECT reference',
        ['World Cup'],
        snapshot,
        // 240 rows came back, 200 were stored: rowCount betrays the clip.
        [{ ...sql(rows), rowCount: 240 }],
      );
      expect(result?.passed).toBe(true);
    });
  });

  describe('measurement gaps are named as harness problems', () => {
    it('says so when nothing could be compared', async () => {
      reference([{ team: 'Argentina' }]);
      const result = await runResultSetCheck(
        'SELECT reference',
        ['World Cup'],
        snapshot,
        [{ tool: 'run_readonly_sql', input: 'SELECT answer' }],
      );
      expect(result?.passed).toBe(false);
      expect(result?.reason).toContain(HARNESS_UNMEASURED_PREFIX);
      expect(result?.reason).toContain('no re-run stubbed');
    });

    it('says so when a call was captured with neither SQL nor rows', async () => {
      reference([{ team: 'Argentina' }]);
      const result = await runResultSetCheck(
        'SELECT reference',
        ['World Cup'],
        snapshot,
        [{ tool: 'run_readonly_sql' }],
      );
      expect(result?.passed).toBe(false);
      expect(result?.reason).toContain(HARNESS_UNMEASURED_PREFIX);
      expect(result?.reason).toContain('payload shape');
    });

    it('does not name the harness when the agent simply got it wrong', async () => {
      reference([{ team: 'Argentina' }]);
      const result = await runResultSetCheck(
        'SELECT reference',
        ['World Cup'],
        snapshot,
        [sql([{ team: 'France' }])],
      );
      expect(result?.reason).not.toContain(HARNESS_UNMEASURED_PREFIX);
      expect(result?.reason).toContain('did not match');
    });

    it('warns once per run, not once per case', async () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        resetResultSetCheckWarnings();
        reference([{ team: 'Argentina' }]);
        const unmeasurable = [{ tool: 'run_readonly_sql' }];
        await runResultSetCheck(
          'SELECT reference',
          ['World Cup'],
          snapshot,
          unmeasurable,
        );
        await runResultSetCheck(
          'SELECT reference',
          ['World Cup'],
          snapshot,
          unmeasurable,
        );
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0][0])).toContain(
          HARNESS_UNMEASURED_PREFIX,
        );
        // A new run warns again.
        resetResultSetCheckWarnings();
        await runResultSetCheck(
          'SELECT reference',
          ['World Cup'],
          snapshot,
          unmeasurable,
        );
        expect(warn).toHaveBeenCalledTimes(2);
      } finally {
        warn.mockRestore();
        resetResultSetCheckWarnings();
      }
    });
  });

  describe('gap: harness faults are flagged, agent mistakes are not', () => {
    it('flags a broken reference, a truncated one and a missing datasource', async () => {
      const broken = jest.fn().mockRejectedValue(new Error('syntax error'));
      setDatasetToolServices(stubServices({ runReadOnlySql: broken }));
      expect(
        await runResultSetCheck('SELECT reference', ['World Cup'], snapshot, [
          sql([{ team: 'Argentina' }]),
        ]),
      ).toMatchObject({ passed: false, gap: true });

      reference([{ team: 'Argentina' }], true);
      expect(
        await runResultSetCheck('SELECT reference', ['World Cup'], snapshot, [
          sql([{ team: 'Argentina' }]),
        ]),
      ).toMatchObject({ passed: false, gap: true });

      expect(
        await runResultSetCheck(
          'SELECT reference',
          ['World Cup'],
          [{ name: 'World Cup', tables: [] }],
          [sql([{ team: 'Argentina' }])],
        ),
      ).toMatchObject({ passed: false, gap: true });
    });

    it('flags an uncomparable capture', async () => {
      reference([{ team: 'Argentina' }]);
      for (const records of [
        [{ tool: 'run_readonly_sql' }],
        [{ tool: 'run_readonly_sql', input: 'SELECT answer' }],
      ]) {
        const result = await runResultSetCheck(
          'SELECT reference',
          ['World Cup'],
          snapshot,
          records,
        );
        expect(result).toMatchObject({ passed: false, gap: true });
        expect(result?.reason).toContain(HARNESS_UNMEASURED_PREFIX);
      }
    });

    it('never flags a wrong answer or a turn that ran no SQL', async () => {
      reference([{ team: 'Argentina' }]);
      const wrong = await runResultSetCheck(
        'SELECT reference',
        ['World Cup'],
        snapshot,
        [sql([{ team: 'France' }])],
      );
      expect(wrong?.passed).toBe(false);
      expect(wrong?.gap).toBeUndefined();
      const none = await runResultSetCheck(
        'SELECT reference',
        ['World Cup'],
        snapshot,
        [{ tool: 'run_readonly_sql', input: 'SELECT bad', error: 'boom' }],
      );
      expect(none?.passed).toBe(false);
      expect(none?.gap).toBeUndefined();
    });
  });

  describe('preferFinal: the SQL the answer used is compared first', () => {
    it('passes on the final query without a flag', async () => {
      reference([{ team: 'Argentina' }]);
      const result = await runResultSetCheck(
        'SELECT reference',
        ['World Cup'],
        snapshot,
        [
          sql([{ team: 'France' }], 'SELECT early'),
          sql([{ team: 'Argentina' }], 'SELECT final'),
        ],
      );
      expect(result?.passed).toBe(true);
      expect(result?.viaSupportingQuery).toBeUndefined();
    });

    it('passes via an earlier query, and says so', async () => {
      reference([{ team: 'Argentina' }]);
      const result = await runResultSetCheck(
        'SELECT reference',
        ['World Cup'],
        snapshot,
        [
          sql([{ team: 'Argentina' }], 'SELECT early'),
          sql([{ team: 'France' }], 'SELECT final'),
        ],
      );
      expect(result?.passed).toBe(true);
      expect(result?.viaSupportingQuery).toBe(true);
    });

    it('re-runs the final statement before any earlier one', async () => {
      const query = reference([{ team: 'Argentina' }], false, {
        'SELECT early': { rows: [{ team: 'France' }] },
        'SELECT final': { rows: [{ team: 'Argentina' }] },
      });
      const result = await runResultSetCheck(
        'SELECT reference',
        ['World Cup'],
        snapshot,
        [
          { ...sql([{ team: 'France' }], 'SELECT early'), truncated: true },
          { ...sql([{ team: 'Argentina' }], 'SELECT final'), truncated: true },
        ],
      );
      expect(result?.passed).toBe(true);
      expect(query.mock.calls.map((call) => call[1])).toEqual([
        'SELECT reference',
        'SELECT final',
      ]);
    });

    it('names the final query when nothing matched', async () => {
      reference([{ team: 'Argentina' }]);
      const result = await runResultSetCheck(
        'SELECT reference',
        ['World Cup'],
        snapshot,
        [sql([{ team: 'France' }], 'SELECT early'), sql([], 'SELECT final')],
      );
      expect(result?.passed).toBe(false);
      expect(result?.gap).toBeUndefined();
      expect(result?.reason).toContain(
        'The last SQL ("SELECT final") did not match',
      );
    });

    it('is a gap when the final result cannot be read back and no earlier one matched', async () => {
      reference([{ team: 'Argentina' }], false, {
        'SELECT final': new Error('connection reset'),
      });
      const result = await runResultSetCheck(
        'SELECT reference',
        ['World Cup'],
        snapshot,
        [
          sql([{ team: 'France' }], 'SELECT early'),
          { ...sql([{ team: 'Argentina' }], 'SELECT final'), truncated: true },
        ],
      );
      expect(result).toMatchObject({ passed: false, gap: true });
      expect(result?.reason).toContain(HARNESS_UNMEASURED_PREFIX);
      expect(result?.reason).toContain('the final SQL ("SELECT final")');
      expect(result?.reason).toContain('connection reset');
    });

    it('preferFinal: false keeps the capture-order scan, with no flag and no final-SQL gap', async () => {
      reference([{ team: 'Argentina' }], false, {
        'SELECT final': new Error('connection reset'),
      });
      const matchedEarly = await runResultSetCheck(
        'SELECT reference',
        ['World Cup'],
        snapshot,
        [
          sql([{ team: 'Argentina' }], 'SELECT early'),
          sql([{ team: 'France' }], 'SELECT final'),
        ],
        { preferFinal: false },
      );
      expect(matchedEarly?.passed).toBe(true);
      expect(matchedEarly?.viaSupportingQuery).toBeUndefined();

      const unmeasuredFinal = await runResultSetCheck(
        'SELECT reference',
        ['World Cup'],
        snapshot,
        [
          sql([{ team: 'France' }], 'SELECT early'),
          { ...sql([{ team: 'Argentina' }], 'SELECT final'), truncated: true },
        ],
        { preferFinal: false },
      );
      expect(unmeasuredFinal?.passed).toBe(false);
      expect(unmeasuredFinal?.gap).toBeUndefined();
    });
  });

  describe('precision tolerance', () => {
    it('passes an unrounded answer against a rounded reference', async () => {
      // paid-share-by-specialty: ROUND(…, 4) against the raw ratio.
      reference([
        { specialty: 'Family Medicine', paid_share_of_billed: '0.4847' },
        { specialty: 'Dermatology', paid_share_of_billed: '0.4309' },
      ]);
      const result = await runResultSetCheck(
        'SELECT reference',
        ['World Cup'],
        snapshot,
        [
          sql([
            { specialty: 'Dermatology', share: 0.4309498575791013 },
            { specialty: 'Family Medicine', share: 0.4846603671196678 },
          ]),
        ],
      );
      expect(result?.passed).toBe(true);
    });

    it('passes a rounded answer against an unrounded reference, with extra columns', async () => {
      reference([{ avg_paid_dollars: '561.6167525773195900' }]);
      const result = await runResultSetCheck(
        'SELECT reference',
        ['World Cup'],
        snapshot,
        [sql([{ claims: 1164, avg_paid: '561.62' }])],
      );
      expect(result?.passed).toBe(true);
    });

    it('still fails rounding too coarse to state the same figure', async () => {
      reference([{ share: '0.4847' }]);
      const result = await runResultSetCheck(
        'SELECT reference',
        ['World Cup'],
        snapshot,
        [sql([{ share: '0.48' }])],
      );
      expect(result?.passed).toBe(false);
      expect(result?.gap).toBeUndefined();
    });

    it('applies to distinct-row comparisons too', async () => {
      reference([{ tier: 'GOLD', share: '0.8500' }]);
      const result = await runResultSetCheck(
        'SELECT reference',
        ['World Cup'],
        snapshot,
        [
          sql([
            { tier: 'GOLD', share: 0.85004 },
            { tier: 'GOLD', share: 0.84996 },
          ]),
        ],
        { distinctRows: true },
      );
      expect(result?.passed).toBe(true);
    });
  });

  describe('expectedSqlAlternatives: any reference may judge', () => {
    const cents = [{ country: 'United States', paid_cents: '58862147' }];
    const dollars = [
      { country: 'United States', paid_dollars: '588621.470000000000' },
    ];

    /** Each reference statement answers with its rows, an error or a clip. */
    function referenceSet(
      answers: Record<
        string,
        Record<string, unknown>[] | Error | { truncated: true }
      >,
    ) {
      const runReadOnlySql = jest.fn(
        (_datasourceId: string, statement: string) => {
          const answer = answers[statement];
          if (answer instanceof Error) return Promise.reject(answer);
          if (Array.isArray(answer)) {
            return Promise.resolve(runResult({ rows: answer }));
          }
          if (answer) {
            return Promise.resolve(runResult({ rows: [], truncated: true }));
          }
          return Promise.reject(
            new Error(`no re-run stubbed for "${statement}"`),
          );
        },
      );
      setDatasetToolServices(stubServices({ runReadOnlySql }));
      return runReadOnlySql;
    }

    it('passes an answer that matches the alternative, and says which', async () => {
      referenceSet({ 'SELECT cents': cents, 'SELECT dollars': dollars });
      const result = await runResultSetCheck(
        ['SELECT cents', 'SELECT dollars'],
        ['World Cup'],
        snapshot,
        [sql([{ country: 'United States', paid: 588621.47 }])],
      );
      expect(result).toMatchObject({ passed: true, matchedReference: 1 });
      expect(result?.viaSupportingQuery).toBeUndefined();
    });

    it('records the primary as reference 0', async () => {
      referenceSet({ 'SELECT cents': cents, 'SELECT dollars': dollars });
      const result = await runResultSetCheck(
        ['SELECT cents', 'SELECT dollars'],
        ['World Cup'],
        snapshot,
        [sql([{ country: 'United States', paid: 58862147 }])],
      );
      expect(result).toMatchObject({ passed: true, matchedReference: 0 });
    });

    it('leaves matchedReference off a case with one reference', async () => {
      referenceSet({ 'SELECT cents': cents });
      const result = await runResultSetCheck(
        ['SELECT cents'],
        ['World Cup'],
        snapshot,
        [sql([{ country: 'United States', paid: 58862147 }])],
      );
      expect(result?.passed).toBe(true);
      expect(result).not.toHaveProperty('matchedReference');
    });

    it('prefers the final SQL matching an alternative over an earlier query matching the primary', async () => {
      referenceSet({ 'SELECT cents': cents, 'SELECT dollars': dollars });
      const result = await runResultSetCheck(
        ['SELECT cents', 'SELECT dollars'],
        ['World Cup'],
        snapshot,
        [
          sql([{ country: 'United States', paid: 58862147 }], 'SELECT early'),
          sql([{ country: 'United States', paid: 588621.47 }], 'SELECT final'),
        ],
      );
      expect(result).toMatchObject({ passed: true, matchedReference: 1 });
      expect(result?.viaSupportingQuery).toBeUndefined();
    });

    it('fails, naming the alternatives, when the answer matches none', async () => {
      referenceSet({ 'SELECT cents': cents, 'SELECT dollars': dollars });
      const result = await runResultSetCheck(
        ['SELECT cents', 'SELECT dollars'],
        ['World Cup'],
        snapshot,
        [sql([{ country: 'United States', paid: 5886.2147 }])],
      );
      expect(result?.passed).toBe(false);
      expect(result?.gap).toBeUndefined();
      expect(result?.reason).toContain('expectedSql returned 1 row(s)');
      expect(result?.reason).toContain(
        'nor did it match the 1 alternative reference(s)',
      );
    });

    it('is a gap only when every reference failed to run or was truncated', async () => {
      referenceSet({
        'SELECT cents': new Error('syntax error'),
        'SELECT dollars': { truncated: true },
      });
      const result = await runResultSetCheck(
        ['SELECT cents', 'SELECT dollars'],
        ['World Cup'],
        snapshot,
        [sql([{ country: 'United States', paid: 588621.47 }])],
      );
      expect(result).toMatchObject({ passed: false, gap: true });
      expect(result?.reason).toContain(HARNESS_UNMEASURED_PREFIX);
      expect(result?.reason).toContain(
        'none of the 2 references could be used',
      );
      expect(result?.reason).toContain(
        'expectedSql failed to run — syntax error',
      );
      expect(result?.reason).toContain(
        'expectedSqlAlternatives[0] is truncated',
      );
    });

    it('judges with the references that ran when one of them broke', async () => {
      referenceSet({
        'SELECT cents': new Error('syntax error'),
        'SELECT dollars': dollars,
      });
      const passed = await runResultSetCheck(
        ['SELECT cents', 'SELECT dollars'],
        ['World Cup'],
        snapshot,
        [sql([{ country: 'United States', paid: 588621.47 }])],
      );
      expect(passed).toMatchObject({ passed: true, matchedReference: 1 });

      const wrong = await runResultSetCheck(
        ['SELECT cents', 'SELECT dollars'],
        ['World Cup'],
        snapshot,
        [sql([{ country: 'Canada', paid: 65100.43 }])],
      );
      expect(wrong?.passed).toBe(false);
      expect(wrong?.gap).toBeUndefined();
      expect(wrong?.reason).toContain(
        'expectedSqlAlternatives[0] returned 1 row(s)',
      );
      expect(wrong?.reason).toContain(
        '1 reference(s) could not be used: expectedSql failed to run — syntax error',
      );
    });

    it('treats an empty list like no expectedSql', async () => {
      expect(
        await runResultSetCheck([], ['World Cup'], snapshot, []),
      ).toBeUndefined();
    });
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
    expect(result?.gap).toBe(true);
    expect(result?.reason).toContain('reference result is truncated');
  });
});
