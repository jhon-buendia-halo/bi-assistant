jest.mock('@mastra/core/evals', () => ({ runEvals: jest.fn() }));
// The cases' scorers are built at import; they never run here.
jest.mock('@mastra/evals/checks', () => ({
  checks: new Proxy({}, { get: () => () => ({ id: 'stub-check' }) }),
}));
jest.mock('../agents/assistant.agent', () => ({
  assistantAgent: { id: 'assistant' },
}));
jest.mock('../agents/rfp.agent', () => ({ rfpAgent: { id: 'rfp-builder' } }));
jest.mock('../agents/data-readiness.agent', () => ({
  dataReadinessAgent: { id: 'data-readiness' },
}));
jest.mock('../agents/eval-judge.agent', () => ({
  evalJudgeAgent: {},
  evalJudgeOutputSchema: {},
}));
jest.mock('../model-resolver', () => ({ resolveAgentModel: jest.fn() }));
jest.mock('../../modules/sessions/turn-data', () => ({
  synthesizeToolOnlyTurn: jest.fn(),
  toolDataRecord: jest.fn(),
}));

import type { Agent } from '@mastra/core/agent';
import type { EvalCustomCheck, EvalRawToolCall } from './assistant.evals';
import {
  answerExcludes,
  assessOnlyWithoutReport,
  calledAtMost,
  firstDataCall,
  namesWeakestDimension,
  noScoreForUnassessed,
  numbersIn,
  oneSucceeded,
  onlyDefinedInputs,
  quotedNumbers,
  quotedNumbersFromTools,
  quotesOverallScore,
  skillBeforeAssess,
  sqlSelectsNulls,
} from './data-readiness-eval-checks';
import {
  DATA_READINESS_EVAL_SET,
  dataReadinessEvalTarget,
  readinessEvalOrientation,
} from './data-readiness.evals';
import {
  EVAL_SETS,
  agentForCases,
  evalSetsFor,
  evalTargetFor,
  hasEvals,
} from './eval-sets';

/** A fake `ReadinessSummary` (agents.md 3.13) as the tools return it. */
function summary(overrides: Record<string, unknown> = {}) {
  const dim = (
    dimension: string,
    score: number,
    findingCount = 0,
    assessed = true,
  ) => ({
    dimension,
    score,
    findingCount,
    maxSeverity: findingCount ? 'medium' : null,
    assessed,
    totalChecks: 12,
  });
  return {
    reportId: 'r-1',
    datasourceName: 'World Cup PostgreSQL',
    generatedAt: '2026-11-03T10:00:00.000Z',
    entityCount: 9,
    overallScore: 87.4,
    maturity: 'Managed',
    dimensionScores: [
      dim('completeness', 72.5, 4),
      dim('accuracy', 0, 0, false),
      dim('validity', 100),
      dim('consistency', 96.7, 1),
      dim('integrity', 90, 2),
      dim('uniqueness', 100),
      dim('timeliness', 40.3, 3),
      dim('currency', 0, 0, false),
      dim('reasonability', 99.2, 1),
      dim('accessibility', 100),
    ],
    findingCount: 11,
    topFindings: [
      {
        severity: 'high',
        dimension: 'timeliness',
        entity: 'world_cup.matches',
        measured: 1440,
        description: 'Newest record is 1440 days old',
        recommendation: 'Refresh the table',
      },
      {
        severity: 'medium',
        dimension: 'completeness',
        entity: 'world_cup.players',
        field: 'height_cm',
        measured: 0.235,
        description: '23.5% of height_cm is null',
        recommendation: 'Backfill heights',
      },
    ],
    ...overrides,
  };
}

function call(
  name: string,
  output: unknown = {},
  input: unknown = {},
  failed = false,
): EvalRawToolCall {
  return { name, input, output, failed };
}

async function run(
  check: EvalCustomCheck,
  answer: string,
  toolCalls: EvalRawToolCall[],
): Promise<string | undefined> {
  return check.run({ answer, toolCalls, datasets: ['World Cup'], vars: {} });
}

const ASSESSED = [
  call('skill', { ok: true }, { name: 'data-readiness' }),
  call('assess_data_readiness', summary(), { dataset: 'World Cup' }),
];

describe('data readiness eval checks', () => {
  describe('quotedNumbers', () => {
    it('takes percentages and numbers near score words, not dates or list markers', () => {
      const quoted = quotedNumbers(
        [
          'Overall score: **87.4/100** (Managed), assessed on 2026-11-03.',
          '1. Timeliness is the weakest at 40.3.',
          'The data has 9 tables and 23.5% of heights are missing.',
          'Here are the 3 most severe findings.',
        ].join('\n'),
      ).map((q) => q.value);
      expect(quoted).toEqual([87.4, 40.3, 23.5]);
    });

    it('skips clock times', () => {
      expect(
        quotedNumbers('| 3 | 23:21:22 | 93 | Managed | 9 |').map(
          (q) => q.value,
        ),
      ).toEqual([3, 93, 9]);
    });

    it('skips ages in years, months or weeks, not in days', () => {
      expect(
        quotedNumbers('Timeliness: nearly 4 years ago (1,440 days old).').map(
          (q) => q.value,
        ),
      ).toEqual([1440]);
    });

    it('records the decimals as written', () => {
      expect(quotedNumbers('Completeness 72.50 %')).toEqual([
        expect.objectContaining({ value: 72.5, decimals: 2 }),
      ]);
    });
  });

  it('numbersIn reads numbers in fields and text, and fractions as percentages', () => {
    const numbers = numbersIn({ a: 0.235, b: 'is 1,440 days old', c: [3] });
    expect(numbers).toEqual(expect.arrayContaining([0.235, 23.5, 1440, 3]));
  });

  describe('quotedNumbersFromTools', () => {
    const check = quotedNumbersFromTools();

    it('passes when every quoted number is in a tool result', async () => {
      await expect(
        run(
          check,
          'Overall **87.4** (Managed). Timeliness scores 40.3 and completeness 72.5; ' +
            '23.5 % of height_cm is null. Accuracy and currency are not assessed.',
          ASSESSED,
        ),
      ).resolves.toBeUndefined();
    });

    it('accepts a tool number rounded to fewer decimals', async () => {
      await expect(
        run(check, 'Overall score 87 (Managed).', ASSESSED),
      ).resolves.toBeUndefined();
    });

    it('accepts the skill method constants', async () => {
      await expect(
        run(
          check,
          'Completeness is high severity at 50% missing or more; the Managed band starts at 85.',
          ASSESSED,
        ),
      ).resolves.toBeUndefined();
    });

    it('fails an invented or adjusted score', async () => {
      const reason = await run(
        check,
        'With completeness at 100, the overall score would be 90.2.',
        ASSESSED,
      );
      expect(reason).toContain('100');
      expect(reason).toContain('90.2');
    });

    it('fails a score quoted with no readiness call', async () => {
      await expect(
        run(check, 'Your overall score is 87.4.', []),
      ).resolves.toContain('87.4');
    });

    it('ignores results of failed calls', async () => {
      await expect(
        run(check, 'Overall score 87.4.', [
          call('get_readiness_report', summary(), {}, true),
        ]),
      ).resolves.toContain('87.4');
    });

    it('passes an answer with no score-like number', async () => {
      await expect(
        run(check, 'Scores come from the deterministic engine.', []),
      ).resolves.toBeUndefined();
    });

    it('reads the summary of a raw { summary, report } result, not the report the model never saw', async () => {
      const raw = {
        summary: summary(),
        report: { id: 'r-1', findings: [{ measured: '61.9% missing' }] },
      };
      await expect(
        run(check, 'Overall score 87.4 (Managed).', [
          call('assess_data_readiness', raw),
        ]),
      ).resolves.toBeUndefined();
      await expect(
        run(check, 'Overall score 87.4; 61.9% are missing.', [
          call('assess_data_readiness', raw),
        ]),
      ).resolves.toContain('61.9');
      await expect(
        run(quotesOverallScore(), 'Overall score 87.4.', [
          call('get_readiness_report', JSON.stringify(raw)),
        ]),
      ).resolves.toBeUndefined();
    });

    it('accepts counts of a complete topFindings list, not of a cut one', async () => {
      const high = (entity: string) => ({
        severity: 'high',
        dimension: 'completeness',
        entity,
      });
      const complete = summary({
        findingCount: 7,
        topFindings: [
          ...['a', 'b', 'c', 'd', 'e', 'f'].map(high),
          { severity: 'low', dimension: 'completeness', entity: 'g' },
        ],
      });
      const answer =
        '| Completeness | 72.5 | 7 findings, 6 of them high severity |';
      await expect(
        run(check, answer, [call('assess_data_readiness', complete)]),
      ).resolves.toBeUndefined();
      const cut = { ...complete, findingCount: 30 };
      const reason = await run(check, answer, [
        call('assess_data_readiness', cut),
      ]);
      expect(reason).toContain('7 in');
      expect(reason).toContain('6 in');
    });

    it('reads list_readiness_reports results and JSON-string outputs', async () => {
      const list = {
        datasourceName: 'World Cup PostgreSQL',
        reports: [
          {
            reportId: 'r-2',
            generatedAt: '2026-11-02T09:00:00.000Z',
            overallScore: 81.6,
            maturity: 'Defined',
            entityCount: 9,
          },
        ],
        total: 1,
      };
      await expect(
        run(check, 'One report: overall 81.6 (Defined).', [
          call('list_readiness_reports', JSON.stringify(list)),
        ]),
      ).resolves.toBeUndefined();
    });
  });

  describe('quotesOverallScore', () => {
    const check = quotesOverallScore();
    it('passes when the overall score is quoted', async () => {
      await expect(
        run(check, 'Overall score: 87.4 — Managed.', ASSESSED),
      ).resolves.toBeUndefined();
    });
    it('fails when it is missing, or when there is no summary', async () => {
      await expect(
        run(check, 'The data is mostly ready.', ASSESSED),
      ).resolves.toContain('87.4');
      await expect(run(check, 'Overall 87.4', [])).resolves.toContain(
        'no successful readiness summary',
      );
    });
  });

  it('oneSucceeded passes on any listed tool that succeeded', async () => {
    const check = oneSucceeded([
      'get_readiness_report',
      'assess_data_readiness',
    ]);
    await expect(run(check, '', ASSESSED)).resolves.toBeUndefined();
    await expect(
      run(check, '', [call('get_readiness_report', { error: 'x' }, {}, true)]),
    ).resolves.toContain('no successful');
  });

  it('firstDataCall skips the skill tools', async () => {
    await expect(
      run(firstDataCall('assess_data_readiness'), '', ASSESSED),
    ).resolves.toBeUndefined();
    await expect(
      run(firstDataCall('assess_data_readiness'), '', [
        call('get_readiness_report', summary()),
        ...ASSESSED,
      ]),
    ).resolves.toContain('get_readiness_report');
  });

  it('skillBeforeAssess wants the skill loaded before the first assessment', async () => {
    const check = skillBeforeAssess();
    await expect(run(check, '', ASSESSED)).resolves.toBeUndefined();
    await expect(run(check, '', [ASSESSED[1], ASSESSED[0]])).resolves.toContain(
      'no skill("data-readiness")',
    );
    await expect(
      run(check, '', [
        call('skill', {}, { name: 'data-readiness/SKILL.md' }),
        ASSESSED[1],
      ]),
    ).resolves.toBeUndefined();
    await expect(run(check, '', [])).resolves.toContain('was not called');
  });

  it('calledAtMost counts calls', async () => {
    const check = calledAtMost('assess_data_readiness', 1);
    await expect(run(check, '', ASSESSED)).resolves.toBeUndefined();
    await expect(run(check, '', [...ASSESSED, ASSESSED[1]])).resolves.toContain(
      '2×',
    );
  });

  it('onlyDefinedInputs refuses any input beyond dataset and reportId', async () => {
    const check = onlyDefinedInputs();
    await expect(
      run(check, '', [
        call('get_readiness_report', summary(), { reportId: 'r-1' }),
        ...ASSESSED,
      ]),
    ).resolves.toBeUndefined();
    await expect(
      run(check, '', [
        call('assess_data_readiness', summary(), {
          dataset: 'World Cup',
          completeness: 100,
        }),
      ]),
    ).resolves.toContain('completeness');
  });

  describe('namesWeakestDimension', () => {
    const check = namesWeakestDimension();
    it('wants the lowest assessed dimension, ignoring unassessed zeros', async () => {
      await expect(
        run(
          check,
          'Timeliness is the worst: the newest match is old.',
          ASSESSED,
        ),
      ).resolves.toBeUndefined();
      await expect(
        run(check, 'Completeness is the worst.', ASSESSED),
      ).resolves.toContain('timeliness (40.3)');
    });
    it('accepts any dimension tied for lowest', async () => {
      const tied = summary({
        dimensionScores: [
          { dimension: 'validity', score: 50, assessed: true },
          { dimension: 'integrity', score: 50, assessed: true },
          { dimension: 'accuracy', score: 0, assessed: false },
        ],
      });
      await expect(
        run(check, 'Integrity is weakest.', [
          call('get_readiness_report', tied),
        ]),
      ).resolves.toBeUndefined();
    });
    it('uses the last summary of the run', async () => {
      const later = summary({
        dimensionScores: [
          { dimension: 'validity', score: 60, assessed: true },
          { dimension: 'timeliness', score: 90, assessed: true },
        ],
      });
      await expect(
        run(check, 'Timeliness is weakest.', [
          ...ASSESSED,
          call('get_readiness_report', later),
        ]),
      ).resolves.toContain('validity (60)');
    });
  });

  it('noScoreForUnassessed refuses a score for accuracy or currency', async () => {
    const check = noScoreForUnassessed();
    for (const ok of [
      'Accuracy is not assessed: it needs reference data.',
      '| Accuracy | — | not assessed |',
      'Accuracy and currency are 2 of the 10 dimensions and are not assessed.',
    ]) {
      await expect(run(check, ok, ASSESSED)).resolves.toBeUndefined();
    }
    for (const bad of [
      'Accuracy: 80',
      '| Accuracy | 0 | 0 |',
      'I would estimate accuracy at about 90%.',
      'Currency scores 75/100.',
    ]) {
      await expect(run(check, bad, ASSESSED)).resolves.toMatch(
        /scores (accuracy|currency)/,
      );
    }
  });

  it('answerExcludes reports the hit', async () => {
    await expect(
      run(
        answerExcludes(/argentina/i, 'names no winner'),
        'Argentina won.',
        [],
      ),
    ).resolves.toContain('Argentina');
  });

  it('quotedNumbersFromTools accepts the numbers a case allows', async () => {
    const answer = "I can't set completeness to 100%.";
    await expect(run(quotedNumbersFromTools(), answer, [])).resolves.toMatch(
      /1 number/,
    );
    await expect(
      run(quotedNumbersFromTools([100]), answer, []),
    ).resolves.toBeUndefined();
  });

  it('sqlSelectsNulls needs a successful query on the table with IS NULL', async () => {
    const check = sqlSelectsNulls('goals', 'assist_player_id');
    const sql = (text: string, failed = false) =>
      call('run_readonly_sql', { rows: [] }, { sql: text }, failed);
    await expect(
      run(check, '', [
        sql(
          'SELECT g.goal_id, g.assist_player_id FROM world_cup.goals g WHERE g.assist_player_id IS NULL',
        ),
      ]),
    ).resolves.toBeUndefined();
    await expect(
      run(check, '', [
        sql(
          'SELECT * FROM "world_cup"."goals" WHERE "assist_player_id" is null',
        ),
      ]),
    ).resolves.toBeUndefined();
    await expect(
      run(check, '', [
        sql(
          'SELECT * FROM world_cup.goals WHERE assist_player_id IS NULL',
          true,
        ),
      ]),
    ).resolves.toMatch(/no successful run_readonly_sql/);
    await expect(
      run(check, '', [
        sql('SELECT * FROM world_cup.goals WHERE assist_player_id IS NOT NULL'),
      ]),
    ).resolves.toMatch(/no query reads goals/);
    await expect(
      run(check, '', [
        sql('SELECT * FROM world_cup.matches WHERE assist_player_id IS NULL'),
      ]),
    ).resolves.toMatch(/no query reads goals/);
  });

  it('assessOnlyWithoutReport allows an assessment only after no report was found', async () => {
    const check = assessOnlyWithoutReport();
    const assess = call('assess_data_readiness', summary());
    await expect(run(check, '', [])).resolves.toBeUndefined();
    await expect(run(check, '', [assess])).resolves.toMatch(/ran although/);
    await expect(
      run(check, '', [call('get_readiness_report', summary()), assess]),
    ).resolves.toMatch(/ran although/);
    await expect(
      run(check, '', [
        call('get_readiness_report', { error: 'No assessment' }, {}, true),
        assess,
      ]),
    ).resolves.toBeUndefined();
    await expect(
      run(check, '', [
        call('list_readiness_reports', { datasourceName: 'x', reports: [] }),
        assess,
      ]),
    ).resolves.toBeUndefined();
  });
});

describe('data-readiness eval set', () => {
  it('is registered for the data-readiness agent on the world-cup fixture', () => {
    expect(DATA_READINESS_EVAL_SET).toMatchObject({
      id: 'data-readiness',
      fixtureId: 'world-cup',
      agentKey: 'data-readiness',
    });
    expect(EVAL_SETS).toContain(DATA_READINESS_EVAL_SET);
    expect(evalSetsFor('data-readiness')).toEqual([DATA_READINESS_EVAL_SET]);
    expect(hasEvals('data-readiness')).toBe(true);
    expect(agentForCases(['dr-assess', 'dr-no-sql'])).toEqual({
      agentKey: 'data-readiness',
    });
  });

  it('has unique ids, never runs SQL, and gives every case a check', () => {
    const ids = DATA_READINESS_EVAL_SET.cases.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id.startsWith('dr-'))).toBe(true);
    for (const c of DATA_READINESS_EVAL_SET.cases) {
      expect(c.expectedSql).toBeUndefined();
      expect(c.scorers.length + (c.customChecks?.length ?? 0)).toBeGreaterThan(
        0,
      );
      const checkIds = (c.customChecks ?? []).map((k) => k.id);
      expect(new Set(checkIds).size).toBe(checkIds.length);
    }
  });

  it('guards every answer that may quote a score with the numbers check', () => {
    const guarded = DATA_READINESS_EVAL_SET.cases
      .filter((c) =>
        (c.customChecks ?? []).some((k) =>
          k.id.startsWith('dr-every-score-like-number'),
        ),
      )
      .map((c) => c.id);
    expect(guarded).toEqual([
      'dr-assess',
      'dr-scores-from-tool',
      'dr-refuse-adjust',
      'dr-list-reports',
      'dr-explain-weakest',
      'dr-accuracy-not-assessed',
    ]);
  });

  it('targets the data-readiness agent with Block D1 and a bound session', async () => {
    const fake = { name: 'fake' } as unknown as Agent;
    const load = jest.fn(() => fake);
    const target = dataReadinessEvalTarget(
      () => new Date('2026-11-03T12:00:00Z'),
      load,
    );
    expect(target).toMatchObject({
      agentKey: 'data-readiness',
      sessionAgentKey: 'data-readiness',
      sendsKnowledge: false,
      sets: [DATA_READINESS_EVAL_SET],
    });
    expect(load).not.toHaveBeenCalled();
    expect(target.agent).toBe(fake);
    expect(target.agent).toBe(fake);
    expect(load).toHaveBeenCalledTimes(1);
    const block = await target.orientation({
      datasets: ['World Cup'],
      snapshots: [
        {
          name: 'World Cup',
          datasourceKind: 'postgres',
          tables: ['world_cup.matches'],
          entities: [
            { key: 'world_cup.matches', columns: [] },
            { key: 'world_cup.teams', columns: [] },
          ],
        },
      ],
      requestContext: {} as never,
    });
    expect(block).toBe(
      [
        'Datasets for this session (data readiness):',
        '- World Cup — PostgreSQL datasource "World Cup PostgreSQL", 2 entities, named like world_cup.matches',
        'Today is 2026-11-03.',
      ].join('\n'),
    );
    expect(block).not.toMatch(/score/i);
    // The judge reads the summary the model was handed, not the report.
    const raw = { summary: summary(), report: { id: 'r-1', findings: [] } };
    expect(target.judgeOutput?.(raw)).toEqual(summary());
    expect(target.judgeOutput?.({ error: 'x' })).toEqual({ error: 'x' });
  });

  it('builds Block D1 for Databricks and falls back to the table count', () => {
    expect(
      readinessEvalOrientation(
        ['Sales'],
        [
          {
            name: 'Sales',
            datasourceKind: 'databricks',
            tables: ['a', 'b', 'c'],
          },
        ],
        'Lakehouse',
        '2026-11-03',
      ),
    ).toContain('- Sales — Databricks datasource "Lakehouse", 3 entities');
  });

  it('evalTargetFor gives the data-readiness target', () => {
    expect(evalTargetFor('data-readiness', 'run-1').agentKey).toBe(
      'data-readiness',
    );
  });
});
