import {
  answerHasFigure,
  answersWithoutClarifying,
} from './insights-analyst-retail-checks';

const ctx = (answer: string) =>
  ({ answer, parsed: undefined, details: undefined }) as never;

async function run(answer: string, toolNames: string[] = []) {
  return answersWithoutClarifying().run({
    answer,
    toolCalls: toolNames.map((name) => ({
      name,
      input: {},
      output: {},
      failed: false,
    })),
    datasets: ['Retail Ops'],
    vars: {},
  });
}

describe('answersWithoutClarifying', () => {
  it('passes a real answer', async () => {
    expect(
      await run(
        'Net revenue in 2024 was $4,628,067.63.\n\nIt covers completed orders.',
      ),
    ).toBeUndefined();
    // A question with no options is no clarification.
    expect(await run('Do you want more detail?')).toBeUndefined();
  });

  it('fails a clarifying question', async () => {
    const asked =
      'Which measure should define the best store?\n- Net revenue\n- Orders\n- Target attainment';
    expect(await run(asked)).toBe(
      'the run ended on a clarifying question: "Which measure should define the best store?"',
    );
  });

  it('fails a run that called ask_clarification', async () => {
    expect(await run('Net revenue was 5.', ['ask_clarification'])).toContain(
      'ask_clarification',
    );
  });
});

describe('answerHasFigure', () => {
  const rows = [{ net: '3041220.55' }];
  const check = (
    answer: string,
    options?: { relative?: number; absolute?: number },
  ) => answerHasFigure('net', options)(rows, ctx(answer));

  it('reads the figure written in full, scaled or in thousands', () => {
    expect(check('Net revenue was $3,041,220.55.')).toBeUndefined();
    expect(check('Net revenue was $3.04 million.')).toBeUndefined();
    expect(check('Net revenue was 3.04M.')).toBeUndefined();
    expect(check('Net revenue was $3,041k.')).toBeUndefined();
    expect(check('Net revenue was 3.04 mm.')).toBeUndefined();
  });

  it('does not read a month as a million', () => {
    expect(check('3.04 months of stock')).toContain(
      'expected the answer to state about 3041220.55',
    );
    expect(check('over 5 months')).toBeDefined();
  });

  it('fails a value outside 1%', () => {
    expect(check('Net revenue was $3.0 million.')).toBeDefined();
    expect(check('Net revenue was $3,100,000.')).toBeDefined();
  });

  it('honours relative and absolute options', () => {
    expect(
      check('Net revenue was $3.0 million.', { relative: 0.02 }),
    ).toBeUndefined();
    // 0.4% accepts 3,030,000 (0.37% off) but not 3,020,000 (0.7% off).
    expect(check('It was 3,030,000.', { relative: 0.004 })).toBeUndefined();
    expect(check('It was 3,020,000.', { relative: 0.004 })).toBeDefined();
    expect(check('It was 3,041,000.', { absolute: 1000 })).toBeUndefined();
  });

  it('names a missing reference value', () => {
    expect(answerHasFigure('net')([{ net: null }], ctx('x'))).toBe(
      'the reference SQL gave no number for net',
    );
  });
});
