import {
  actionIs,
  explorerAnswerText,
  filtersAre,
  pageIs,
  queryIs,
  refusesWhatNoColumnHolds,
  replyIsAView,
  sameFilterSet,
  sortIs,
} from './result-explorer-eval-checks';
import type { EvalCustomCheck } from './assistant.evals';

const run = (check: EvalCustomCheck, answer: string) =>
  check.run({ answer, toolCalls: [], datasets: [], vars: {} });

/** What `specOf` makes of a right reply to "only Brazil" over Q2. */
const brazil = explorerAnswerText({
  action: 'explore',
  query: 1,
  interpretation: {
    request: {
      page: 1,
      filters: [{ column: 'country', op: 'eq', value: 'brazil' }],
      sort: [{ column: 'goals', direction: 'desc' }],
    },
    understood: 'Country is Brazil · sorted by goals, high to low',
  },
});

describe('result-explorer eval checks (agents.md 8.1, 2.16)', () => {
  it('reply-is-a-view passes on a view and fails on text or no action', async () => {
    expect(await run(replyIsAView(), brazil)).toBeUndefined();
    expect(await run(replyIsAView(), 'sorry')).toMatch(/not a JSON/);
    expect(await run(replyIsAView(), '{"page":1}')).toMatch(/no action/);
  });

  it('action fails on a missed new-question', async () => {
    expect(await run(actionIs('explore'), brazil)).toBeUndefined();
    expect(await run(actionIs('new-question'), brazil)).toMatch(
      /Expected action new-question, got explore/,
    );
  });

  it('query fails on the wrong candidate', async () => {
    expect(await run(queryIs(1), brazil)).toBeUndefined();
    expect(await run(queryIs(0), brazil)).toMatch(/Expected Q1, got Q2/);
  });

  it('filters match column, op and value, text without case', async () => {
    const right = [[{ column: 'country', op: 'eq', value: 'Brazil' } as const]];
    expect(await run(filtersAre(right), brazil)).toBeUndefined();
    const wrongColumn = [
      [{ column: 'player', op: 'eq', value: 'Brazil' } as const],
    ];
    expect(await run(filtersAre(wrongColumn), brazil)).toMatch(
      /Expected filters/,
    );
    const wrongOp = [
      [{ column: 'country', op: 'contains', value: 'Brazil' } as const],
    ];
    expect(await run(filtersAre(wrongOp), brazil)).toMatch(
      /got country eq brazil/,
    );
    const wrongValue = [
      [{ column: 'country', op: 'eq', value: 'France' } as const],
    ];
    expect(await run(filtersAre(wrongValue), brazil)).toMatch(
      /Expected filters/,
    );
  });

  it('filters accept any acceptable set, in any order, and none when empty', async () => {
    const a = { column: 'a', op: 'gt', value: 3 } as const;
    const b = { column: 'b', op: 'lt', value: 9 } as const;
    expect(sameFilterSet([b, a], [a, b])).toBe(true);
    expect(sameFilterSet([a], [a, b])).toBe(false);
    const none = explorerAnswerText({
      action: 'explore',
      query: 0,
      interpretation: { request: { page: 1 }, understood: 'All rows' },
    });
    expect(await run(filtersAre([[]]), none)).toBeUndefined();
    expect(await run(filtersAre([[a]]), none)).toMatch(/got none/);
  });

  it('sort and page fail on a wrong key, direction or page', async () => {
    expect(
      await run(sortIs([{ column: 'goals', direction: 'desc' }]), brazil),
    ).toBeUndefined();
    expect(
      await run(sortIs([{ column: 'goals', direction: 'asc' }]), brazil),
    ).toMatch(/Expected sort goals asc; got goals desc/);
    expect(await run(sortIs([]), brazil)).toMatch(/got goals desc/);
    expect(await run(pageIs(1), brazil)).toBeUndefined();
    expect(await run(pageIs(2), brazil)).toMatch(/Expected page 2; got 1/);
  });

  it('refuses-what-no-column-holds passes on a new question or a rejected part only', async () => {
    const newQuestion = explorerAnswerText({
      action: 'new-question',
      query: 0,
      interpretation: { request: { page: 1 }, understood: 'x' },
    });
    const rejected = explorerAnswerText({
      action: 'explore',
      query: 0,
      interpretation: {
        request: { page: 1 },
        understood: 'x',
        rejected: ['Continent is Europe'],
      },
    });
    expect(await run(refusesWhatNoColumnHolds(), newQuestion)).toBeUndefined();
    expect(await run(refusesWhatNoColumnHolds(), rejected)).toBeUndefined();
    expect(await run(refusesWhatNoColumnHolds(), brazil)).toMatch(
      /nothing was refused/,
    );
  });
});
