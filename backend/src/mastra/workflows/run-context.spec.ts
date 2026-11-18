import {
  RUN_CONTEXT_KEY,
  RUN_CONTEXT_PAGE_CHARS,
  RUN_CONTEXT_ROWS_CAP,
  RunContextBoard,
  publishCatalog,
  publishImageNotes,
  publishQueries,
  runContextIndexBlock,
  runContextOf,
} from './run-context';

describe('run context board', () => {
  it('reads an entry in pages and records every read', () => {
    const board = new RunContextBoard();
    const content = 'x'.repeat(RUN_CONTEXT_PAGE_CHARS + 10);
    board.write('long', 'A long entry', content);

    const first = board.read('long');
    expect(first).toMatchObject({
      key: 'long',
      offset: 0,
      nextOffset: RUN_CONTEXT_PAGE_CHARS,
      totalChars: content.length,
    });
    const second = board.read('long', RUN_CONTEXT_PAGE_CHARS);
    expect(second).toMatchObject({ nextOffset: null });
    expect('content' in second && second.content).toHaveLength(10);
    expect(board.reads).toEqual([
      { key: 'long', offset: 0, chars: RUN_CONTEXT_PAGE_CHARS },
      { key: 'long', offset: RUN_CONTEXT_PAGE_CHARS, chars: 10 },
    ]);
  });

  it('answers an unknown key with the known keys, and records no read', () => {
    const board = new RunContextBoard();
    board.write('catalog/a', 'Columns of a', 'id int');
    expect(board.read('catalog/b')).toEqual({
      error: 'No run context entry "catalog/b". Known keys: catalog/a',
    });
    expect(board.reads).toEqual([]);
  });

  it('publishes columns per entity, image notes, and replaces queries', () => {
    const board = new RunContextBoard();
    publishCatalog(
      board,
      [
        { entity: 'wc.matches', dataset: 'World Cup', columnCount: 3 },
        { entity: 'wc.goals', dataset: 'World Cup', columnCount: null },
      ],
      [
        {
          entity: 'wc.matches',
          columns: [
            { name: 'id', type: 'int' },
            { name: 'year', type: '' },
          ],
          more: 1,
        },
      ],
    );
    publishImageNotes(board, '   ');
    publishImageNotes(board, 'A bar chart of goals');
    const row = { n: 1 };
    publishQueries(board, [
      { sql: 'select 1', rows: [row], rowCount: 1, truncated: false },
      {
        sql: 'select 2',
        rows: [],
        rowCount: 0,
        truncated: false,
        error: 'boom',
      },
    ]);
    publishQueries(board, [
      {
        sql: 'select 3',
        rationale: 'Count',
        rows: Array.from({ length: RUN_CONTEXT_ROWS_CAP + 5 }, () => row),
        rowCount: RUN_CONTEXT_ROWS_CAP + 5,
        truncated: false,
      },
    ]);

    expect(board.get('catalog/wc.matches')?.content).toBe(
      'Columns of wc.matches (name type):\n- id int\n- year\n(+1 more not listed)',
    );
    expect(board.get('catalog/wc.goals')?.content).toContain('(none listed)');
    expect(board.get('image-notes')?.content).toBe('A bar chart of goals');
    expect(board.list('queries/').map((entry) => entry.key)).toEqual([
      'queries/1',
    ]);
    const query = board.get('queries/1')?.content ?? '';
    expect(query).toContain('Query 1: Count (55 rows, the first 50 kept)');
    expect(query).toContain('SQL: select 3');
  });

  it('indexes the entries under the given prefixes', () => {
    const board = new RunContextBoard();
    board.write('catalog/a', 'Columns of a', 'abc');
    board.write('queries/1', 'Query 1', 'abcd');
    expect(runContextIndexBlock(board, ['catalog/'])).toBe(
      [
        'Run context (read an entry with read_run_context by its key; list them with list_run_context):',
        '- catalog/a — Columns of a (3 chars)',
      ].join('\n'),
    );
    expect(runContextIndexBlock(new RunContextBoard())).toBe(
      'Run context: no entries.',
    );
  });

  it('finds the board on a request context', () => {
    const board = new RunContextBoard();
    const values = new Map<string, unknown>([[RUN_CONTEXT_KEY, board]]);
    expect(runContextOf({ get: (key) => values.get(key) })).toBe(board);
    expect(runContextOf({ get: () => ({}) })).toBeUndefined();
  });
});
