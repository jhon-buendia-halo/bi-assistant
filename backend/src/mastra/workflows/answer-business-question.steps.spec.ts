const getDatasets = jest.fn();
jest.mock('../tool-services', () => ({
  getDatasetToolServices: () => ({ getDatasets }),
}));

import { checkWorkflowContract } from './workflow-contract';
import {
  DATA_QUALITY_CHECK,
  ANSWER_BUSINESS_QUESTION_EDGES,
  ANSWER_BUSINESS_QUESTION_STEPS,
  analysisLoopDone,
  answerDeltas,
  answerOf,
  answerWithRowTables,
  assessable,
  expandRowTables,
  ROW_TABLE_CAP,
  dataQualityFailure,
  dataQualityFindings,
  queriedTables,
  catalogBlock,
  clarifyingQuestionOf,
  loadCatalog,
  PLAN_COLUMNS_PER_ENTITY,
  PLAN_COLUMNS_TOTAL,
  planAfterAnswer,
  planCatalogBlock,
  planLoopDone,
  planOf,
  receiveQuestion,
  turnSummaryOf,
  validateAttempt,
  wrapUp,
  type AnalyseQuery,
  type AnalysisPlan,
} from './answer-business-question.steps';
import {
  ANSWER_ROWS_CAP,
  PLAN_FIRST_LINE,
  PLAN_INSTRUCTIONS,
  WRITE_ANSWER_FIRST_LINE,
  WRITE_ANSWER_INSTRUCTIONS,
  analysePlanBlock,
  planMessages,
  writeAnswerRequest,
} from './answer-business-question.prompts';

const PLAN: AnalysisPlan = {
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

describe('answer-business-question steps (agents.md 5.11)', () => {
  it('lists the nine steps with their ids, titles and kinds, Clarify after Plan and Check data quality after Validate', () => {
    expect(
      ANSWER_BUSINESS_QUESTION_STEPS.map(({ id, title, kind }) => ({
        id,
        title,
        kind,
      })),
    ).toEqual([
      { id: 'receive-question', title: 'Receive question', kind: 'code' },
      { id: 'load-catalog', title: 'Load catalog', kind: 'code' },
      { id: 'plan', title: 'Plan', kind: 'agent' },
      { id: 'clarify', title: 'Clarify', kind: 'code' },
      { id: 'analyse', title: 'Analyse', kind: 'agent' },
      { id: 'validate', title: 'Validate', kind: 'code' },
      { id: 'check-data-quality', title: 'Check data quality', kind: 'agent' },
      { id: 'write-answer', title: 'Write answer', kind: 'agent' },
      { id: 'wrap-up', title: 'Wrap up', kind: 'code' },
    ]);
    expect(
      ANSWER_BUSINESS_QUESTION_STEPS.filter((step) => step.modelOnly).map(
        (s) => s.id,
      ),
    ).toEqual(['plan', 'check-data-quality', 'write-answer']);
  });

  it('connects them with the edges of api.md 117: Clarify loops back to Plan once answered', () => {
    expect(
      ANSWER_BUSINESS_QUESTION_EDGES.map(
        (e) => `${e.from}->${e.to} ${e.kind}${e.label ? ` "${e.label}"` : ''}`,
      ),
    ).toEqual([
      'start->receive-question next',
      'receive-question->load-catalog next',
      'load-catalog->plan next',
      'plan->clarify branch "Needs clarification"',
      'clarify->plan loop "Answered"',
      'plan->analyse branch "Clear"',
      'analyse->validate next',
      'validate->analyse loop "Retry once"',
      'validate->write-answer next "Valid or retried"',
      'validate->check-data-quality branch "Check data quality"',
      'check-data-quality->write-answer next',
      'write-answer->wrap-up next',
      'wrap-up->end next',
    ]);
  });

  describe('the optional data-quality check (agents.md 5.11)', () => {
    const CATALOG = [
      {
        entity: 'wc.public.matches',
        dataset: 'World Cup',
        datasourceId: 'ds-pg',
        datasourceKind: 'postgres',
        columnCount: 5,
      },
      {
        entity: 'wc.public.teams',
        dataset: 'World Cup',
        datasourceId: 'ds-pg',
        datasourceKind: 'postgres',
        columnCount: 3,
      },
      {
        entity: 'api.orders.items',
        dataset: 'Orders API',
        datasourceId: 'ds-rest',
        datasourceKind: 'rest',
        columnCount: 4,
      },
    ];
    const query = (sql: string) => ({
      sql,
      rows: [],
      rowCount: 0,
      truncated: false,
    });

    it('finds the catalog tables the SQL names, ignoring case, in catalog order, once each', () => {
      const tables = queriedTables(
        [
          query(
            'SELECT * FROM WC.Public.Teams t JOIN wc.public.matches m ON 1=1',
          ),
          query('SELECT count(*) FROM wc.public.matches'),
          query('SELECT * FROM api.orders.items'),
          query('SELECT * FROM other.schema.unknown'),
        ],
        CATALOG,
      );
      expect(tables.map((t) => t.entity)).toEqual([
        'wc.public.matches',
        'wc.public.teams',
        'api.orders.items',
      ]);
      // Only PostgreSQL and Databricks tables can be assessed.
      expect(tables.filter(assessable).map((t) => t.entity)).toEqual([
        'wc.public.matches',
        'wc.public.teams',
      ]);
    });

    it('turns each finding Sarah picked into a failed finding with the engine’s words and her impact', () => {
      const findings = dataQualityFindings({
        tables: ['wc.public.matches'],
        findings: [
          {
            severity: 'high',
            dimension: 'completeness',
            entity: 'public.matches',
            field: 'winner',
            description: '62% of winner is null.',
          },
          {
            severity: 'low',
            dimension: 'consistency',
            entity: 'public.matches',
            field: 'stage',
            description: 'stage differs by case.',
          },
        ],
        // A repeated and an unknown number are dropped.
        issues: [
          { finding: 1, impact: 'The count of wins may be low.' },
          { finding: 1, impact: 'Again.' },
          { finding: 9, impact: 'Unknown.' },
        ],
      });
      expect(findings).toEqual([
        {
          check: `${DATA_QUALITY_CHECK}: public.matches.winner (completeness, high)`,
          passed: false,
          detail: '62% of winner is null. The count of wins may be low.',
        },
      ]);
    });

    it('says what was checked when no finding affects the answer, or none exists', () => {
      expect(
        dataQualityFindings({
          tables: ['wc.public.matches'],
          findings: [
            {
              severity: 'low',
              dimension: 'consistency',
              entity: 'public.matches',
              description: 'x',
            },
          ],
          issues: [],
        }),
      ).toEqual([
        {
          check: DATA_QUALITY_CHECK,
          passed: true,
          detail:
            '1 data-quality findings on wc.public.matches; none affects this answer.',
        },
      ]);
      expect(
        dataQualityFindings({
          tables: ['wc.public.matches'],
          findings: [],
          issues: [],
        })[0].detail,
      ).toBe('No data-quality findings on wc.public.matches.');
      expect(dataQualityFailure('connect ECONNREFUSED')).toEqual({
        check: DATA_QUALITY_CHECK,
        passed: false,
        detail:
          'The data quality of the tables used could not be checked: connect ECONNREFUSED',
      });
    });
  });

  it('never lets an answered plan ask again (planAfterAnswer)', () => {
    const asking = planOf(
      {
        needsClarification: true,
        clarification: { question: 'Which?', options: ['a', 'b'] },
      },
      'Q',
    );
    expect(asking.needsClarification).toBe(true);
    expect(planAfterAnswer(asking, undefined)).toBe(asking);
    expect(
      planAfterAnswer(asking, {
        question: 'Which?',
        options: ['a', 'b'],
        answer: 'a',
      }),
    ).toMatchObject({ needsClarification: false, clarification: null });
  });

  it('ends the plan loop on a plan, and goes round again on Clarify’s answer (planLoopDone)', () => {
    expect(planLoopDone({ question: 'Q', catalog: [], plan: {} })).toBe(true);
    expect(
      planLoopDone({ question: 'Q', catalog: [], plan: {}, stopped: true }),
    ).toBe(true);
    expect(
      planLoopDone({
        question: 'Q',
        catalog: [],
        columns: [],
        clarification: { question: 'Which?', options: [], answer: 'a' },
      }),
    ).toBe(false);
  });

  it('reads a waiting step’s question from its suspend payload, the engine’s own fields dropped', () => {
    expect(
      clarifyingQuestionOf({
        question: ' Which? ',
        options: ['a', 2, 'b'],
        __workflow_meta: { runId: 'r', path: ['clarify'] },
      }),
    ).toEqual({ question: 'Which?', options: ['a', 'b'] });
    expect(clarifyingQuestionOf({ options: ['a'] })).toBeUndefined();
    expect(clarifyingQuestionOf(undefined)).toBeUndefined();
  });

  it('keeps its data contract along the edges', () => {
    expect(
      checkWorkflowContract({
        input: [
          { name: 'question', label: 'Q', type: 'textarea', required: true },
          { name: 'datasets', label: 'D', type: 'datasets', required: true },
        ],
        steps: ANSWER_BUSINESS_QUESTION_STEPS,
        edges: ANSWER_BUSINESS_QUESTION_EDGES,
      }),
    ).toEqual([]);
  });

  it('opens the Plan and Write answer instructions with their fixed first lines', () => {
    expect(PLAN_FIRST_LINE).toBe(
      'You plan a data analysis for Questions to Insights.',
    );
    expect(WRITE_ANSWER_FIRST_LINE).toBe(
      'You write the final answer for Questions to Insights.',
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
      const receive = ANSWER_BUSINESS_QUESTION_STEPS.find(
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

  describe('planMessages', () => {
    it('is the request alone for a bare question, and replaces the last message of a conversation', () => {
      expect(
        planMessages({ messages: 'Q', question: 'Q', catalogBlock: 'CAT' }),
      ).toEqual({ messages: 'Question: Q\n\nCAT', fallback: 'Q' });
      expect(
        planMessages({
          messages: [
            { role: 'user', content: 'Earlier' },
            { role: 'assistant', content: 'Reply' },
            { role: 'user', content: 'Q' },
          ],
          question: 'Q',
          catalogBlock: 'CAT',
        }).messages,
      ).toEqual([
        { role: 'user', content: 'Earlier' },
        { role: 'assistant', content: 'Reply' },
        { role: 'user', content: 'Question: Q\n\nCAT' },
      ]);
    });

    it('after Clarify: the question, the clarifying question Plan asked, then the answer with the catalog', () => {
      expect(
        planMessages({
          messages: 'Which team was the most dominant?',
          question: 'Which team was the most dominant?',
          catalogBlock: 'CAT',
          answered: {
            question: 'Dominant by what measure?',
            options: ['Matches won', 'Goals scored'],
            answer: 'Matches won',
          },
        }),
      ).toEqual({
        messages: [
          { role: 'user', content: 'Which team was the most dominant?' },
          {
            role: 'assistant',
            content: 'Dominant by what measure?\n- Matches won\n- Goals scored',
          },
          { role: 'user', content: 'Question: Matches won\n\nCAT' },
        ],
        fallback: 'Which team was the most dominant? (Matches won)',
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

  describe('expandRowTables (plan 1.25.6)', () => {
    const drivers = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        name: `Driver ${i + 1}`,
        total_race_starts: 400 - i,
      }));
    const listed = (rows: Record<string, unknown>[], rowCount = rows.length) =>
      query({
        sql: 'SELECT name, total_race_starts FROM drivers ORDER BY 2 DESC',
        rows,
        rowCount,
      });

    it('turns [[rows:1]] into a table of every row the query holds, in order, every column named readably', () => {
      const out = expandRowTables('Top drivers:\n\n[[rows:1]]\n\nMore.', [
        listed(drivers(102)),
      ]);
      const lines = out.split('\n');
      expect(lines[0]).toBe('Top drivers:');
      expect(out).toContain(
        '| Name | Total race starts |\n| --- | --- |\n| Driver 1 | 400 |\n| Driver 2 | 399 |',
      );
      expect(lines.filter((line) => line.startsWith('| Driver'))).toHaveLength(
        102,
      );
      expect(out).toContain('| Driver 102 | 299 |');
      expect(out).not.toContain('[[');
      expect(out).not.toContain('Showing the first');
      expect(out.endsWith('More.')).toBe(true);
    });

    it('shows only the named columns, in that order, under their headers', () => {
      const out = expandRowTables(
        '[[rows:1 | total_race_starts=Race starts, name=Driver]]',
        [listed(drivers(12))],
      );
      expect(out).toContain(
        '| Race starts | Driver |\n| --- | --- |\n| 400 | Driver 1 |',
      );
    });

    it('ignores a column the result does not have; with none left it shows every column', () => {
      expect(
        expandRowTables('[[rows:1 | name=Driver, wins=Wins]]', [
          listed(drivers(12)),
        ]),
      ).toContain('| Driver |\n| --- |\n| Driver 1 |');
      expect(
        expandRowTables('[[rows:1 | wins=Wins]]', [listed(drivers(12))]),
      ).toContain('| Name | Total race starts |');
    });

    it(`adds a note when the result has more rows than the ${ROW_TABLE_CAP} it holds`, () => {
      const out = expandRowTables('[[rows:1]]', [
        listed(drivers(ROW_TABLE_CAP), 1870),
      ]);
      expect(
        out.split('\n').filter((line) => line.startsWith('| Driver')),
      ).toHaveLength(200);
      expect(out).toContain(
        '\n\nShowing the first 200 of 1,870 rows. Open the query to download all of them.',
      );
    });

    it('removes a marker naming an unknown query, a failed query or an empty result', () => {
      const queries = [
        listed(drivers(12)),
        query({ error: 'boom', rows: [], rowCount: 0 }),
        listed([]),
      ];
      for (const marker of [
        '[[rows:4]]',
        '[[rows:2]]',
        '[[rows:3]]',
        '[[rows:0]]',
      ]) {
        expect(expandRowTables(`Before.\n${marker}\nAfter.`, queries)).toBe(
          'Before.\nAfter.',
        );
      }
    });

    it('keeps each cell as stored: escapes a pipe and a line break, leaves null empty', () => {
      const out = expandRowTables('[[rows:1]]', [
        listed([
          { name: 'A|B', total_race_starts: 12.3456 },
          { name: 'line\nbreak', total_race_starts: null },
        ]),
      ]);
      expect(out).toContain('| A\\|B | 12.3456 |');
      expect(out).toContain('| line<br>break |  |');
    });

    it('removes a marker written inside a line; leaves other text with brackets alone', () => {
      expect(
        expandRowTables('See [[rows:1]] below. [[note]] stays.', [
          listed(drivers(12)),
        ]),
      ).toBe('See  below. [[note]] stays.');
    });

    it('separates the table from the text around it with blank lines', () => {
      expect(
        expandRowTables('Here:\n[[rows:1 | name=Driver]]\nAfter.', [
          listed(drivers(1)),
        ]),
      ).toBe('Here:\n\n| Driver |\n| --- |\n| Driver 1 |\n\nAfter.');
    });

    it('never expands the headline: a marker in it is removed', () => {
      expect(
        answerWithRowTables(
          {
            headline: 'Top 12 drivers [[rows:1]]',
            answer: 'Top 12.\n[[rows:1]]',
          },
          [listed(drivers(12))],
        ).headline,
      ).toBe('Top 12 drivers');
    });
  });

  describe('answerDeltas: the streamed answer (plan 1.25.6)', () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ n: i + 1 }));
    const queries = [query({ rows, rowCount: 12 })];

    /** Stream `text` one character at a time, then finish with it. */
    function streamed(text: string): { deltas: string[]; final: string } {
      const deltas: string[] = [];
      const stream = answerDeltas(queries, (delta) => deltas.push(delta));
      for (let i = 1; i <= text.length; i += 1) stream.update(text.slice(0, i));
      const final = expandRowTables(text, queries);
      stream.finish(final);
      return { deltas, final };
    }

    it('never sends a marker, whole or in part, and sends the expanded answer exactly once', () => {
      const text =
        'Twelve rows.\n\n[[rows:1 | n=Number]]\n\nA [link](x) and [[other]] text.\n[[rows:1]]';
      const { deltas, final } = streamed(text);
      expect(deltas.join('')).toBe(final);
      expect(final).not.toContain('[[rows');
      // Append-only: no text sent so far ever ends in the start of a marker.
      const opening = ['[', '[[', '[[r', '[[ro', '[[row', '[[rows', '[[rows:'];
      let shown = '';
      for (const delta of deltas) {
        shown += delta;
        expect(opening.some((start) => shown.endsWith(start))).toBe(false);
      }
      expect(final).toContain('| Number |');
      expect(final).toContain('[[other]] text.');
    });

    it('holds back an unfinished [[ until it proves not to be a marker', () => {
      const deltas: string[] = [];
      const stream = answerDeltas(queries, (delta) => deltas.push(delta));
      stream.update('Ranked [[');
      expect(deltas.join('')).toBe('Ranked ');
      stream.update('Ranked [[x');
      expect(deltas.join('')).toBe('Ranked [[x');
    });

    it('sends a table as soon as its marker line is complete', () => {
      const deltas: string[] = [];
      const stream = answerDeltas(queries, (delta) => deltas.push(delta));
      stream.update('Rows:\n[[rows:1]]');
      expect(deltas.join('')).toBe('Rows:\n');
      stream.update('Rows:\n[[rows:1]]\n');
      expect(deltas.join('')).toContain('| N |\n| --- |\n| 1 |');
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
        ['No answer from a sample', true],
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
      expect(findings[4]).toEqual({
        check: 'Measures covered (warning only)',
        passed: false,
        detail: 'Not found in any query: possession share.',
      });
    });

    describe('No answer from a sample (plan 1.25.7)', () => {
      const rows50 = Array.from({ length: 50 }, (_, n) => ({ id: n }));
      const sample = (partial: Partial<AnalyseQuery> = {}) =>
        query({
          sql: 'SELECT id FROM world_cup.goals LIMIT 50',
          rows: rows50,
          rowCount: 50,
          ...partial,
        });
      const check = (queries: AnalyseQuery[]) => {
        const result = validateAttempt({ plan: PLAN, calls: [], queries });
        return {
          ok: result.ok,
          finding: result.findings.find(
            (f) => f.check === 'No answer from a sample',
          ),
        };
      };

      it('fails a LIMIT with no sort that was reached, alone, after the row-limit check', () => {
        const { ok, finding } = check([sample()]);
        expect(ok).toBe(false);
        expect(finding).toEqual({
          check: 'No answer from a sample',
          passed: false,
          detail:
            '1 result kept an arbitrary sample of rows (a LIMIT with no sort) and no later query read the whole data.',
        });
        expect(
          validateAttempt({ plan: PLAN, calls: [], queries: [sample()] })
            .findings[3].check,
        ).toBe('No answer from a sample');
        expect(check([sample(), sample()]).finding?.detail).toMatch(
          /^2 results kept an arbitrary sample/,
        );
      });

      it('passes when a later successful query is not a sample', () => {
        const { ok, finding } = check([sample(), query()]);
        expect(ok).toBe(true);
        expect(finding).toEqual({
          check: 'No answer from a sample',
          passed: true,
          detail: 'No result the answer reads is an arbitrary sample.',
        });
        // A later query that failed does not count.
        expect(check([sample(), query({ error: 'boom' })]).ok).toBe(false);
      });

      it('passes a ranking (ORDER BY … LIMIT 50) and a LIMIT that was not reached', () => {
        expect(
          check([
            sample({
              sql: 'SELECT id FROM world_cup.goals ORDER BY id DESC LIMIT 50',
            }),
          ]).ok,
        ).toBe(true);
        expect(
          check([sample({ rows: rows50.slice(0, 7), rowCount: 7 })]).ok,
        ).toBe(true);
      });

      it('does not count a failed sample query', () => {
        expect(
          check([sample({ error: 'boom', rows: [], rowCount: 0 }), query()])
            .finding?.passed,
        ).toBe(true);
      });

      it('reaches the retry of Analyse and Write answer as the other findings do', () => {
        const { findings } = validateAttempt({
          plan: PLAN,
          calls: [],
          queries: [sample()],
        });
        expect(analysePlanBlock(PLAN, { attempt: 1, findings })).toContain(
          '- No answer from a sample: 1 result kept an arbitrary sample of rows',
        );
        expect(
          writeAnswerRequest({
            question: 'Show me 5 goals',
            plan: PLAN,
            queries: [sample()],
            findings,
          }),
        ).toContain(
          '- failed: No answer from a sample. 1 result kept an arbitrary sample of rows',
        );
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

    it('says how many rows a long result has and how many Write answer is shown (plan 1.25.6)', () => {
      const rows = Array.from({ length: 102 }, (_, n) => ({ n }));
      const request = writeAnswerRequest({
        question: 'Which 100 drivers have the most race starts?',
        plan: PLAN,
        queries: [query({ rows, rowCount: 102 })],
        findings: [],
      });
      expect(request).toContain(
        '1. I count the goals of each player. (102 rows, the first 50 shown)',
      );
      expect(request).toContain(JSON.stringify(rows.slice(0, ANSWER_ROWS_CAP)));
      expect(request).not.toContain('{"n":50}');
    });

    it('tells Write answer to mark a result it was shown only part of, as its last rule (plan 1.25.6)', () => {
      expect(WRITE_ANSWER_INSTRUCTIONS).toContain('[[rows:<n>]]');
      expect(WRITE_ANSWER_INSTRUCTIONS).toContain(
        '[[rows:2 | name=Driver, total_race_starts=Race starts]]',
      );
      expect(WRITE_ANSWER_INSTRUCTIONS).toContain(
        "when a query's line says that only its first rows are shown",
      );
      // Last, so the rules before it read in the order they always had.
      expect(
        WRITE_ANSWER_INSTRUCTIONS.trimEnd()
          .split('\n')
          .pop()
          ?.startsWith('- Long lists:'),
      ).toBe(true);
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
