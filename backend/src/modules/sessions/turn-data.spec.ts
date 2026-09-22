import {
  STORED_ROWS_CAP,
  toolRecords,
  toolResultRecord,
  toolResultRecords,
} from './turn-data';

/**
 * The shapes a tool result has actually arrived in. The eval harness captures
 * its SQL evidence through this code (`captureStepRecords` →
 * `toolResultRecords`), so a shape it fails to read is not a missing row in a
 * log — it is an eval case that silently reports no rows and scores as a
 * wrong answer.
 */
describe('toolResultRecord', () => {
  const sqlResult = {
    columns: ['sample_count'],
    rows: [{ sample_count: '125' }],
  };
  const args = {
    sql: 'SELECT COUNT(*) AS sample_count FROM genomics.samples',
    limit: 1,
  };

  /** What @mastra/core 1.66 hands to `onStepFinish` today. */
  it('reads the chunk shape the installed SDK produces', () => {
    const record = toolResultRecord({
      type: 'tool-result',
      runId: 'run-1',
      from: 'AGENT',
      payload: {
        toolCallId: 'call-1',
        toolName: 'run_readonly_sql',
        args,
        result: sqlResult,
      },
    });
    expect(record).toMatchObject({
      tool: 'run_readonly_sql',
      input: args.sql,
      rows: sqlResult.rows,
      rowCount: 1,
    });
  });

  /** The AI SDK's own naming, which `extractToolCalls` already defends against. */
  it('reads the input/output spelling of the same chunk', () => {
    const record = toolResultRecord({
      type: 'tool-result',
      payload: {
        toolName: 'run_readonly_sql',
        input: args,
        output: sqlResult,
      },
    });
    expect(record).toMatchObject({ input: args.sql, rows: sqlResult.rows });
  });

  it('reads the legacy flat shape with no chunk wrapper', () => {
    const record = toolResultRecord({
      toolName: 'run_readonly_sql',
      args,
      result: sqlResult,
    });
    expect(record).toMatchObject({ input: args.sql, rows: sqlResult.rows });
  });

  it('parses a JSON-encoded result and arguments', () => {
    const record = toolResultRecord({
      payload: {
        name: 'run_readonly_sql',
        args: JSON.stringify(args),
        result: JSON.stringify(sqlResult),
      },
    });
    expect(record).toMatchObject({ input: args.sql, rows: sqlResult.rows });
  });

  it('unwraps an AI-SDK output part around the tool value', () => {
    const record = toolResultRecord({
      payload: {
        toolName: 'run_readonly_sql',
        input: args,
        output: { type: 'json', value: sqlResult },
      },
    });
    expect(record).toMatchObject({ input: args.sql, rows: sqlResult.rows });
  });

  it('keeps a result that merely has type and rows of its own', () => {
    const record = toolResultRecord({
      payload: {
        toolName: 'run_readonly_sql',
        input: args,
        output: { type: 'summary', value: 'ignored', rows: sqlResult.rows },
      },
    });
    expect(record?.rows).toEqual(sqlResult.rows);
  });

  it('keeps the error branch and the connector truncation flag', () => {
    expect(
      toolResultRecord({
        payload: {
          toolName: 'run_readonly_sql',
          input: args,
          output: { error: 'relation does not exist' },
        },
      }),
    ).toMatchObject({ error: 'relation does not exist' });
    expect(
      toolResultRecord({
        payload: {
          toolName: 'run_readonly_sql',
          input: args,
          output: { ...sqlResult, truncated: true },
        },
      }),
    ).toMatchObject({ truncated: true });
  });

  it('flags the transcript cap as truncation and keeps the real row count', () => {
    const rows = Array.from({ length: STORED_ROWS_CAP + 5 }, (_, i) => ({
      i,
    }));
    const record = toolResultRecord({
      payload: { toolName: 'run_readonly_sql', input: args, output: { rows } },
    });
    expect(record?.rows).toHaveLength(STORED_ROWS_CAP);
    expect(record?.rowCount).toBe(STORED_ROWS_CAP + 5);
    expect(record?.truncated).toBe(true);
  });

  it('ignores tools that carry no data', () => {
    expect(
      toolResultRecord({ payload: { toolName: 'list_entities', result: {} } }),
    ).toBeNull();
    expect(toolResultRecord(undefined)).toBeNull();
  });
});

describe('toolResultRecords', () => {
  it('collects every data-bearing entry and skips the rest', () => {
    const records = toolResultRecords([
      {
        type: 'tool-result',
        payload: {
          toolName: 'run_readonly_sql',
          args: { sql: 'SELECT 1' },
          result: { rows: [{ a: 1 }] },
        },
      },
      { type: 'tool-result', payload: { toolName: 'list_entities' } },
      null,
    ]);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ input: 'SELECT 1', rowCount: 1 });
  });

  it('returns nothing when the batch is not a list', () => {
    expect(toolResultRecords(undefined)).toEqual([]);
  });
});

describe('toolRecords', () => {
  it('reads a non-streamed result through the same shapes', () => {
    expect(
      toolRecords({
        toolResults: [
          {
            payload: {
              toolName: 'run_readonly_sql',
              input: { sql: 'SELECT 2' },
              output: { rows: [{ a: 2 }] },
            },
          },
        ],
      }),
    ).toMatchObject([{ input: 'SELECT 2', rowCount: 1 }]);
  });
});
