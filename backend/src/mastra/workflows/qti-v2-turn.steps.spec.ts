const getDatasets = jest.fn();
jest.mock('../tool-services', () => ({
  getDatasetToolServices: () => ({ getDatasets }),
}));

import { checkWorkflowContract } from './workflow-contract';
import {
  QTI_V2_TURN_EDGES,
  QTI_V2_TURN_STEPS,
  analysisLoopDone,
  answerOf,
  catalogBlock,
  loadCatalog,
  PLAN_COLUMNS_PER_ENTITY,
  PLAN_COLUMNS_TOTAL,
  planCatalogBlock,
  planOf,
  receiveQuestion,
  turnSummaryOf,
  validateAttempt,
  wrapUp,
  type AnalyseQuery,
  type QtiV2Plan,
} from './qti-v2-turn.steps';
import {
  PLAN_FIRST_LINE,
  PLAN_INSTRUCTIONS,
  WRITE_ANSWER_FIRST_LINE,
  WRITE_ANSWER_INSTRUCTIONS,
  analysePlanBlock,
  writeAnswerRequest,
} from './qti-v2-turn.prompts';

const PLAN: QtiV2Plan = {
  question: 'Who scored the most goals in 2018?',
  measures: ['goals per player'],
  entities: ['world_cup.goals'],
  scope: 'The 2018 tournament.',
  assumptions: ['Own goals are not counted.'],
  needsClarification: false,
  clarification: null,
};

const query = (partial: Partial<AnalyseQuery> = {}): AnalyseQuery => ({
  sql: 'SELECT player, count(*) AS goals FROM world_cup.goals GROUP BY player',
  rationale: 'I count the goals of each player.',
  rows: [{ player: 'Kane', goals: 6 }],
  rowCount: 1,
  truncated: false,
  ...partial,
});

describe('qti-v2-turn steps (agents.md 5.11)', () => {
  it('lists the eight steps with their ids, titles and kinds, Clarify after Plan', () => {
    expect(
      QTI_V2_TURN_STEPS.map(({ id, title, kind }) => ({ id, title, kind })),
    ).toEqual([
      { id: 'receive-question', title: 'Receive question', kind: 'code' },
      { id: 'load-catalog', title: 'Load catalog', kind: 'code' },
      { id: 'plan', title: 'Plan', kind: 'agent' },
      { id: 'clarify', title: 'Clarify', kind: 'code' },
      { id: 'analyse', title: 'Analyse', kind: 'agent' },
      { id: 'validate', title: 'Validate', kind: 'code' },
      { id: 'write-answer', title: 'Write answer', kind: 'agent' },
      { id: 'wrap-up', title: 'Wrap up', kind: 'code' },
    ]);
    expect(
      QTI_V2_TURN_STEPS.filter((step) => step.modelOnly).map((s) => s.id),
    ).toEqual(['plan', 'write-answer']);
  });

  it('connects them with the edges of api.md 117', () => {
    expect(
      QTI_V2_TURN_EDGES.map(
        (e) => `${e.from}->${e.to} ${e.kind}${e.label ? ` "${e.label}"` : ''}`,
      ),
    ).toEqual([
      'start->receive-question next',
      'receive-question->load-catalog next',
      'load-catalog->plan next',
      'plan->clarify branch "Needs clarification"',
      'plan->analyse branch "Clear"',
      'analyse->validate next',
      'validate->analyse loop "Retry once"',
      'validate->write-answer next "Valid or retried"',
      'write-answer->wrap-up next',
      'wrap-up->end next',
      'clarify->end next',
    ]);
  });

  it('keeps its data contract along the edges', () => {
    expect(
      checkWorkflowContract({
        input: [
          { name: 'question', label: 'Q', type: 'textarea', required: true },
          { name: 'datasets', label: 'D', type: 'datasets', required: true },
        ],
        steps: QTI_V2_TURN_STEPS,
        edges: QTI_V2_TURN_EDGES,
      }),
    ).toEqual([]);
  });

  it('opens the Plan and Write answer instructions with their fixed first lines', () => {
    expect(PLAN_FIRST_LINE).toBe(
      'You plan a data analysis for Questions to Insights v2.',
    );
    expect(WRITE_ANSWER_FIRST_LINE).toBe(
      'You write the final answer for Questions to Insights v2.',
    );
    expect(PLAN_INSTRUCTIONS.split('\n')[0]).toBe(PLAN_FIRST_LINE);
    // Plan's assumptions are choices; its options rest on the columns.
    expect(PLAN_INSTRUCTIONS).toContain(
      'Never a fact about the world or the domain',
    );
    expect(PLAN_INSTRUCTIONS).toContain(
      'Each option is a measure the listed columns can compute',
    );
    // Write answer rounds derived figures and adds nothing from the world.
    expect(WRITE_ANSWER_INSTRUCTIONS).toContain(
      'round averages, ratios and other derived figures to at most 2 decimals, and percentages to at most 1 decimal',
    );
    expect(WRITE_ANSWER_INSTRUCTIONS).toContain(
      'leave out any that states a fact about the world or the domain',
    );
    expect(WRITE_ANSWER_INSTRUCTIONS).toContain(
      'Nothing from general knowledge anywhere, assumptions and caveats included',
    );
    expect(WRITE_ANSWER_INSTRUCTIONS.split('\n')[0]).toBe(
      WRITE_ANSWER_FIRST_LINE,
    );
  });

  describe('receiveQuestion', () => {
    it('trims the question', () => {
      expect(receiveQuestion('  How many goals?\n')).toBe('How many goals?');
    });

    it.each(['', '   ', '\n\t'])(
      'no longer fails on %p: the input node refuses a blank question before the run',
      (question) => {
        expect(receiveQuestion(question)).toBe('');
      },
    );

    it('has no exit: Receive question cannot fail', () => {
      const receive = QTI_V2_TURN_STEPS.find(
        (step) => step.id === 'receive-question',
      );
      expect(receive?.exits).toEqual([]);
      expect(receive?.summary).toBe(
        'Trims the question. The input node has checked it before the run.',
      );
    });
  });

  describe('loadCatalog', () => {
    it('lists the entities of the datasets in dataset then table order', async () => {
      getDatasets.mockResolvedValue([
        {
          name: 'World Cup',
          datasourceId: 'ds-pg',
          datasourceKind: 'postgres',
          tables: ['wc.public.matches'],
          entities: [
            {
              key: 'wc.public.matches',
              columns: [
                { name: 'id', type: 'integer' },
                { name: 'year', type: 'integer' },
                { name: 'stage', type: 'text' },
              ],
            },
          ],
        },
        { name: 'Notes', tables: ['n.public.notes'] },
      ]);
      await expect(loadCatalog(['World Cup', 'Notes'])).resolves.toEqual({
        catalog: [
          {
            entity: 'wc.public.matches',
            dataset: 'World Cup',
            datasourceId: 'ds-pg',
            datasourceKind: 'postgres',
            columnCount: 3,
          },
          {
            entity: 'n.public.notes',
            dataset: 'Notes',
            datasourceId: null,
            datasourceKind: null,
            columnCount: null,
          },
        ],
        // Plan's columns: the entities whose columns are known.
        columns: [
          {
            entity: 'wc.public.matches',
            columns: [
              { name: 'id', type: 'integer' },
              { name: 'year', type: 'integer' },
              { name: 'stage', type: 'text' },
            ],
            more: 0,
          },
        ],
      });
      expect(getDatasets).toHaveBeenCalledWith(['World Cup', 'Notes']);
    });

    it(`lists at most ${PLAN_COLUMNS_PER_ENTITY} columns per entity and ${PLAN_COLUMNS_TOTAL} in all, counting the rest`, async () => {
      const wide = (key: string, n: number) => ({
        key,
        columns: Array.from({ length: n }, (_, i) => ({
          name: `c${i}`,
          type: 'text',
        })),
      });
      const tables = Array.from({ length: 12 }, (_, i) => `t.s.e${i}`);
      getDatasets.mockResolvedValue([
        {
          name: 'Wide',
          tables,
          entities: tables.map((key) => wide(key, 50)),
        },
      ]);
      const { columns } = await loadCatalog(['Wide']);
      expect(columns[0].columns).toHaveLength(PLAN_COLUMNS_PER_ENTITY);
      expect(columns[0].more).toBe(10);
      expect(
        columns.reduce((sum, entry) => sum + entry.columns.length, 0),
      ).toBe(PLAN_COLUMNS_TOTAL);
      expect(columns[11]).toMatchObject({ columns: [], more: 50 });
    });
  });

  describe('planCatalogBlock', () => {
    const catalog = [
      {
        entity: 'wc.public.goals',
        dataset: 'World Cup',
        datasourceId: null,
        datasourceKind: null,
        columnCount: 3,
      },
    ];

    it("adds each entity's columns, name and type, to the catalog block", () => {
      expect(
        planCatalogBlock(catalog, [
          {
            entity: 'wc.public.goals',
            columns: [
              { name: 'player', type: 'text' },
              { name: 'minute', type: 'integer' },
            ],
            more: 1,
          },
        ]),
      ).toBe(
        [
          'Catalog loaded for this turn: 1 entity.',
          '- wc.public.goals (dataset: World Cup; 3 columns)',
          '',
          'Columns of each entity (name type):',
          '- wc.public.goals: player text, minute integer (+1 more not listed)',
        ].join('\n'),
      );
    });

    it('says so when no column is known', () => {
      expect(planCatalogBlock(catalog, [])).toMatch(
        /\n\nNo columns are known for these entities\.$/,
      );
    });
  });

  describe('catalogBlock', () => {
    it('says when there is no entity', () => {
      expect(catalogBlock([])).toBe(
        'Catalog loaded for this turn: no entities.',
      );
    });

    it('lists one entity per line, singular for one', () => {
      expect(
        catalogBlock([
          {
            entity: 'a.b.c',
            dataset: 'D',
            datasourceId: null,
            datasourceKind: null,
            columnCount: 5,
          },
        ]),
      ).toBe(
        'Catalog loaded for this turn: 1 entity.\n- a.b.c (dataset: D; 5 columns)',
      );
    });
  });

  describe('wrapUp', () => {
    it('counts the SQL calls, the failed ones and the rows of the others, with the answer', () => {
      expect(
        wrapUp(
          [
            { tool: 'run_readonly_sql', rowCount: 10, failed: false },
            { tool: 'run_readonly_sql', rowCount: 99, failed: true },
            { tool: 'run_readonly_sql', failed: false },
            { tool: 'describe_entity', rowCount: 7, failed: false },
          ],
          'Ten rows.',
        ),
      ).toEqual({
        sqlQueries: 3,
        failedQueries: 1,
        rows: 10,
        answer: 'Ten rows.',
      });
    });

    it('is all zero for a turn without SQL', () => {
      expect(wrapUp([], '')).toEqual({
        sqlQueries: 0,
        failedQueries: 0,
        rows: 0,
        answer: '',
      });
    });

    it("is the run's result under its branch, read back by turnSummaryOf", () => {
      const summary = wrapUp([], 'A.');
      expect(
        turnSummaryOf({ 'analysis-path': { 'answer-path': summary } }),
      ).toEqual(summary);
      expect(
        turnSummaryOf({ clarify: { question: 'Q?', options: ['a', 'b'] } }),
      ).toBeUndefined();
      expect(turnSummaryOf(undefined)).toBeUndefined();
    });
  });

  describe('planOf', () => {
    it('reads the JSON plan, fenced or bare', () => {
      expect(planOf('```json\n' + JSON.stringify(PLAN) + '\n```', 'Q')).toEqual(
        PLAN,
      );
      expect(planOf(PLAN, 'Q')).toEqual(PLAN);
    });

    it('keeps a clarification only with a question and 2-4 options', () => {
      const asked = {
        ...PLAN,
        needsClarification: true,
        clarification: {
          question: 'Dominant by what?',
          options: ['Wins', 'Goals', 'Possession', 'Shots', 'Titles'],
        },
      };
      expect(planOf(asked, 'Q').clarification).toEqual({
        question: 'Dominant by what?',
        options: ['Wins', 'Goals', 'Possession', 'Shots'],
      });
      const oneOption = {
        ...asked,
        clarification: { question: 'Dominant by what?', options: ['Wins'] },
      };
      expect(planOf(oneOption, 'Q')).toMatchObject({
        needsClarification: false,
        clarification: null,
      });
    });

    it('plans nothing from a reply that is no JSON object: the question as is', () => {
      expect(planOf('I cannot plan this.', 'How many goals?')).toEqual({
        question: 'How many goals?',
        measures: [],
        entities: [],
        scope: '',
        assumptions: [],
        needsClarification: false,
        clarification: null,
      });
    });
  });

  describe('answerOf', () => {
    it('reads the answer and its headline', () => {
      expect(
        answerOf({
          headline: 'Kane scored 6.',
          answer: 'Kane scored 6.\n\nMore.',
        }),
      ).toEqual({
        headline: 'Kane scored 6.',
        answer: 'Kane scored 6.\n\nMore.',
      });
    });

    it('takes a reply that is no JSON object as the answer, its first line as the headline', () => {
      expect(answerOf('## Kane scored 6.\n\nMore.')).toEqual({
        headline: 'Kane scored 6.',
        answer: '## Kane scored 6.\n\nMore.',
      });
    });
  });

  describe('validateAttempt', () => {
    it('passes an attempt whose query ran and covers the planned measures', () => {
      const { ok, findings } = validateAttempt({
        plan: PLAN,
        calls: [{ tool: 'run_readonly_sql', rowCount: 1, failed: false }],
        queries: [query()],
      });
      expect(ok).toBe(true);
      expect(findings.map((f) => [f.check, f.passed])).toEqual([
        ['Ran a query', true],
        ['No unresolved tool error', true],
        ['No result cut at its row limit', true],
        ['Measures covered (warning only)', true],
      ]);
    });

    it('fails an attempt with no successful query, or an unresolved tool error', () => {
      const failed = validateAttempt({
        plan: PLAN,
        calls: [{ tool: 'run_readonly_sql', failed: true }],
        queries: [query({ error: 'syntax error', rows: [], rowCount: 0 })],
      });
      expect(failed.ok).toBe(false);
      expect(failed.findings[0]).toEqual({
        check: 'Ran a query',
        passed: false,
        detail: 'None of the 1 SQL query succeeded.',
      });
      expect(failed.findings[1].passed).toBe(false);
      const resolved = validateAttempt({
        plan: PLAN,
        calls: [
          { tool: 'run_readonly_sql', failed: true },
          { tool: 'run_readonly_sql', rowCount: 1, failed: false },
        ],
        queries: [query({ error: 'syntax error' }), query()],
      });
      expect(resolved.ok).toBe(true);
    });

    it('fails a result cut at its row limit unless a later query re-aggregates', () => {
      expect(
        validateAttempt({
          plan: PLAN,
          calls: [],
          queries: [query({ truncated: true })],
        }).ok,
      ).toBe(false);
      expect(
        validateAttempt({
          plan: PLAN,
          calls: [],
          queries: [query({ truncated: true }), query()],
        }).ok,
      ).toBe(true);
    });

    it('reports a planned measure no query mentions as a warning that never fails', () => {
      const { ok, findings } = validateAttempt({
        plan: { ...PLAN, measures: ['possession share'] },
        calls: [],
        queries: [query()],
      });
      expect(ok).toBe(true);
      expect(findings[3]).toEqual({
        check: 'Measures covered (warning only)',
        passed: false,
        detail: 'Not found in any query: possession share.',
      });
    });
  });

  describe('analysisLoopDone', () => {
    it('ends on a stop, a valid attempt or the second attempt', () => {
      expect(analysisLoopDone({ ok: false, attempt: 1 })).toBe(false);
      expect(analysisLoopDone({ ok: true, attempt: 1 })).toBe(true);
      expect(analysisLoopDone({ ok: false, attempt: 2 })).toBe(true);
      expect(analysisLoopDone({ attempt: 1, stopped: true })).toBe(true);
    });
  });

  describe("the model steps' requests", () => {
    it('hands Write answer the question, the plan, each query with its rows, and the findings', () => {
      const request = writeAnswerRequest({
        question: 'Who scored most?',
        plan: PLAN,
        queries: [query(), query({ error: 'boom', rationale: undefined })],
        findings: [{ check: 'Ran a query', passed: true, detail: '1 of 2.' }],
      });
      expect(request).toContain('Question: Who scored most?');
      expect(request).toContain(JSON.stringify(PLAN));
      expect(request).toContain(
        '1. I count the goals of each player. (1 rows)',
      );
      expect(request).toContain('[{"player":"Kane","goals":6}]');
      expect(request).toContain('2. (no rationale given) (failed: boom)');
      expect(request).toContain('- passed: Ran a query. 1 of 2.');
    });

    it('hands a retry of Analyse the failed checks of the previous attempt', () => {
      expect(analysePlanBlock(PLAN)).toBe(
        `Analysis plan for this turn:\n${JSON.stringify(PLAN)}`,
      );
      const retry = analysePlanBlock(PLAN, {
        attempt: 1,
        findings: [
          { check: 'Ran a query', passed: false, detail: 'No SQL query ran.' },
          { check: 'No unresolved tool error', passed: true, detail: 'ok' },
        ],
      });
      expect(retry).toContain('Attempt 1 of this analysis failed validation.');
      expect(retry).toContain('- Ran a query: No SQL query ran.');
      expect(retry).not.toContain('No unresolved tool error');
    });
  });
});
