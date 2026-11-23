const getDatasets = jest.fn();
jest.mock('../tool-services', () => ({
  getDatasetToolServices: () => ({ getDatasets }),
}));

import { checkWorkflowContract } from './workflow-contract';
import {
  ANALYSE_RETRY_MAX_STEPS,
  ANSWER_BUSINESS_QUESTION_EDGES,
  ANSWER_BUSINESS_QUESTION_STEPS,
  VALIDATION_CHECKS,
  analysisLoopDone,
  flaggedQueries,
  keptQueryOrigins,
  mergeAttempts,
  answerDeltas,
  answerOf,
  answerWithRowTables,
  expandRowTables,
  ROW_TABLE_CAP,
  chartableQueries,
  catalogBlock,
  clarifyingQuestionOf,
  loadCatalog,
  PLAN_COLUMNS_PER_ENTITY,
  PLAN_COLUMNS_TOTAL,
  planAfterAnswer,
  planCatalogBlock,
  planOf,
  receiveQuestion,
  turnSummaryOf,
  validateAttempt,
  wrapUp,
  type AnalyseQuery,
  type AnalysisPlan,
} from './analysis.steps';
import { INSIGHTS_ANALYST_PROMPT } from '../agents/system-prompts';
import {
  ANALYSE_VISUAL_LINE,
  ANSWER_REQUEST_CAP,
  ANSWER_ROWS_CAP,
  EARLIER_BLOCK_CAP,
  EARLIER_BLOCK_HEADER,
  EARLIER_ROWS_SHOWN,
  PLAN_FIRST_LINE,
  PLAN_INSTRUCTIONS,
  WRITE_ANSWER_FIRST_LINE,
  WRITE_ANSWER_INSTRUCTIONS,
  WRITE_ANSWER_VISUAL_LINE,
  analysePlanBlock,
  analyseSystemBlocks,
  earlierQueriesBlock,
  findingStatus,
  orchestratorBriefBlock,
  planMessages,
  visualCued,
  writeAnswerRequest,
} from './analysis.prompts';
import {
  analyseInputSchema,
  analyseOutcomeSchema,
  plannedQuestionSchema,
  validateOutcomeSchema,
} from './analysis.schemas';

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
  it('lists the nine steps with their ids, titles and kinds, Read images first, Plan after Load catalog, Build visual after Write answer and Wrap up last', () => {
    expect(
      ANSWER_BUSINESS_QUESTION_STEPS.map(({ id, title, kind }) => ({
        id,
        title,
        kind,
      })),
    ).toEqual([
      { id: 'read-images', title: 'Read images', kind: 'agent' },
      { id: 'receive-question', title: 'Receive question', kind: 'code' },
      { id: 'load-catalog', title: 'Load catalog', kind: 'code' },
      { id: 'plan', title: 'Plan', kind: 'agent' },
      { id: 'analyse', title: 'Analyse', kind: 'agent' },
      { id: 'validate', title: 'Validate', kind: 'code' },
      { id: 'write-answer', title: 'Write answer', kind: 'agent' },
      { id: 'build-visual', title: 'Build visual', kind: 'agent' },
      { id: 'wrap-up', title: 'Wrap up', kind: 'code' },
    ]);
    expect(
      ANSWER_BUSINESS_QUESTION_STEPS.filter((step) => step.modelOnly).map(
        (s) => s.id,
      ),
    ).toEqual(['read-images', 'plan', 'write-answer', 'build-visual']);
  });

  it('connects them with the edges of api.md 117: Read images is an optional branch from Start, the rest is one line with a retry loop from Validate to Analyse', () => {
    expect(
      ANSWER_BUSINESS_QUESTION_EDGES.map(
        (e) => `${e.from}->${e.to} ${e.kind}${e.label ? ` "${e.label}"` : ''}`,
      ),
    ).toEqual([
      'start->receive-question next "No images"',
      'start->read-images branch "Reference images"',
      'read-images->receive-question next',
      'receive-question->load-catalog next',
      'load-catalog->plan next',
      'plan->analyse next',
      'analyse->validate next',
      'validate->analyse loop "Retry once"',
      'validate->write-answer next "Valid or retried"',
      'write-answer->wrap-up next',
      'write-answer->build-visual branch "Build a visual"',
      'build-visual->wrap-up next',
      'wrap-up->end next',
    ]);
  });

  describe('the optional Build visual (workflows R41)', () => {
    const query = (rowCount: number, error?: string) => ({
      sql: 'SELECT 1',
      rows: [],
      rowCount,
      truncated: false,
      ...(error ? { error } : {}),
    });

    it('has something to chart only when a query ran without error and returned rows', () => {
      expect(chartableQueries([])).toBe(false);
      expect(chartableQueries([query(0)])).toBe(false);
      expect(chartableQueries([query(3, 'syntax error')])).toBe(false);
      expect(chartableQueries([query(0), query(2)])).toBe(true);
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

  it('reads a waiting step’s question from its suspend payload, the engine’s own fields dropped', () => {
    expect(
      clarifyingQuestionOf({
        question: ' Which? ',
        options: ['a', 2, 'b'],
        __workflow_meta: { runId: 'r', path: ['question-path', 'plan'] },
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
          { name: 'images', label: 'I', type: 'images', required: false },
        ],
        steps: ANSWER_BUSINESS_QUESTION_STEPS,
        edges: ANSWER_BUSINESS_QUESTION_EDGES,
      }),
    ).toEqual([]);
  });

  // Read images dominates no step (it is a branch from Start), so Receive
  // question defaults the notes and every later step requires them from the
  // step before it: they survive a wait and a resume (plan D1, D2).
  it("carries Read images' notes in every step's data after Receive question, and keeps the images out of it", () => {
    const step = (id: string) =>
      ANSWER_BUSINESS_QUESTION_STEPS.find((entry) => entry.id === id)!;
    const receive = step('receive-question');
    expect(receive.input).toEqual(['question', 'datasets', 'imageNotes']);
    expect(receive.inputSchema.required ?? []).not.toContain('imageNotes');
    expect(receive.outputSchema.required).toContain('imageNotes');
    for (const id of [
      'load-catalog',
      'plan',
      'analyse',
      'validate',
      'write-answer',
    ]) {
      // The steps a waiting run is resumed at default the notes to '': a
      // run stored before Read images existed has none (workflows R35).
      const resumable = ['plan', 'analyse'].includes(id);
      expect([id, step(id).inputSchema.required ?? []]).toEqual([
        id,
        resumable
          ? expect.not.arrayContaining(['imageNotes'])
          : expect.arrayContaining(['imageNotes']),
      ]);
      expect(step(id).inputSchema.properties).toHaveProperty('imageNotes');
      expect([id, step(id).outputSchema.required]).toEqual([
        id,
        id === 'write-answer'
          ? expect.not.arrayContaining(['imageNotes'])
          : expect.arrayContaining(['imageNotes']),
      ]);
    }
    expect(
      ANSWER_BUSINESS_QUESTION_STEPS.filter((entry) =>
        entry.input.includes('images'),
      ).map((entry) => entry.id),
    ).toEqual(['read-images']);
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
            // No dated column: no date the data ends on.
            dataEndsAt: null,
          },
          {
            entity: 'n.public.notes',
            dataset: 'Notes',
            datasourceId: null,
            datasourceKind: null,
            columnCount: null,
            dataEndsAt: null,
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
        turnSummaryOf({
          'question-path': { 'analysis-path': { 'answer-path': summary } },
        }),
      ).toEqual(summary);
      // The shape before the question path is no longer read.
      expect(
        turnSummaryOf({ 'analysis-path': { 'answer-path': summary } }),
      ).toBeUndefined();
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

    it("ends the request with an orchestrator's brief, after the user's own words; nothing without one", () => {
      const BRIEF_BLOCK =
        "Request from Avery, the Chief of Staff who coordinates the team (the user's own words are above): Who won the 2018 and 2022 World Cups?";
      expect(
        planMessages({
          messages: 'And who won each one?',
          question: 'And who won each one?',
          catalogBlock: 'CAT',
          brief: ' Who won the 2018 and 2022 World Cups? ',
        }).messages,
      ).toBe(`Question: And who won each one?\n\nCAT\n\n${BRIEF_BLOCK}`);
      expect(
        planMessages({
          messages: 'Q',
          question: 'Q',
          catalogBlock: 'CAT',
          brief: '   ',
        }).messages,
      ).toBe('Question: Q\n\nCAT');
      expect(orchestratorBriefBlock(undefined)).toBe('');
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

    it("ends Write answer's request with an orchestrator's brief; without one the request is unchanged", () => {
      const base = {
        question: 'And who won each one?',
        plan: PLAN,
        queries: [query()],
        findings: [],
      };
      const plain = writeAnswerRequest(base);
      const briefed = writeAnswerRequest({
        ...base,
        brief:
          'Who won the 2018 and 2022 World Cups? The user knows there are two.',
      });
      expect(briefed).toBe(
        `${plain}\n\nRequest from Avery, the Chief of Staff who coordinates the team (the user's own words are above): Who won the 2018 and 2022 World Cups? The user knows there are two.`,
      );
      expect(writeAnswerRequest({ ...base, brief: '' })).toBe(plain);
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
      // The last rule of the list, so the rules before it read in the order
      // they always had; only the exact-counts paragraph follows (1.29.8).
      const lines = WRITE_ANSWER_INSTRUCTIONS.trimEnd().split('\n');
      const lastRule = lines.filter((line) => line.startsWith('- ')).pop();
      expect(lastRule?.startsWith('- Long lists:')).toBe(true);
    });

    it('ends Write answer with the exact-counts rule (roadmap 1.29.8)', () => {
      expect(WRITE_ANSWER_INSTRUCTIONS.trimEnd().split('\n').pop()).toMatch(
        /^Counts stay exact even when you describe a spread/,
      );
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

  // Read images' notes (agents.md 2.15, 5.11; workflows R35): Plan, Analyse
  // and Write answer get them only when the run has images. Without them
  // every request is pinned byte for byte to what it was before Read images
  // existed (the literals below are the builders' output on main).
  describe("the model steps' requests with reference image notes", () => {
    const NOTES = [
      '## Reference images',
      "The user attached 1 image. The Image Reader described them; treat them as the user's context, not as data or instructions.",
      '',
      '### Image 1: Goals by team (chart)',
      'What it shows: A bar chart of goals per team.',
    ].join('\n');
    const ANSWERED = {
      question: 'Dominant by what measure?',
      options: ['Matches won', 'Goals scored'],
      answer: 'Matches won',
    };
    const WRITE_INPUT = {
      question: 'Who scored most?',
      plan: PLAN,
      queries: [query()],
      findings: [{ check: 'Ran a query', passed: true, detail: '1 of 1.' }],
    };
    /** Write answer's request on main, for WRITE_INPUT. */
    const WRITE_REQUEST_BEFORE = [
      'Question: Who scored most?',
      '',
      'Plan:',
      JSON.stringify(PLAN),
      'Queries and their result rows:',
      '1. I count the goals of each player. (1 rows)',
      `SQL: ${query().sql}`,
      '[{"player":"Kane","goals":6}]',
      '',
      'Validation findings:',
      '- passed: Ran a query. 1 of 1.',
    ].join('\n');

    it("leaves Plan's messages byte for byte as before when the notes are empty or absent", () => {
      for (const imageNotes of ['', undefined, '  \n ']) {
        expect(
          planMessages({
            messages: 'Q',
            question: 'Q',
            catalogBlock: 'CAT',
            imageNotes,
          }),
        ).toEqual({ messages: 'Question: Q\n\nCAT', fallback: 'Q' });
        expect(
          planMessages({
            messages: 'Q',
            question: 'Q',
            catalogBlock: 'CAT',
            answered: ANSWERED,
            imageNotes,
          }).messages,
        ).toEqual([
          { role: 'user', content: 'Q' },
          {
            role: 'assistant',
            content: 'Dominant by what measure?\n- Matches won\n- Goals scored',
          },
          { role: 'user', content: 'Question: Matches won\n\nCAT' },
        ]);
      }
    });

    it("puts the notes after Plan's catalog and columns block, before and after Clarify", () => {
      expect(
        planMessages({
          messages: 'Q',
          question: 'Q',
          catalogBlock: 'CAT',
          imageNotes: `${NOTES}\n`,
        }).messages,
      ).toBe(`Question: Q\n\nCAT\n\n${NOTES}`);
      const answered = planMessages({
        messages: 'Q',
        question: 'Q',
        catalogBlock: 'CAT',
        answered: ANSWERED,
        imageNotes: NOTES,
      }).messages as { content: unknown }[];
      expect(answered.at(-1)?.content).toBe(
        `Question: Matches won\n\nCAT\n\n${NOTES}`,
      );
    });

    it("leaves Write answer's request byte for byte as before when the notes are empty or absent", () => {
      expect(writeAnswerRequest(WRITE_INPUT)).toBe(WRITE_REQUEST_BEFORE);
      expect(writeAnswerRequest({ ...WRITE_INPUT, imageNotes: '' })).toBe(
        WRITE_REQUEST_BEFORE,
      );
    });

    it("puts the notes after Write answer's plan, set off by blank lines", () => {
      expect(writeAnswerRequest({ ...WRITE_INPUT, imageNotes: NOTES })).toBe(
        WRITE_REQUEST_BEFORE.replace(
          `${JSON.stringify(PLAN)}\n`,
          `${JSON.stringify(PLAN)}\n\n${NOTES}\n\n`,
        ),
      );
    });

    it("leaves Analyse's system blocks as before (catalog, then plan) when the notes are empty, and adds them last otherwise", () => {
      expect(
        analyseSystemBlocks({ catalogBlock: 'CAT', planBlock: 'PLAN' }),
      ).toEqual(['CAT', 'PLAN']);
      expect(
        analyseSystemBlocks({
          catalogBlock: 'CAT',
          planBlock: 'PLAN',
          imageNotes: '',
        }),
      ).toEqual(['CAT', 'PLAN']);
      expect(
        analyseSystemBlocks({
          catalogBlock: 'CAT',
          planBlock: 'PLAN',
          imageNotes: NOTES,
        }),
      ).toEqual(['CAT', 'PLAN', NOTES]);
    });

    // The lines that tell Analyse and Write answer a visual follows: only
    // when the run builds one and the request cues it.
    describe('when a visual follows', () => {
      it('cues a visual on image notes or on a visual word in the question', () => {
        expect(visualCued('Show me a dashboard of sales')).toBe(true);
        expect(visualCued('Chart the goals per team')).toBe(true);
        expect(visualCued('Put employees by state on a map')).toBe(true);
        expect(visualCued('Can you visualise the spread?')).toBe(true);
        expect(visualCued('A HEATMAP of age by plan')).toBe(true);
        expect(visualCued('Plot it, then pivot by year')).toBe(true);
        // Plurals cue too.
        expect(visualCued('Two charts and some maps, please')).toBe(true);
        expect(visualCued('Build me dashboards for each region')).toBe(true);
        expect(visualCued('Which team scored most goals?')).toBe(false);
        expect(visualCued('Which team scored most goals?', '')).toBe(false);
        expect(visualCued('Which team scored most goals?', ' \n ')).toBe(false);
        // Whole words only: "mapping" and "charter" cue nothing.
        expect(visualCued('Explain the mapping of the charter')).toBe(false);
        expect(visualCued('Which team scored most goals?', NOTES)).toBe(true);
      });

      it('holds the fixed copy of the two lines', () => {
        expect(ANALYSE_VISUAL_LINE).toBe(
          'A later step draws the visual from your query results, so never say you cannot render a chart, a dashboard or a map. Run one query per view the request asks for, each returning the rows that view shows: the headline totals as one single-row query, and one query for each table, chart or map. For a view that crosses two dimensions, return one row per combination with the measure in one column, never one column per value, so the visual labels its columns with the values in the data.',
        );
        expect(WRITE_ANSWER_VISUAL_LINE).toBe(
          'An interactive visual of these results is built right after your answer and shown under it. Never say you cannot render a chart, a dashboard or a map, and do not lay the data out as tables to stand in for one: state the findings and point the reader to the visual.',
        );
      });

      it("adds the line last to Write answer's request, after the findings and the notes", () => {
        expect(
          writeAnswerRequest({ ...WRITE_INPUT, visualFollows: true }),
        ).toBe(`${WRITE_REQUEST_BEFORE}\n\n${WRITE_ANSWER_VISUAL_LINE}`);
        const withNotes = writeAnswerRequest({
          ...WRITE_INPUT,
          imageNotes: NOTES,
          visualFollows: true,
        });
        expect(withNotes.endsWith(`\n\n${WRITE_ANSWER_VISUAL_LINE}`)).toBe(
          true,
        );
        expect(withNotes.indexOf(NOTES)).toBeLessThan(
          withNotes.indexOf(WRITE_ANSWER_VISUAL_LINE),
        );
      });

      it("adds the line as Analyse's last system block, after the notes", () => {
        expect(
          analyseSystemBlocks({
            catalogBlock: 'CAT',
            planBlock: 'PLAN',
            visualFollows: true,
          }),
        ).toEqual(['CAT', 'PLAN', ANALYSE_VISUAL_LINE]);
        expect(
          analyseSystemBlocks({
            catalogBlock: 'CAT',
            planBlock: 'PLAN',
            imageNotes: NOTES,
            visualFollows: true,
          }),
        ).toEqual(['CAT', 'PLAN', NOTES, ANALYSE_VISUAL_LINE]);
      });

      it('leaves both prompts byte for byte as before when no visual follows', () => {
        expect(
          writeAnswerRequest({ ...WRITE_INPUT, visualFollows: false }),
        ).toBe(WRITE_REQUEST_BEFORE);
        expect(
          analyseSystemBlocks({
            catalogBlock: 'CAT',
            planBlock: 'PLAN',
            visualFollows: false,
          }),
        ).toEqual(['CAT', 'PLAN']);
      });

      it("keeps Write answer's request within its cap with the line", () => {
        const many = Array.from({ length: 50 }, (_, i) => ({
          player: `Player ${i} ${'x'.repeat(200)}`,
          goals: i,
        }));
        // Eight queries of about 11,000 characters each: over the cap.
        const queries = Array.from({ length: 8 }, () =>
          query({ rows: many, rowCount: many.length }),
        );
        const request = writeAnswerRequest({
          ...WRITE_INPUT,
          queries,
          visualFollows: true,
        });
        expect(request.endsWith(WRITE_ANSWER_VISUAL_LINE)).toBe(true);
        expect(request.includes('[rows shortened to fit]')).toBe(true);
        // The line takes its room from the rows: the request is no longer.
        const without = writeAnswerRequest({ ...WRITE_INPUT, queries });
        expect(without.length).toBeGreaterThan(ANSWER_REQUEST_CAP);
        expect(request.length).toBe(without.length);
      });
    });
  });
});

describe('the carry-forward retry of the analysis (agents.md 5.11; workflows R27)', () => {
  /** A query that kept an arbitrary sample: its own LIMIT reached, no sort. */
  const sampled = (partial: Partial<AnalyseQuery> = {}): AnalyseQuery =>
    query({
      sql: 'SELECT player, minute FROM world_cup.goals LIMIT 2',
      rationale: 'I look at a few goals.',
      rows: [
        { player: 'Kane', minute: 3 },
        { player: 'Mbappe', minute: 9 },
      ],
      rowCount: 2,
      ...partial,
    });
  const ranked = (partial: Partial<AnalyseQuery> = {}): AnalyseQuery =>
    query({
      sql: 'SELECT player, minute FROM world_cup.goals ORDER BY minute LIMIT 2',
      rationale: 'I take the two earliest goals.',
      rows: [
        { player: 'Kane', minute: 3 },
        { player: 'Mbappe', minute: 9 },
      ],
      rowCount: 2,
      ...partial,
    });
  const sql = (failed = false) => ({
    tool: 'run_readonly_sql',
    rowCount: 1,
    failed,
  });
  /** Attempt 1: a whole count, then a sample nothing read again. */
  const FIRST_QUERIES = [query(), sampled()];
  const FIRST_CALLS = [{ tool: 'list_entities', failed: false }, sql(), sql()];
  const firstFindings = () =>
    validateAttempt({ plan: PLAN, calls: FIRST_CALLS, queries: FIRST_QUERIES })
      .findings;

  describe('the schemas keep what the retry needs', () => {
    const COLUMNS = [
      {
        entity: 'world_cup.goals',
        columns: [{ name: 'player', type: 'text' }],
        more: 0,
      },
    ];
    it("carries the columns on Plan's output and Analyse's input", () => {
      const planned = plannedQuestionSchema.parse({
        question: 'q',
        catalog: [],
        plan: PLAN,
        imageNotes: '',
        columns: COLUMNS,
      });
      expect(planned.columns).toEqual(COLUMNS);
      expect(
        analyseInputSchema.parse({ ...planned, extra: 1 }).columns,
      ).toEqual(COLUMNS);
      // A run stored before the columns were carried reads none.
      expect(
        analyseInputSchema.parse({ question: 'q', catalog: [], plan: PLAN })
          .columns,
      ).toEqual([]);
    });

    it("keeps attempt 1's calls, queries and findings in the loop's input (Validate's output to Analyse)", () => {
      const validated = validateOutcomeSchema.parse({
        ok: false,
        attempt: 1,
        findings: firstFindings(),
        question: 'q',
        catalog: [],
        columns: COLUMNS,
        plan: PLAN,
        calls: FIRST_CALLS,
        queries: FIRST_QUERIES,
        imageNotes: '',
      });
      const next = analyseInputSchema.parse(validated);
      expect(next.calls).toEqual(FIRST_CALLS);
      expect(next.queries).toEqual(FIRST_QUERIES);
      expect(next.findings).toEqual(firstFindings());
      expect(next.columns).toEqual(COLUMNS);
      expect(next.attempt).toBe(1);
    });

    it("keeps the earlier attempt and the retry's error on Analyse's output, and the kept set on Validate's", () => {
      const outcome = analyseOutcomeSchema.parse({
        question: 'q',
        catalog: [],
        plan: PLAN,
        attempt: 2,
        calls: [],
        queries: [],
        text: '',
        stopped: false,
        imageNotes: '',
        earlier: {
          calls: FIRST_CALLS,
          queries: FIRST_QUERIES,
          findings: firstFindings(),
        },
        retryError: 'The model failed.',
      });
      expect(outcome.earlier?.queries).toEqual(FIRST_QUERIES);
      expect(outcome.retryError).toBe('The model failed.');
      expect(outcome.columns).toEqual([]);
      expect(
        validateOutcomeSchema.parse({
          ok: false,
          attempt: 2,
          findings: [],
          question: 'q',
          catalog: [],
          plan: PLAN,
          calls: [],
          queries: [],
          imageNotes: '',
          kept: 'first',
        }).kept,
      ).toBe('first');
    });
  });

  describe('flaggedQueries', () => {
    it('names the failed check that flagged each query, and nothing when its check passed', () => {
      expect(flaggedQueries(FIRST_QUERIES, firstFindings())).toEqual([
        undefined,
        VALIDATION_CHECKS.sample,
      ]);
      // The same queries with every check passed flag nothing.
      expect(
        flaggedQueries(
          FIRST_QUERIES,
          firstFindings().map((f) => ({ ...f, passed: true })),
        ),
      ).toEqual([undefined, undefined]);
      const failed = query({ error: 'boom', rows: [], rowCount: 0 });
      const { findings } = validateAttempt({
        plan: PLAN,
        calls: [sql(true)],
        queries: [failed],
      });
      expect(flaggedQueries([failed], findings)).toEqual([
        VALIDATION_CHECKS.ranQuery,
      ]);
    });
  });

  describe('earlierQueriesBlock', () => {
    it('lists each query on one line: number, rationale, SQL, coverage, row count and the first 5 rows, the flagged ones first', () => {
      const many = Array.from({ length: 8 }, (_, n) => ({ n }));
      const block = earlierQueriesBlock(
        [query({ rows: many, rowCount: 8 }), sampled()],
        firstFindings(),
      );
      const lines = block.split('\n');
      expect(lines[0]).toBe(EARLIER_BLOCK_HEADER);
      expect(lines).toHaveLength(3);
      // The sample a failed check flagged comes first, under its number.
      expect(lines[1]).toBe(
        `2. [flagged: ${VALIDATION_CHECKS.sample}] I look at a few goals. | SQL: SELECT player, minute FROM world_cup.goals LIMIT 2 | coverage: sample | 2 rows | first rows: [{"player":"Kane","minute":3},{"player":"Mbappe","minute":9}]`,
      );
      expect(lines[2]).toBe(
        `1. I count the goals of each player. | SQL: SELECT player, count(*) AS goals FROM world_cup.goals GROUP BY player | coverage: whole-table | 8 rows | first rows: ${JSON.stringify(many.slice(0, EARLIER_ROWS_SHOWN))}`,
      );
    });

    it('keeps a multi-line statement on one line and says why a query failed', () => {
      const block = earlierQueriesBlock(
        [
          query({
            sql: 'SELECT *\n  FROM nope',
            error: 'relation "nope" does not exist',
            rows: [],
            rowCount: 0,
          }),
        ],
        [],
      );
      expect(block.split('\n')[1]).toBe(
        '1. I count the goals of each player. | SQL: SELECT * FROM nope | failed: relation "nope" does not exist',
      );
    });

    it(`is at most ${8_000} characters, and says how many queries it left out`, () => {
      expect(EARLIER_BLOCK_CAP).toBe(8_000);
      const wide = Array.from({ length: 5 }, () => ({ note: 'x'.repeat(400) }));
      const queries = Array.from({ length: 12 }, (_, n) =>
        query({ sql: `SELECT ${n} AS n`, rows: wide, rowCount: 5 }),
      );
      const block = earlierQueriesBlock(queries, []);
      expect(block.length).toBeLessThanOrEqual(EARLIER_BLOCK_CAP);
      expect(block).toContain('SELECT 0 AS n');
      expect(block).not.toContain('SELECT 11 AS n');
      expect(block.split('\n').at(-1)).toMatch(
        /^\(\d+ more quer(y|ies) not listed to fit\.\)$/,
      );
      // One query longer than the cap is cut, never the cap broken.
      const huge = earlierQueriesBlock(
        [query({ sql: `SELECT '${'y'.repeat(9_000)}'` })],
        [],
      );
      expect(huge.length).toBeLessThanOrEqual(EARLIER_BLOCK_CAP);
    });

    it("lists a resumed attempt's own queries after the earlier attempt's, under one header, one numbering and one cap", () => {
      const own = query({ sql: 'SELECT 42 AS own', rows: [], rowCount: 0 });
      const lines = earlierQueriesBlock(FIRST_QUERIES, firstFindings(), [
        own,
      ]).split('\n');
      expect(
        lines.filter((line) => line === EARLIER_BLOCK_HEADER),
      ).toHaveLength(1);
      expect(lines.map((line) => line.split('.')[0])).toEqual([
        EARLIER_BLOCK_HEADER.split('.')[0],
        '2',
        '1',
        '3',
      ]);
      // The resumed attempt's queries are never flagged by attempt 1's checks.
      expect(lines[3]).not.toContain('[flagged');
      const wide = Array.from({ length: 5 }, () => ({ note: 'x'.repeat(400) }));
      const many = (from: number) =>
        Array.from({ length: 12 }, (_, n) =>
          query({ sql: `SELECT ${from + n} AS n`, rows: wide, rowCount: 5 }),
        );
      const capped = earlierQueriesBlock(many(0), [], many(100));
      expect(capped.length).toBeLessThanOrEqual(EARLIER_BLOCK_CAP);
      expect(earlierQueriesBlock([], [], [own])).toContain('1. ');
    });

    it('is empty with no earlier query', () => {
      expect(earlierQueriesBlock([], firstFindings())).toBe('');
      expect(earlierQueriesBlock([], firstFindings(), [])).toBe('');
    });
  });

  describe('analyseSystemBlocks with the earlier block', () => {
    it('puts it after the plan block, and is unchanged without one', () => {
      expect(
        analyseSystemBlocks({ catalogBlock: 'CAT', planBlock: 'PLAN' }),
      ).toEqual(['CAT', 'PLAN']);
      expect(
        analyseSystemBlocks({
          catalogBlock: 'CAT',
          planBlock: 'PLAN',
          earlierBlock: '',
        }),
      ).toEqual(['CAT', 'PLAN']);
      expect(
        analyseSystemBlocks({
          catalogBlock: 'CAT',
          planBlock: 'PLAN',
          earlierBlock: 'EARLIER',
          imageNotes: '## Reference images\nA chart.',
        }),
      ).toEqual(['CAT', 'PLAN', 'EARLIER', '## Reference images\nA chart.']);
    });
  });

  describe('mergeAttempts', () => {
    const first = () => ({
      calls: FIRST_CALLS,
      queries: FIRST_QUERIES,
      findings: firstFindings(),
    });

    it("puts attempt 2's queries first, then attempt 1's that no failed check flagged", () => {
      const merged = mergeAttempts({
        plan: PLAN,
        first: first(),
        second: { calls: [sql()], queries: [ranked()] },
      });
      expect(merged.kept).toBe('merged');
      expect(merged.ok).toBe(true);
      expect(merged.queries).toEqual([ranked(), query()]);
      // The calls follow the queries: attempt 2's, then the kept SQL call.
      expect(merged.calls).toEqual([sql(), sql()]);
      expect(merged.findings.every((f) => f.passed)).toBe(true);
    });

    it("checks the merged set in the order it ran: attempt 1's kept queries never resolve a problem attempt 2 left", () => {
      // The retry takes a sample again; attempt 1's whole count ran before
      // it, so it reads no whole data after the sample.
      const again = sampled({
        sql: "SELECT player, minute FROM world_cup.goals WHERE player <> '' LIMIT 2",
      });
      const merged = mergeAttempts({
        plan: PLAN,
        first: first(),
        second: { calls: [sql()], queries: [again] },
      });
      expect(merged.ok).toBe(false);
      expect(
        merged.findings.find((f) => f.check === VALIDATION_CHECKS.sample)
          ?.passed,
      ).toBe(false);
      // Write answer still reads attempt 2's queries first.
      expect(merged.queries).toEqual([again, query()]);
      // The same for a retry query cut at its row limit, and for a failed
      // retry call that only attempt 1's earlier calls follow.
      const cut = mergeAttempts({
        plan: PLAN,
        first: first(),
        second: {
          calls: [sql(), sql(true)],
          queries: [
            query({ truncated: true }),
            query({ error: 'boom', rows: [], rowCount: 0 }),
          ],
        },
      });
      expect(cut.ok).toBe(false);
    });

    it("drops attempt 1's failed queries from the merged set", () => {
      const merged = mergeAttempts({
        plan: PLAN,
        first: {
          calls: [sql(true), sql(), sql()],
          queries: [
            query({ error: 'boom', rows: [], rowCount: 0 }),
            query(),
            sampled(),
          ],
          findings: firstFindings(),
        },
        second: { calls: [sql()], queries: [ranked()] },
      });
      expect(merged.queries).toEqual([ranked(), query()]);
      expect(merged.calls).toEqual([sql(), sql()]);
    });

    it('keeps attempt 1 alone when the merged set fails a check attempt 1 passed', () => {
      // Attempt 1: one result cut at its row limit (flagged), no tool error.
      const cutQueries = [query({ truncated: true })];
      const cutAttempt = {
        calls: [sql()],
        queries: cutQueries,
        findings: validateAttempt({
          plan: PLAN,
          calls: [sql()],
          queries: cutQueries,
        }).findings,
      };
      // Attempt 2 fixes the cut but leaves a failed query unresolved.
      const merged = mergeAttempts({
        plan: PLAN,
        first: cutAttempt,
        second: {
          calls: [sql(), sql(true)],
          queries: [query(), query({ error: 'boom', rows: [], rowCount: 0 })],
        },
      });
      expect(merged.kept).toBe('first');
      expect(merged.queries).toEqual(cutQueries);
      expect(merged.calls).toEqual([sql()]);
      expect(merged.findings).toEqual(cutAttempt.findings);
      expect(merged.ok).toBe(false);
    });

    it('keeps attempt 1 alone when attempt 2 ran nothing successfully', () => {
      const merged = mergeAttempts({
        plan: PLAN,
        first: first(),
        second: { calls: [], queries: [] },
      });
      expect(merged.kept).toBe('first');
      expect(merged.queries).toEqual(FIRST_QUERIES);
    });

    it("keeps attempt 1 on the retry's error, with the warning-only check that never becomes a caveat", () => {
      const merged = mergeAttempts({
        plan: PLAN,
        first: first(),
        second: {
          calls: [sql()],
          queries: [ranked()],
          retryError: 'the model failed',
        },
      });
      expect(merged.kept).toBe('first');
      expect(merged.queries).toEqual(FIRST_QUERIES);
      const retry = merged.findings.at(-1)!;
      expect(retry).toEqual({
        check: 'Retry completed (warning only)',
        passed: false,
        detail:
          "Attempt 2 stopped on an error (the model failed); the answer rests on attempt 1's queries.",
      });
      expect(VALIDATION_CHECKS.retry).toBe(retry.check);
      expect(findingStatus(retry)).toBe('warning');
      // It is never a failed check the next attempt is told to fix.
      expect(merged.findings.slice(0, -1)).toEqual(firstFindings());
    });

    it("lets Write answer's 40,000-character cut drop attempt 1's queries before attempt 2's", () => {
      const rows = Array.from({ length: 50 }, (_, n) => ({
        n,
        note: 'z'.repeat(900),
      }));
      const merged = mergeAttempts({
        plan: PLAN,
        first: {
          calls: [sql()],
          queries: [query({ sql: 'SELECT first_attempt', rows, rowCount: 50 })],
          findings: [
            {
              check: VALIDATION_CHECKS.rowLimit,
              passed: false,
              detail: 'cut',
            },
          ],
        },
        second: {
          calls: [sql()],
          queries: [
            query({ sql: 'SELECT second_attempt', rows, rowCount: 50 }),
          ],
        },
      });
      expect(merged.kept).toBe('merged');
      const request = writeAnswerRequest({
        question: 'q',
        plan: PLAN,
        queries: merged.queries,
        findings: merged.findings,
      });
      // The cap holds the queries' room; their heading and the shortening
      // note come on top, as before.
      expect(request.length).toBeLessThanOrEqual(ANSWER_REQUEST_CAP + 80);
      expect(request).toContain('1. I count the goals of each player.');
      expect(request).toContain('SQL: SELECT second_attempt');
      expect(request).not.toContain('SQL: SELECT first_attempt');
    });
  });

  describe('keptQueryOrigins (workflows R41)', () => {
    const first = () => ({
      calls: FIRST_CALLS,
      queries: FIRST_QUERIES,
      findings: firstFindings(),
    });
    /** The kept set as Build visual receives it: through the workflow's state. */
    const carried = (queries: readonly AnalyseQuery[]) =>
      JSON.parse(JSON.stringify(queries)) as AnalyseQuery[];

    it("finds the merged set's queries in their attempts: attempt 2's, then attempt 1's unflagged ones", () => {
      const merged = mergeAttempts({
        plan: PLAN,
        first: first(),
        second: { calls: [sql()], queries: [ranked()] },
      });
      expect(merged.kept).toBe('merged');
      expect(
        keptQueryOrigins([FIRST_QUERIES, [ranked()]], carried(merged.queries)),
      ).toEqual([
        { attempt: 2, index: 0 },
        { attempt: 1, index: 0 },
      ]);
    });

    it('finds attempt 1 alone when the merge kept it', () => {
      const merged = mergeAttempts({
        plan: PLAN,
        first: first(),
        second: { calls: [sql()], queries: [ranked()], retryError: 'down' },
      });
      expect(merged.kept).toBe('first');
      expect(
        keptQueryOrigins([FIRST_QUERIES, [ranked()]], carried(merged.queries)),
      ).toEqual([
        { attempt: 1, index: 0 },
        { attempt: 1, index: 1 },
      ]);
    });

    it('tells two queries with the same SQL apart by what they returned', () => {
      const SQL = 'SELECT player FROM world_cup.goals';
      const cut = query({
        sql: SQL,
        rows: [{ player: 'Kane' }],
        rowCount: 1,
        truncated: true,
      });
      const whole = query({
        sql: SQL,
        rows: [{ player: 'Kane' }, { player: 'Mbappe' }],
        rowCount: 2,
      });
      // The retry ran it again whole; the cut one was flagged and dropped.
      expect(keptQueryOrigins([[cut], [whole]], carried([whole]))).toEqual([
        { attempt: 2, index: 0 },
      ]);
      // Attempt 1 alone kept: its own run, not the retry's same SQL.
      expect(keptQueryOrigins([[cut], [whole]], carried([cut]))).toEqual([
        { attempt: 1, index: 0 },
      ]);
      // Within one attempt: the second run of the SQL, not the first.
      expect(
        keptQueryOrigins(
          [[cut, whole], [ranked()]],
          carried([ranked(), whole]),
        ),
      ).toEqual([
        { attempt: 2, index: 0 },
        { attempt: 1, index: 1 },
      ]);
    });

    it('is undefined without a retry or when the set is not one the merge keeps', () => {
      expect(keptQueryOrigins([FIRST_QUERIES], FIRST_QUERIES)).toBeUndefined();
      expect(
        keptQueryOrigins([FIRST_QUERIES, [ranked()]], [query({ sql: 'x' })]),
      ).toBeUndefined();
    });
  });

  it('gives the retry a step budget of 8', () => {
    expect(ANALYSE_RETRY_MAX_STEPS).toBe(8);
  });

  it("ends the Analyst's instructions with the rule that fires on the earlier block or the columns (agents.md Appendix E)", () => {
    const rules = INSIGHTS_ANALYST_PROMPT.split('\n');
    const start = rules.findIndex((line) =>
      line.startsWith('Earlier work in the request:'),
    );
    expect(start).toBeGreaterThan(0);
    // Late: the rules before it read as they always did; only the data-dates
    // rule (agents.md 4.1 *Data dates*) follows it.
    const dates = rules.findIndex((line) => line.startsWith('Data dates:'));
    expect(dates).toBeGreaterThan(start);
    const rule = rules
      .slice(start + 1, dates)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    expect(rule).toBe(
      '- When the request lists queries an earlier attempt of this analysis already ran, or the columns of each entity, do not list the entities again ([[tool:list_entities]]) and do not describe an entity whose columns are all listed ([[tool:describe_entity]]): run only the queries the failed checks need, or on a first attempt the ones the plan needs. An entity marked "none listed" or "more not listed" has columns the request leaves out: describe it when the analysis needs one of them.',
    );
    // Its cues are the words of the blocks Analyse's request carries.
    expect(EARLIER_BLOCK_HEADER.toLowerCase()).toContain(
      'queries an earlier attempt of this analysis already ran',
    );
    expect(
      planCatalogBlock(
        [
          {
            entity: 'wc.goals',
            dataset: 'World Cup',
            datasourceId: null,
            datasourceKind: null,
            columnCount: 1,
          },
        ],
        [
          {
            entity: 'wc.goals',
            columns: [{ name: 'player', type: '' }],
            more: 0,
          },
        ],
      ).toLowerCase(),
    ).toContain('columns of each entity');
    // An entity past the column caps carries the words the rule's
    // exception names, so the Analyst may still describe it.
    const capped = planCatalogBlock(
      [
        {
          entity: 'wc.wide',
          dataset: 'World Cup',
          datasourceId: null,
          datasourceKind: null,
          columnCount: 41,
        },
        {
          entity: 'wc.unlisted',
          dataset: 'World Cup',
          datasourceId: null,
          datasourceKind: null,
          columnCount: 40,
        },
      ],
      [
        {
          entity: 'wc.wide',
          columns: [{ name: 'player', type: '' }],
          more: 40,
        },
        { entity: 'wc.unlisted', columns: [], more: 40 },
      ],
    );
    expect(capped).toContain('- wc.wide: player (+40 more not listed)');
    expect(capped).toContain(
      '- wc.unlisted: (none listed) (+40 more not listed)',
    );
    expect(rule).toContain('"none listed" or "more not listed"');
  });
});

describe('data dates in the analysis (agents.md 4.1 *Data dates*, 5.11 Validate)', () => {
  const NOW = new Date('2026-11-17T12:00:00Z');
  const CENSUS = 'file.demo_census_prod.demographics_data';
  const PLAN: AnalysisPlan = {
    question: 'How many employees fall in each tenure band?',
    measures: ['employees per tenure band'],
    entities: [CENSUS],
    scope: 'All employees.',
    assumptions: [],
    needsClarification: false,
    clarification: null,
  };
  const catalog = (dataEndsAt: string | null) => [
    {
      entity: CENSUS,
      dataset: 'Census',
      datasourceId: 'ds-1',
      datasourceKind: 'file',
      columnCount: 97,
      dataEndsAt,
    },
  ];
  const query = (sql: string): AnalyseQuery => ({
    sql,
    rows: [{ band: '3-5', n: 484 }],
    rowCount: 6,
    truncated: false,
  });
  const TODAY = query(
    `SELECT band, COUNT(*) n FROM ${CENSUS} WHERE date_diff('day', "Date of Hire", CURRENT_DATE) > 0 GROUP BY band`,
  );
  const AS_OF = query(
    `SELECT band, COUNT(*) n FROM ${CENSUS} WHERE date_diff('day', "Date of Hire", DATE '2024-01-01') > 0 GROUP BY band`,
  );
  const calls = [{ tool: 'run_readonly_sql', rowCount: 6, failed: false }];
  const check = VALIDATION_CHECKS.dataDate;

  it('loads the date the data ends from the dated columns', async () => {
    getDatasets.mockResolvedValueOnce([
      {
        name: 'Census',
        datasourceId: 'ds-1',
        datasourceKind: 'file',
        tables: [CENSUS],
        entities: [
          {
            key: CENSUS,
            columns: [
              {
                name: 'Date of Hire',
                type: 'DATE',
                range: { min: '2004-01-01', max: '2023-07-02' },
              },
              { name: 'Age', type: 'DOUBLE' },
            ],
          },
        ],
      },
    ]);
    const { catalog: loaded } = await loadCatalog(['Census']);
    expect(loaded[0].dataEndsAt).toBe('2023-07-02');
  });

  it('says in the catalog where the data ends when the question has a time cue, and is as before otherwise', () => {
    const question = 'How many employees fall in each tenure band?';
    const block = catalogBlock(catalog('2023-07-02'), { question, now: NOW });
    expect(block).toBe(
      [
        'Catalog loaded for this turn: 1 entity.',
        `- ${CENSUS} (dataset: Census; 97 columns)`,
        'The Census data ends 2023-07-02: a figure that depends on the current date (tenure, age, time since) is measured from that date, not from today, unless the question asks about today.',
      ].join('\n'),
    );
    const plain = `Catalog loaded for this turn: 1 entity.\n- ${CENSUS} (dataset: Census; 97 columns)`;
    // Current data, a question with no time cue, or no question: as before.
    expect(catalogBlock(catalog('2026-11-10'), { question, now: NOW })).toBe(
      plain,
    );
    expect(
      catalogBlock(catalog('2023-07-02'), {
        question: 'Which plan is the most popular?',
        now: NOW,
      }),
    ).toBe(plain);
    expect(catalogBlock(catalog('2023-07-02'), { now: NOW })).toBe(plain);
  });

  it('fails an attempt that measured against today on data that ends well before it', () => {
    const checked = validateAttempt(
      {
        plan: PLAN,
        calls,
        queries: [TODAY],
        catalog: catalog('2023-07-02'),
        question: PLAN.question,
      },
      NOW,
    );
    expect(checked.ok).toBe(false);
    expect(checked.findings.find((f) => f.check === check)).toEqual({
      check,
      passed: false,
      detail:
        '1 query measured against today on data that ends well before it (the Census data ends 2023-07-02): measure from the date the data ends, and say which date you used.',
    });
    expect(flaggedQueries([TODAY], checked.findings)).toEqual([check]);
  });

  it('passes when the data date is used, a later query re-read it, or the question asks about today', () => {
    const base = { plan: PLAN, calls, catalog: catalog('2023-07-02') };
    expect(
      validateAttempt(
        { ...base, queries: [AS_OF], question: PLAN.question },
        NOW,
      ).ok,
    ).toBe(true);
    expect(
      validateAttempt(
        { ...base, queries: [TODAY, AS_OF], question: PLAN.question },
        NOW,
      ).ok,
    ).toBe(true);
    const today = validateAttempt(
      {
        ...base,
        queries: [TODAY],
        question: 'How many employees have under 1 year of tenure as of today?',
      },
      NOW,
    );
    expect(today.ok).toBe(true);
    expect(today.findings.find((f) => f.check === check)?.detail).toBe(
      'The question asks about today.',
    );
  });

  it('adds no finding over current data or without a catalog, so other runs read as before', () => {
    for (const input of [
      {
        plan: PLAN,
        calls,
        queries: [TODAY],
        catalog: catalog('2026-11-10'),
        question: PLAN.question,
      },
      { plan: PLAN, calls, queries: [TODAY] },
    ]) {
      const checked = validateAttempt(input, NOW);
      expect(checked.ok).toBe(true);
      expect(checked.findings.map((f) => f.check)).not.toContain(check);
      expect(checked.findings).toHaveLength(5);
    }
  });

  it('drops the query measured against today when a retry measures from the data date', () => {
    const first = validateAttempt(
      {
        plan: PLAN,
        calls,
        queries: [TODAY],
        catalog: catalog('2023-07-02'),
        question: PLAN.question,
      },
      NOW,
    );
    const merged = mergeAttempts({
      plan: PLAN,
      first: { calls, queries: [TODAY], findings: first.findings },
      second: { calls, queries: [AS_OF] },
      catalog: catalog('2023-07-02'),
      question: PLAN.question,
    });
    expect(merged.ok).toBe(true);
    expect(merged.queries).toEqual([AS_OF]);
  });
});
