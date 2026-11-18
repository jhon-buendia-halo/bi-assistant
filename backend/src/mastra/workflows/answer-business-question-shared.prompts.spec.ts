/**
 * The shared-context experiment's prompts (./run-context.ts, approach B):
 * the agents get the board's index and the tools line instead of the large
 * context, and the baseline's prompts are reused around them.
 */
import {
  ANALYSE_VISUAL_LINE,
  ANSWER_REQUEST_CAP,
  planMessages,
  WRITE_ANSWER_VISUAL_LINE,
} from './answer-business-question.prompts';
import {
  SHARED_CONTEXT_ANALYSE_TOOLS_LINE,
  SHARED_CONTEXT_EARLIER_LINE,
  SHARED_CONTEXT_MAX_STEPS,
  SHARED_CONTEXT_TOOLS_LINE,
  SHARED_CONTEXT_WRITE_ANSWER_TOOLS_LINE,
  SHARED_QUERY_INDEX_HEADER,
  sharedAnalyseSystemBlocks,
  sharedCatalogIndexBlock,
  sharedPlanMessages,
  sharedPlanRequest,
  sharedWriteAnswerRequest,
} from './answer-business-question-shared.prompts';
import {
  catalogBlock,
  type AnalyseQuery,
  type AnalysisPlan,
  type CatalogEntity,
} from './answer-business-question.steps';
import {
  publishCatalog,
  publishImageNotes,
  publishQueries,
  RunContextBoard,
  runContextIndexBlock,
} from './run-context';

const CATALOG: CatalogEntity[] = [
  {
    entity: 'f1.drivers',
    dataset: 'F1',
    datasourceId: null,
    datasourceKind: null,
    columnCount: 2,
  },
];
const COLUMNS = [
  {
    entity: 'f1.drivers',
    columns: [
      { name: 'driver_name', type: 'text' },
      { name: 'race_starts', type: 'integer' },
    ],
    more: 0,
  },
];
const NOTES = '## Reference images\nA bar chart of race starts.';

const PLAN: AnalysisPlan = {
  question: 'Which drivers have the most race starts?',
  measures: ['race starts'],
  entities: ['f1.drivers'],
  scope: 'All seasons.',
  assumptions: [],
  needsClarification: false,
  clarification: null,
};
const RANKED: AnalyseQuery = {
  sql: 'SELECT driver_name, race_starts FROM f1.drivers ORDER BY 2 DESC',
  rationale: 'I rank the drivers by race starts.',
  rows: Array.from({ length: 102 }, (_, i) => ({
    driver_name: `Driver ${i + 1}`,
    race_starts: 400 - i,
  })),
  rowCount: 102,
  truncated: false,
};
const FAILED: AnalyseQuery = {
  sql: 'SELECT nope FROM f1.drivers',
  rationale: 'I check a column.',
  rows: [],
  rowCount: 0,
  truncated: false,
  error: 'column "nope" does not exist',
};

/** A board as Publish run context and Write answer's runtime fill it. */
function filledBoard(): RunContextBoard {
  const board = new RunContextBoard();
  publishCatalog(board, CATALOG, COLUMNS);
  publishImageNotes(board, NOTES);
  publishQueries(board, [RANKED, FAILED]);
  board.write('earlier-queries', 'Queries an earlier attempt ran', 'x');
  return board;
}

describe('the shared-context prompts', () => {
  it('budgets eight steps for the tool loop', () => {
    expect(SHARED_CONTEXT_MAX_STEPS).toBe(8);
  });

  it('says the tools exist in this run and that the reply is still JSON', () => {
    expect(SHARED_CONTEXT_TOOLS_LINE).toContain('In this run you do have');
    expect(SHARED_CONTEXT_TOOLS_LINE).toContain('list_run_context');
    expect(SHARED_CONTEXT_TOOLS_LINE).toContain('read_run_context');
    expect(SHARED_CONTEXT_TOOLS_LINE).toContain('catalog/<entity>');
    expect(SHARED_CONTEXT_TOOLS_LINE).toContain('several reads in one step');
    expect(SHARED_CONTEXT_TOOLS_LINE).toContain('JSON object');
    expect(SHARED_CONTEXT_ANALYSE_TOOLS_LINE).toContain('read_run_context');
    expect(SHARED_CONTEXT_ANALYSE_TOOLS_LINE).toContain('catalog/<entity>');
    expect(SHARED_CONTEXT_ANALYSE_TOOLS_LINE).not.toContain('JSON');
    expect(SHARED_CONTEXT_WRITE_ANSWER_TOOLS_LINE).toContain('queries/<n>');
    expect(SHARED_CONTEXT_WRITE_ANSWER_TOOLS_LINE).not.toContain('catalog/');
    expect(SHARED_CONTEXT_WRITE_ANSWER_TOOLS_LINE).toContain('JSON object');
  });

  it('indexes the catalog: the entities without columns, then their board entries', () => {
    const board = filledBoard();
    expect(sharedCatalogIndexBlock(CATALOG, board)).toBe(
      `${catalogBlock(CATALOG)}\n\n${runContextIndexBlock(board, ['catalog/', 'image-notes'])}`,
    );
    const block = sharedCatalogIndexBlock(CATALOG, board);
    expect(block).toContain('- catalog/f1.drivers — Columns of f1.drivers');
    expect(block).toContain('- image-notes — ');
    expect(block).not.toContain('queries/');
    expect(block).not.toContain('earlier-queries');
    expect(block).not.toContain('race_starts');
  });

  it("builds Plan's request: question, index, tools line; no columns, no inline notes", () => {
    const board = filledBoard();
    expect(sharedPlanRequest('Q', CATALOG, board)).toBe(
      `Question: Q\n\n${sharedCatalogIndexBlock(CATALOG, board)}\n\n${SHARED_CONTEXT_TOOLS_LINE}`,
    );
    const request = sharedPlanRequest('Q', CATALOG, board);
    expect(request).not.toContain('driver_name');
    expect(request).not.toContain('A bar chart');
  });

  it("mirrors Plan's messages: the conversation before, the clarification answered", () => {
    const board = filledBoard();
    const messages = [
      { role: 'user', content: 'Earlier' },
      { role: 'assistant', content: 'Reply' },
      { role: 'user', content: 'Q' },
    ];
    const plain = sharedPlanMessages({
      messages,
      question: 'Q',
      catalog: CATALOG,
      board,
    });
    expect(plain).toEqual({
      messages: [
        { role: 'user', content: 'Earlier' },
        { role: 'assistant', content: 'Reply' },
        { role: 'user', content: sharedPlanRequest('Q', CATALOG, board) },
      ],
      fallback: 'Q',
    });
    const answered = {
      question: 'Which measure?',
      options: ['Race starts', 'Wins'],
      answer: 'Race starts',
    };
    const after = sharedPlanMessages({
      messages,
      question: 'Q',
      catalog: CATALOG,
      board,
      answered,
    });
    const shape = planMessages({
      messages,
      question: 'Q',
      catalogBlock: 'CAT',
      answered,
    });
    expect(after.fallback).toBe(shape.fallback);
    expect((after.messages as unknown[]).slice(0, -1)).toEqual(
      (shape.messages as unknown[]).slice(0, -1),
    );
    expect((after.messages as unknown[]).at(-1)).toEqual({
      role: 'user',
      content: sharedPlanRequest('Race starts', CATALOG, board),
    });
    // A bare question with no conversation is the request alone.
    expect(
      sharedPlanMessages({
        messages: 'Q',
        question: 'Q',
        catalog: CATALOG,
        board,
      }).messages,
    ).toBe(sharedPlanRequest('Q', CATALOG, board));
  });

  it("builds Analyse's blocks in order, the earlier line and the visual line only when asked", () => {
    const board = filledBoard();
    const index = `${catalogBlock(CATALOG)}\n\n${runContextIndexBlock(board, ['catalog/', 'image-notes', 'earlier-queries'])}`;
    expect(
      sharedAnalyseSystemBlocks({ catalog: CATALOG, board, planBlock: 'PLAN' }),
    ).toEqual([index, 'PLAN', SHARED_CONTEXT_ANALYSE_TOOLS_LINE]);
    expect(
      sharedAnalyseSystemBlocks({
        catalog: CATALOG,
        board,
        planBlock: 'PLAN',
        hasEarlier: true,
        visualFollows: true,
      }),
    ).toEqual([
      index,
      'PLAN',
      SHARED_CONTEXT_EARLIER_LINE,
      SHARED_CONTEXT_ANALYSE_TOOLS_LINE,
      ANALYSE_VISUAL_LINE,
    ]);
    expect(index).toContain('- earlier-queries — ');
    expect(index).not.toContain('queries/');
    expect(SHARED_CONTEXT_EARLIER_LINE).toContain('earlier-queries');
  });

  it("builds Write answer's request: a query index without rows, then the findings, index, tools", () => {
    const board = filledBoard();
    const request = sharedWriteAnswerRequest({
      question: PLAN.question,
      plan: PLAN,
      queries: [RANKED, FAILED],
      findings: [
        { check: 'Ran a query', passed: true, detail: 'Two queries ran.' },
      ],
      board,
    });
    expect(request).toBe(
      [
        `Question: ${PLAN.question}`,
        '',
        'Plan:',
        JSON.stringify(PLAN),
        '',
        SHARED_QUERY_INDEX_HEADER,
        '1. I rank the drivers by race starts. (102 rows, the first 50 shown)',
        `SQL: ${RANKED.sql}`,
        'Columns: driver_name, race_starts',
        '',
        '2. I check a column. (failed: column "nope" does not exist)',
        `SQL: ${FAILED.sql}`,
        '',
        'Validation findings:',
        '- passed: Ran a query. Two queries ran.',
        '',
        runContextIndexBlock(board, ['queries/', 'image-notes']),
        '',
        SHARED_CONTEXT_WRITE_ANSWER_TOOLS_LINE,
      ].join('\n'),
    );
    expect(request).not.toContain('Driver 1');
    expect(request).not.toContain('catalog/');
  });

  it('ends with the visual line when a visual follows, and says when no query ran', () => {
    const board = new RunContextBoard();
    const request = sharedWriteAnswerRequest({
      question: 'Q',
      plan: PLAN,
      queries: [],
      findings: [],
      board,
      visualFollows: true,
    });
    expect(request).toContain(`${SHARED_QUERY_INDEX_HEADER}\n(no query ran)`);
    expect(request).toContain('- none');
    expect(request).toContain('Run context: no entries.');
    expect(request.endsWith(`\n\n${WRITE_ANSWER_VISUAL_LINE}`)).toBe(true);
  });

  it('lists a query with no rows by its columns as none, and cuts a long index to fit', () => {
    const board = new RunContextBoard();
    const empty = { ...RANKED, rows: [], rowCount: 0 };
    expect(
      sharedWriteAnswerRequest({
        question: 'Q',
        plan: PLAN,
        queries: [empty],
        findings: [],
        board,
      }),
    ).toContain(`(0 rows)\nSQL: ${RANKED.sql}\nColumns: (no rows)`);
    const long = { ...RANKED, sql: `SELECT ${'x, '.repeat(30_000)}1` };
    const request = sharedWriteAnswerRequest({
      question: 'Q',
      plan: PLAN,
      queries: [long],
      findings: [],
      board,
    });
    expect(request).toContain('[queries shortened to fit]');
    expect(request.length).toBeLessThanOrEqual(ANSWER_REQUEST_CAP + 40);
    expect(request.endsWith(SHARED_CONTEXT_WRITE_ANSWER_TOOLS_LINE)).toBe(true);
  });
});
