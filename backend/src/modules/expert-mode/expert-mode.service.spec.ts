// The agent file builds a real Mastra Agent at import; stub the class so the
// real zod output schema loads without the framework.
jest.mock('@mastra/core/agent', () => ({
  Agent: class {
    constructor(readonly config: unknown) {}
  },
}));
jest.mock('../../mastra/mastra.service', () => ({ MastraService: class {} }));
jest.mock('../../mastra/model-resolver', () => ({
  resolveAgentModel: jest.fn(),
  lastAgentModelId: () => 'openai/gpt-5',
}));
jest.mock('./repositories/reasoning-feedback.repository', () => ({
  ReasoningFeedbackRepository: class {},
}));

import { ExpertModeService, type TraceInput } from './expert-mode.service';
import type { DatasetEntitySnapshot } from '../datasets/repositories/datasets.repository';
import type {
  AssumptionsBlock,
  DataSelectionBlock,
  InterpretationBlock,
  MetricBlock,
  ReasoningTrace,
  SqlBlock,
} from './entities/reasoning-trace.entity';

const column = (
  name: string,
  type = 'text',
  references?: { entity: string; column: string },
) => ({
  name,
  type,
  nullable: true,
  ...(references
    ? { references: { ...references, source: 'declared' as const } }
    : {}),
});

const ENTITIES: DatasetEntitySnapshot[] = [
  {
    key: 'world_cup.hr.employees',
    columns: [
      column('id', 'integer'),
      column('department_id', 'integer', {
        entity: 'world_cup.hr.departments',
        column: 'id',
      }),
      column('employment_type'),
    ],
  },
  {
    key: 'world_cup.hr.departments',
    columns: [column('id', 'integer'), column('division')],
  },
  {
    key: 'world_cup.hr.salary_history',
    columns: [
      column('employee_id', 'integer', {
        entity: 'world_cup.hr.employees',
        column: 'id',
      }),
      column('annual_base_amount', 'numeric'),
      column('currency'),
      column('effective_from', 'date'),
    ],
  },
  {
    key: 'world_cup.hr.exchange_rates',
    columns: [
      column('currency'),
      column('year', 'integer'),
      column('rate_to_usd', 'numeric'),
    ],
  },
  {
    key: 'world_cup.hr.bonus_payments',
    columns: [column('employee_id', 'integer'), column('amount', 'numeric')],
  },
];

const FINAL_SQL = `SELECT AVG(s.annual_base_amount * x.rate_to_usd) AS avg_salary_usd
FROM world_cup.hr.salary_history s
JOIN world_cup.hr.employees e ON e.id = s.employee_id
JOIN world_cup.hr.departments d ON d.id = e.department_id
JOIN world_cup.hr.exchange_rates x ON x.currency = s.currency AND x.year = 2025
WHERE d.division = 'Technology'
  AND e.employment_type = 'employee'
  AND s.effective_from <= DATE '2025-12-31'`;

const METRICS_BLOCK = [
  'Governed metric definitions (curated — ALWAYS prefer these exact expressions when the question asks for the metric):',
  '- Average base salary (USD) (avg_base_salary_usd) on world_cup.hr.salary_history: AVG(annual_base_amount * rate_to_usd)',
].join('\n');

function input(overrides: Partial<TraceInput> = {}): TraceInput {
  return {
    sessionId: 'session-1',
    question: 'What is the average salary of tech employees in 2025?',
    answer: 'The average 2025 base salary of tech employees was $132,400.',
    data: [
      {
        tool: 'run_readonly_sql',
        input: 'SELECT salary FROM world_cup.hr.employees',
        error: 'column "salary" does not exist',
        rationale: 'I look for a salary column on employees.',
      },
      {
        tool: 'run_readonly_sql',
        input: `  ${FINAL_SQL}  `,
        columns: ['avg_salary_usd'],
        rows: [{ avg_salary_usd: 132400.5 }],
        rowCount: 1,
        rationale: 'I average the base salary effective at year end.',
      },
    ],
    entities: ENTITIES,
    knowledgeUsed: [
      {
        id: 'k1',
        kind: 'term',
        title: 'Tech employees',
        body: 'Employees whose department is in the Technology division.',
      },
      {
        id: 'k2',
        kind: 'default_filter',
        title: 'Employees only',
        body: "employment_type = 'employee' unless asked.",
      },
    ],
    metricsBlock: METRICS_BLOCK,
    verified: false,
    crossCheck: { status: 'agree', note: 'same results' },
    ...overrides,
  };
}

/** What the explainer model "returns" — deliberately imperfect. */
function modelOutput() {
  return {
    interpretation: {
      restatement:
        'The average base salary on 31 December 2025, in USD, of employees in the Technology division.',
      terms: [
        {
          term: 'tech employees',
          mappedTo: 'employees in Technology division departments',
          basis: 'knowledge',
          sourceRef: 'Tech employees',
        },
        {
          term: 'salary',
          mappedTo: 'annual base pay',
          basis: 'knowledge',
          sourceRef: 'Pay policy handbook',
        },
        {
          term: 'average',
          mappedTo: 'mean of USD base pay',
          basis: 'knowledge',
          sourceRef: 'avg_base_salary_usd',
        },
      ],
      ambiguities: ['Tech by job family instead of division', '  '],
      selfConfidence: 0.9,
    },
    dataSelection: {
      tables: [
        {
          entity: 'hr.salary_history',
          role: 'fact',
          reason: 'Salary lives in the salary history.',
          columnsUsed: ['annual_base_amount', 'bogus_column', 's.currency'],
        },
        {
          entity: 'world_cup.hr.employees',
          role: 'dimension',
          reason: 'Employment type and department.',
          columnsUsed: [],
        },
        {
          entity: 'world_cup.hr.bonus_payments',
          role: 'fact',
          reason: 'Bonuses.',
          columnsUsed: ['amount'],
        },
      ],
      joins: [
        {
          from: 'hr.employees',
          fromColumn: 'id',
          to: 'hr.salary_history',
          toColumn: 'employee_id',
          basis: 'knowledge',
        },
        {
          from: 'world_cup.hr.employees',
          fromColumn: 'id',
          to: 'world_cup.hr.bonus_payments',
          toColumn: 'employee_id',
          basis: 'schema',
        },
      ],
      rejected: [
        {
          entity: 'world_cup.hr.bonus_payments',
          reason: 'Bonuses are not salary.',
        },
        { entity: 'world_cup.hr.employees', reason: 'Contradiction.' },
        { entity: 'world_cup.hr.imaginary', reason: 'Not bound.' },
      ],
      selfConfidence: 0.8,
    },
    assumptions: {
      items: [
        {
          id: 'A1',
          statement:
            'Only regular employees count; contractors and interns are left out.',
          sqlFragment: "E.EMPLOYMENT_TYPE='employee'",
          basis: 'knowledge',
          sourceRef: 'employees only',
          alternative: 'Including contractors changes the average.',
        },
        {
          id: 'A2',
          statement: 'Salary for 2025 is the rate in force at year end.',
          basis: 'assumption',
          sourceRef: null,
        },
        { id: 'A3', statement: '   ', basis: 'assumption' },
      ],
      selfConfidence: 0.7,
    },
    metric: {
      name: 'Average base salary (USD)',
      formula: 'avg(s.annual_base_amount * x.rate_to_usd)',
      grain: 'one salary row in force on 2025-12-31',
      basis: 'metric',
      sourceRef: 'Average base salary (USD)',
      selfConfidence: 0.85,
    },
    sql: {
      annotations: [
        {
          clause: "WHERE d.division = 'Technology'",
          explanation: 'Tech means the Technology division.',
          assumptionIds: [],
        },
        {
          clause: "d.division IN ('Technology')",
          explanation: 'A paraphrase the SQL never says.',
          assumptionIds: [],
        },
        {
          clause: "e.employment_type   =   'employee'",
          explanation: 'Employees only.',
          assumptionIds: ['A1', 'zz'],
        },
      ],
      selfConfidence: 0.9,
    },
  };
}

function build(replies: unknown[]) {
  const generate = jest.fn();
  for (const reply of replies) {
    if (reply instanceof Error) generate.mockRejectedValueOnce(reply);
    else generate.mockResolvedValueOnce(reply);
  }
  const mastra = { getAgent: jest.fn().mockReturnValue({ generate }) };
  const repository = { upsert: jest.fn(), list: jest.fn() };
  const service = new ExpertModeService(mastra as never, repository as never);
  return { service, generate, mastra, repository };
}

const block = <T>(trace: ReasoningTrace | undefined, kind: string): T =>
  trace!.blocks.find((b) => b.kind === kind) as T;

describe('ExpertModeService.buildTrace', () => {
  it('calls the business-expert agent once, tool-free, with structured output', async () => {
    const { service, generate, mastra } = build([{ object: modelOutput() }]);

    await service.buildTrace(input());

    expect(mastra.getAgent).toHaveBeenCalledWith('business-expert');
    expect(generate).toHaveBeenCalledTimes(1);
    const [prompt, options] = generate.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(options).toEqual(
      expect.objectContaining({
        maxSteps: 1,
        toolChoice: 'none',
        providerOptions: { openai: { reasoningEffort: 'medium' } },
        structuredOutput: expect.objectContaining({
          jsonPromptInjection: 'inline',
        }),
      }),
    );
    expect(prompt).toContain(
      'What is the average salary of tech employees in 2025?',
    );
    expect(prompt).toContain('$132,400');
    expect(prompt).toContain(FINAL_SQL);
    expect(prompt).toContain('<final-sql rows="1">');
    expect(prompt).toContain('{"avg_salary_usd":132400.5}');
    // The failed attempt is an exploration step, with its error.
    expect(prompt).toContain('column "salary" does not exist');
    // Referenced entities get typed columns and join edges; others names only.
    expect(prompt).toContain(
      'world_cup.hr.salary_history(employee_id integer -> world_cup.hr.employees.id, annual_base_amount numeric',
    );
    expect(prompt).toContain(
      'world_cup.hr.bonus_payments: employee_id, amount',
    );
    expect(prompt).toContain(
      '- title: Tech employees | kind: term | body: Employees whose',
    );
    expect(prompt).toContain('Average base salary (USD) (avg_base_salary_usd)');
    expect(prompt).toContain('<verified-queries>\n(none)');
  });

  it('takes the SQL and row count from the records, never from the model (a)', async () => {
    const { service } = build([{ object: modelOutput() }]);

    const trace = await service.buildTrace(input());

    expect(trace?.blocks.map((b) => b.kind)).toEqual([
      'interpretation',
      'data-selection',
      'assumptions',
      'metric',
      'sql',
    ]);
    const sql = block<SqlBlock>(trace, 'sql');
    expect(sql.sql).toBe(FINAL_SQL);
    expect(sql.rowCount).toBe(1);
    // The paraphrase is dropped; kept clauses are verbatim substrings of the
    // SQL, and annotation ids point at the renumbered assumptions.
    expect(sql.annotations).toEqual([
      {
        clause: "WHERE d.division = 'Technology'",
        explanation: 'Tech means the Technology division.',
        assumptionIds: [],
      },
      {
        clause: "e.employment_type = 'employee'",
        explanation: 'Employees only.',
        assumptionIds: ['a1'],
      },
    ]);
    for (const note of sql.annotations)
      expect(FINAL_SQL).toContain(note.clause);
  });

  it('reconciles tables and joins with what the statement reads (b)', async () => {
    const { service } = build([{ object: modelOutput() }]);

    const trace = await service.buildTrace(input());
    const selection = block<DataSelectionBlock>(trace, 'data-selection');

    expect(selection.tables.map((t) => [t.entity, t.role, t.reason])).toEqual([
      [
        'world_cup.hr.salary_history',
        'fact',
        'Salary lives in the salary history.',
      ],
      [
        'world_cup.hr.employees',
        'dimension',
        'Employment type and department.',
      ],
      // Referenced but omitted by the model: added as lookups.
      ['world_cup.hr.departments', 'lookup', 'Referenced by the query'],
      ['world_cup.hr.exchange_rates', 'lookup', 'Referenced by the query'],
    ]);
    // Model columns that do not exist are dropped; the SQL's own are added.
    const salary = selection.tables[0].columnsUsed;
    expect(salary.slice(0, 2)).toEqual(['annual_base_amount', 'currency']);
    expect(salary).not.toContain('bogus_column');
    expect(salary).toEqual(
      expect.arrayContaining(['employee_id', 'effective_from']),
    );

    expect(selection.joins).toEqual([
      // The model's join, basis corrected to the declared edge it follows.
      {
        from: 'world_cup.hr.employees',
        fromColumn: 'id',
        to: 'world_cup.hr.salary_history',
        toColumn: 'employee_id',
        basis: 'schema',
      },
      // The statement's own joins the model left out.
      {
        from: 'world_cup.hr.departments',
        fromColumn: 'id',
        to: 'world_cup.hr.employees',
        toColumn: 'department_id',
        basis: 'schema',
      },
      {
        from: 'world_cup.hr.exchange_rates',
        fromColumn: 'currency',
        to: 'world_cup.hr.salary_history',
        toColumn: 'currency',
        basis: 'convention',
      },
    ]);
    // A rejected table the query uses, or one that is not bound, is dropped.
    expect(selection.rejected).toEqual([
      {
        entity: 'world_cup.hr.bonus_payments',
        reason: 'Bonuses are not salary.',
      },
    ]);
  });

  it('keeps only curated-source claims that name a source in the context (c)', async () => {
    const { service } = build([{ object: modelOutput() }]);

    const trace = await service.buildTrace(input());
    const interpretation = block<InterpretationBlock>(trace, 'interpretation');

    expect(interpretation.terms).toEqual([
      expect.objectContaining({
        term: 'tech employees',
        basis: 'knowledge',
        sourceRef: 'Tech employees',
      }),
      // Cites a handbook the turn was never given: downgraded, kept visible.
      expect.objectContaining({
        term: 'salary',
        basis: 'assumption',
        sourceRef: 'Pay policy handbook (unverified)',
      }),
      // Cites a governed metric under the wrong kind: relabelled.
      expect.objectContaining({
        term: 'average',
        basis: 'metric',
        sourceRef: 'avg_base_salary_usd',
      }),
    ]);
    expect(interpretation.ambiguities).toEqual([
      'Tech by job family instead of division',
    ]);

    const assumptions = block<AssumptionsBlock>(trace, 'assumptions');
    expect(assumptions.items).toEqual([
      {
        id: 'a1',
        statement:
          'Only regular employees count; contractors and interns are left out.',
        // Located in the SQL and replaced by its verbatim text.
        sqlFragment: "e.employment_type = 'employee'",
        basis: 'knowledge',
        // Normalised to the snippet's own title.
        sourceRef: 'Employees only',
        alternative: 'Including contractors changes the average.',
      },
      {
        id: 'a2',
        statement: 'Salary for 2025 is the rate in force at year end.',
        basis: 'assumption',
      },
    ]);

    const metric = block<MetricBlock>(trace, 'metric');
    expect(metric).toEqual(
      expect.objectContaining({
        name: 'Average base salary (USD)',
        formula: 'AVG(s.annual_base_amount * x.rate_to_usd)',
        basis: 'metric',
        sourceRef: 'Average base salary (USD)',
      }),
    );
  });

  it('downgrades a knowledge claim when the turn carried no such snippet', async () => {
    const { service } = build([{ object: modelOutput() }]);

    const trace = await service.buildTrace(input({ knowledgeUsed: [] }));

    const terms = block<InterpretationBlock>(trace, 'interpretation').terms;
    expect(terms[0]).toEqual(
      expect.objectContaining({
        basis: 'assumption',
        sourceRef: 'Tech employees (unverified)',
      }),
    );
  });

  it('computes every confidence from measured signals', async () => {
    const { service } = build([{ object: modelOutput() }]);

    const trace = await service.buildTrace(input());
    const sql = block<SqlBlock>(trace, 'sql');

    expect(
      sql.confidence.signals.map((s) => [s.id, s.value, s.weight]),
    ).toEqual([
      ['cross_check', 1, 0.3],
      ['execution', 1, 0.25],
      ['schema_grounding', 1, 0.25],
      ['self_report', 0.9, 0.1],
    ]);
    expect(sql.confidence.score).toBe(0.99);
    expect(sql.confidence.band).toBe('high');

    const selection = block<DataSelectionBlock>(trace, 'data-selection');
    const join = selection.confidence.signals.find(
      (s) => s.id === 'join_grounding',
    );
    // 2 of the statement's 3 joins follow a declared edge.
    expect(join?.value).toBe(0.67);

    expect(trace).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        version: 1,
        model: 'openai/gpt-5',
        generatedAt: expect.any(String),
      }),
    );
    expect(trace!.overall.signals.map((s) => s.id)).toEqual([
      'execution',
      'cross_check',
      'schema_grounding',
      'knowledge_coverage',
    ]);
    expect(trace!.overall.score).toBeGreaterThan(0);
    expect(trace!.overall.score).toBeLessThanOrEqual(1);
  });

  it('caps the overall score on a disagreeing cross-check and floors it when verified', async () => {
    const disagree = await build([
      { object: modelOutput() },
    ]).service.buildTrace(
      input({ crossCheck: { status: 'disagree', note: 'results differ' } }),
    );
    expect(disagree!.overall.score).toBeLessThanOrEqual(0.5);
    expect(
      disagree!.overall.signals.find((s) => s.id === 'cross_check')?.note,
    ).toContain('caps the overall confidence at 50%');

    const verified = await build([
      { object: modelOutput() },
    ]).service.buildTrace(input({ verified: true, crossCheck: undefined }));
    expect(verified!.overall.score).toBeGreaterThanOrEqual(0.85);
    expect(verified!.overall.signals.map((s) => s.id)).toContain(
      'verified_match',
    );
  });

  it('counts an auto-repaired final statement against execution', async () => {
    const { service } = build([{ object: modelOutput() }]);

    const trace = await service.buildTrace(input({ repairedSql: [FINAL_SQL] }));

    const execution = block<SqlBlock>(trace, 'sql').confidence.signals.find(
      (s) => s.id === 'execution',
    );
    expect(execution?.value).toBe(0.75);
    expect(execution?.note).toContain('auto-repaired');
  });

  it('builds only interpretation and assumptions when no SQL succeeded', async () => {
    const { service, generate } = build([{ object: modelOutput() }]);

    const trace = await service.buildTrace(
      input({ data: [input().data[0]], crossCheck: undefined }),
    );

    expect(trace?.blocks.map((b) => b.kind)).toEqual([
      'interpretation',
      'assumptions',
    ]);
    const prompt = (generate.mock.calls as unknown[][])[0][0] as string;
    expect(prompt).toContain('no query ran successfully');
    // A sqlFragment that cannot be located stays as the model wrote it.
    expect(
      block<AssumptionsBlock>(trace, 'assumptions').items[0].sqlFragment,
    ).toBe("E.EMPLOYMENT_TYPE='employee'");
    expect(
      trace!.overall.signals.find((s) => s.id === 'execution')?.value,
    ).toBe(0);
  });

  it('retries once with the validation error, then succeeds', async () => {
    const { service, generate } = build([
      { object: { interpretation: { restatement: 'x' } } },
      { text: '```json\n' + JSON.stringify(modelOutput()) + '\n```' },
    ]);

    const trace = await service.buildTrace(input());

    expect(generate).toHaveBeenCalledTimes(2);
    const retry = (generate.mock.calls as unknown[][])[1][0] as string;
    expect(retry).toContain('<previous-reply-problem>');
    expect(retry).toContain('selfConfidence');
    expect(trace?.blocks).toHaveLength(5);
  });

  it('gives up after a second unusable reply instead of blocking the answer', async () => {
    const { service, generate } = build([
      { text: 'not json' },
      new Error('provider unavailable'),
    ]);

    await expect(service.buildTrace(input())).resolves.toBeUndefined();
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it('does nothing once the turn is aborted', async () => {
    const { service, generate } = build([{ object: modelOutput() }]);
    const controller = new AbortController();
    controller.abort();

    await expect(
      service.buildTrace(input({ abortSignal: controller.signal })),
    ).resolves.toBeUndefined();
    expect(generate).not.toHaveBeenCalled();
  });
});

describe('ExpertModeService feedback', () => {
  it('delegates writes and reads to the repository', async () => {
    const { service, repository } = build([]);
    repository.upsert.mockResolvedValue({ id: 'f-1' });
    repository.list.mockResolvedValue([{ id: 'f-1' }]);
    const key = {
      sessionId: 's-1',
      messageAt: '2026-09-29T00:00:00.000Z',
      block: 'sql' as const,
    };
    const context = {
      traceId: 't-1',
      question: 'Q?',
      blockSnapshot: {
        kind: 'sql' as const,
        sql: 'SELECT 1',
        annotations: [],
        confidence: { score: 1, band: 'high' as const, signals: [] },
      },
    };

    await expect(
      service.saveFeedback(key, context, { vote: 'up' }),
    ).resolves.toEqual({ id: 'f-1' });
    expect(repository.upsert).toHaveBeenCalledWith(key, context, {
      vote: 'up',
    });
    await expect(service.listFeedback('')).resolves.toEqual([{ id: 'f-1' }]);
    expect(repository.list).toHaveBeenCalledWith(undefined);
  });
});
