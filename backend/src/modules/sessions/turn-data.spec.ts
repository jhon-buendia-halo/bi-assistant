import { synthesizeToolOnlyTurn, toolDataRecord } from './turn-data';
import { USAGE_SINK_CONTEXT_KEY } from '../../mastra/usage-sink';

/** A requestContext holding only what the synthesis reads. */
function contextWith(sink?: unknown) {
  return {
    get: (key: string) => (key === USAGE_SINK_CONTEXT_KEY ? sink : undefined),
  };
}

describe('synthesizeToolOnlyTurn usage sink (agents-evals R219)', () => {
  const data = [{ tool: 'run_readonly_sql', input: 'select 1' }];
  const result = { text: 'Done.', usage: { inputTokens: 5 } };
  const run = (context?: ReturnType<typeof contextWith>) =>
    synthesizeToolOnlyTurn(
      { generate: jest.fn().mockResolvedValue(result) } as never,
      'How many?',
      data,
      new AbortController().signal,
      {},
      undefined,
      context as never,
    );

  it('reports the synthesis as an assistant call with the raw result', async () => {
    const sink = jest.fn();

    await expect(run(contextWith(sink))).resolves.toBe('Done.');

    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink).toHaveBeenCalledWith('assistant', result, undefined);
  });

  it('is a no-op without a sink', async () => {
    await expect(run(contextWith())).resolves.toBe('Done.');
    await expect(run()).resolves.toBe('Done.');
  });

  it('never fails the turn when the sink throws', async () => {
    const sink = jest.fn(() => {
      throw new Error('boom');
    });

    await expect(run(contextWith(sink))).resolves.toBe('Done.');
    expect(sink).toHaveBeenCalled();
  });
});

describe('toolDataRecord: an explore_result result (agents.md 3.15)', () => {
  const SOURCE = 'SELECT country, goals FROM wc.public.scorers';
  const view = {
    filters: [{ column: 'country', op: 'eq' as const, value: 'Brazil' }],
    sort: [],
    page: 2,
    pageSize: 2,
    matchedRows: 5,
    capped: false,
  };

  it('stores the page against the source SQL, so the inspector, re-run and CSV act on it', () => {
    const record = toolDataRecord(
      'explore_result',
      { filterText: 'only Brazil', page: 2, rationale: '  Only   Brazil. ' },
      {
        sourceSql: SOURCE,
        datasourceId: 'ds-1',
        view,
        columns: ['country', 'goals'],
        rows: [
          { country: 'Brazil', goals: 3 },
          { country: 'Brazil', goals: 2 },
        ],
        page: 2,
        pageCount: 3,
        matchedRows: 5,
        capped: false,
        understood: 'Country is Brazil',
      },
    );
    expect(record).toEqual({
      tool: 'explore_result',
      input: SOURCE,
      columns: ['country', 'goals'],
      rows: [
        { country: 'Brazil', goals: 3 },
        { country: 'Brazil', goals: 2 },
      ],
      rowCount: 2,
      // More pages exist.
      truncated: true,
      rationale: 'Only Brazil.',
    });
    // The view is evidence, never a record field fed to models.
    expect(record).not.toHaveProperty('view');
  });

  it('is not truncated on the last page', () => {
    const record = toolDataRecord(
      'explore_result',
      { rationale: 'x' },
      {
        sourceSql: SOURCE,
        columns: ['country'],
        rows: [{ country: 'Chile' }],
        page: 3,
        pageCount: 3,
        matchedRows: 5,
        capped: false,
      },
    );
    expect(record).not.toHaveProperty('truncated');
  });

  it('keeps a refusal with its source SQL when one was named', () => {
    expect(
      toolDataRecord(
        'explore_result',
        { query: SOURCE, rationale: 'x' },
        { error: 'Unknown column "nope"' },
      ),
    ).toEqual({
      tool: 'explore_result',
      input: SOURCE,
      error: 'Unknown column "nope"',
      rationale: 'x',
    });
  });
});
