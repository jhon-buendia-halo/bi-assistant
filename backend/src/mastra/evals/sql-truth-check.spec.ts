// The sqlTruth check (agents.md 8.1): the reference SQL runs on the case's
// datasource at eval time; the comparators decide. `runReadOnlySql` is a
// stand-in: no database, no model.
const runReadOnlySql = jest.fn();
const getDatasets = jest.fn();
jest.mock('../tool-services', () => ({
  getDatasetToolServices: () => ({ runReadOnlySql, getDatasets }),
}));

import type { EvalCustomCheckInput } from './assistant.evals';
import {
  answerHasNumber,
  answerMentionsAll,
  jsonFieldEquals,
  sqlTruthCheck,
} from './sql-truth-check';

function input(answer: string, details = {}): EvalCustomCheckInput {
  return {
    answer,
    toolCalls: [],
    datasets: ['Edge Cases'],
    vars: {},
    details,
  };
}

beforeEach(() => {
  runReadOnlySql.mockReset();
  getDatasets.mockReset();
  getDatasets.mockResolvedValue([
    { name: 'Edge Cases', datasourceId: 'ds-edge', tables: [] },
  ]);
});

function rows(...values: Record<string, unknown>[]) {
  runReadOnlySql.mockResolvedValue({
    columns: Object.keys(values[0] ?? {}),
    rows: values,
  });
}

describe('sqlTruthCheck', () => {
  const check = sqlTruthCheck({
    id: 'orders-total',
    description: 'States the number of orders',
    sql: 'SELECT count(*) AS n FROM edge_cases.orders',
    compare: answerHasNumber('n'),
  });

  it('runs the SQL read-only on the case datasource and passes a matching answer', async () => {
    rows({ n: 1200 });
    expect(check.id).toBe('orders-total');
    expect(await check.run(input('There are 1,200 orders.'))).toBeUndefined();
    expect(getDatasets).toHaveBeenCalledWith(['Edge Cases']);
    expect(runReadOnlySql).toHaveBeenCalledWith(
      'ds-edge',
      'SELECT count(*) AS n FROM edge_cases.orders',
      500,
      ['Edge Cases'],
    );
  });

  it('fails a wrong answer with the SQL value and the numbers it found', async () => {
    rows({ n: 1200 });
    expect(await check.run(input('There are 1,100 orders.'))).toBe(
      'expected the answer to state 1200 (n from the reference SQL); the numbers in it are 1100',
    );
  });

  it('fails when the reference SQL fails, is truncated, or has no datasource', async () => {
    runReadOnlySql.mockRejectedValueOnce(new Error('relation does not exist'));
    expect(await check.run(input('1200'))).toBe(
      'the reference SQL failed to run — relation does not exist',
    );
    runReadOnlySql.mockResolvedValueOnce({
      columns: ['n'],
      rows: [{ n: 1 }],
      truncated: true,
    });
    expect(await check.run(input('1'))).toBe(
      'the reference SQL result is truncated; the truth cannot be read',
    );
    getDatasets.mockResolvedValueOnce([{ name: 'Edge Cases', tables: [] }]);
    expect(await check.run(input('1'))).toBe(
      'could not resolve a datasource for the reference SQL',
    );
  });

  it('hands the comparator the parsed JSON answer and the run details', async () => {
    rows({ n: 3 });
    const compare = jest.fn(() => undefined);
    const custom = sqlTruthCheck({
      id: 'x',
      description: 'x',
      sql: 'SELECT 3 AS n',
      compare,
    });
    const details = { steps: { plan: { entities: [] } } };
    await custom.run(input('{"a": 1}', details));
    expect(compare).toHaveBeenCalledWith([{ n: 3 }], {
      answer: '{"a": 1}',
      parsed: { a: 1 },
      details,
    });
    await custom.run(input('not json'));
    expect(compare).toHaveBeenLastCalledWith([{ n: 3 }], {
      answer: 'not json',
      parsed: undefined,
      details: {},
    });
  });
});

describe('answerHasNumber', () => {
  it('reads the first column of the first row by default, within a tolerance', () => {
    const compare = answerHasNumber(undefined, { tolerance: 0.05 });
    const truth = [{ share: '12.34' }];
    expect(
      compare(truth, { answer: 'about 12.3%', parsed: undefined, details: {} }),
    ).toBeUndefined();
    expect(
      compare(truth, { answer: 'about 13%', parsed: undefined, details: {} }),
    ).toContain('expected the answer to state 12.34');
  });

  it('takes a picker over the rows, and fails when the SQL gives no number', () => {
    const sum = answerHasNumber((all) =>
      all.reduce((total, row) => total + Number(row['n']), 0),
    );
    expect(
      sum([{ n: 2 }, { n: 3 }], {
        answer: '5 in all',
        parsed: undefined,
        details: {},
      }),
    ).toBeUndefined();
    expect(
      answerHasNumber('n')([], { answer: '5', parsed: undefined, details: {} }),
    ).toBe('the reference SQL gave no number for n');
  });
});

describe('jsonFieldEquals', () => {
  it('compares a field of the JSON answer with the SQL value', () => {
    const compare = jsonFieldEquals('report.overallScore', 'score');
    const truth = [{ score: 71 }];
    expect(
      compare(truth, {
        answer: '',
        parsed: { report: { overallScore: 71 } },
        details: {},
      }),
    ).toBeUndefined();
    expect(
      compare(truth, {
        answer: '',
        parsed: { report: { overallScore: 70 } },
        details: {},
      }),
    ).toBe('report.overallScore is 70; the reference SQL gives 71');
  });

  it('compares text without case or surrounding spaces, and reads array indexes', () => {
    const compare = jsonFieldEquals('entities.0', 'name');
    const truth = [{ name: 'edge_cases.Orders' }];
    expect(
      compare(truth, {
        answer: '',
        parsed: { entities: [' EDGE_CASES.orders '] },
        details: {},
      }),
    ).toBeUndefined();
    expect(
      compare(truth, { answer: 'x', parsed: undefined, details: {} }),
    ).toBe('the answer is not JSON with entities.0');
  });
});

describe('answerMentionsAll', () => {
  it('passes when every value of the column is in the answer', () => {
    const compare = answerMentionsAll('category');
    const truth = [{ category: 'Électronique' }, { category: 'Toys' }];
    expect(
      compare(truth, {
        answer: 'Top: electronique and toys.',
        parsed: undefined,
        details: {},
      }),
    ).toBeUndefined();
    expect(
      compare(truth, { answer: 'Top: toys.', parsed: undefined, details: {} }),
    ).toBe(
      'the answer does not mention Électronique (category from the reference SQL)',
    );
  });

  it('fails when the reference SQL returns no row', () => {
    expect(
      answerMentionsAll('category')([], {
        answer: 'x',
        parsed: undefined,
        details: {},
      }),
    ).toBe('the reference SQL returned no row');
  });
});
