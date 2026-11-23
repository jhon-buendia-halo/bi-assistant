import {
  APPROVE_OPTION,
  CLARIFY_BLOCK,
  clarificationIn,
  interactiveBlocks,
  interactiveStep,
  isApproval,
  reviewOf,
  reviewQuestion,
} from './answer-business-question.review';
import { analysisReview, planReview } from './analysis.prompts';

describe("Answer a Business Question's interactive runs (workflows R44)", () => {
  it('approves on Approve and its usual words, and reads anything else as changes', () => {
    for (const answer of [
      'Approve',
      'approved',
      ' OK ',
      'yes',
      'Sí',
      'LGTM.',
    ]) {
      expect(isApproval(answer)).toBe(true);
    }
    for (const answer of ['Use 2022 only', 'approve but by year', '', 'no']) {
      expect(isApproval(answer)).toBe(false);
    }
  });

  it('names whose outcome waits and who gets it next', () => {
    expect(reviewQuestion('Olivia', 'plan', 'Michael')).toBe(
      "Olivia's plan is ready. Approve it to hand it to Michael, or write what to change.",
    );
  });

  it('reads a clarifying question from a reply, as JSON text or an object', () => {
    expect(
      clarificationIn(
        'Sure. {"clarification": {"question": "Which year?", "options": ["2018", " 2022 ", 3]}}',
      ),
    ).toEqual({ question: 'Which year?', options: ['2018', '2022'] });
    expect(
      clarificationIn({ clarification: { question: ' Which? ', options: [] } }),
    ).toEqual({ question: 'Which?', options: [] });
    expect(clarificationIn('{"headline": "16 matches"}')).toBeUndefined();
    expect(clarificationIn('no json')).toBeUndefined();
    expect(
      clarificationIn({ clarification: { question: '' } }),
    ).toBeUndefined();
  });

  it('ends a request with the clarify rule, the answered question or the revision, and nothing otherwise', () => {
    expect(interactiveBlocks({})).toEqual([]);
    expect(interactiveBlocks({ canAsk: true })).toEqual([CLARIFY_BLOCK]);
    const answered = interactiveBlocks({
      canAsk: true,
      answered: { question: 'Which year?', answer: '2022' },
    });
    expect(answered).toHaveLength(1);
    expect(answered[0]).toContain('They answered: 2022');
    const revised = interactiveBlocks({
      revision: { previous: 'Notes A', note: 'Mention the legend' },
    });
    expect(revised[0]).toContain('Your earlier reply:\nNotes A');
    expect(revised[0]).toContain('What the user asked: Mention the legend');
  });

  it('reads a held gate back from the suspend data, and nothing from a question', () => {
    expect(
      reviewOf({
        kind: 'review',
        question: 'Q',
        options: [APPROVE_OPTION],
        review: 'R',
        outcome: { a: 1 },
        reply: 'P',
      }),
    ).toEqual({
      kind: 'review',
      question: 'Q',
      options: [APPROVE_OPTION],
      review: 'R',
      outcome: { a: 1 },
      reply: 'P',
    });
    expect(reviewOf({ question: 'Q', options: [] })).toBeUndefined();
    expect(reviewOf({ kind: 'review', question: 'Q' })).toBeUndefined();
  });

  describe('interactiveStep', () => {
    const suspend = jest.fn((payload: Record<string, unknown>) => ({
      suspended: payload,
    }));
    beforeEach(() => suspend.mockClear());
    const gate = () => ({ question: 'Approve?', review: 'The outcome' });

    it('is the call alone when the run is not interactive', async () => {
      const run = jest.fn(() =>
        Promise.resolve({ output: { n: 1 }, reply: 'r' }),
      );
      await expect(
        interactiveStep({ suspend }, false, { run, gate }),
      ).resolves.toEqual({ type: 'output', output: { n: 1 }, approved: false });
      expect(run).toHaveBeenCalledWith({ canAsk: false });
      expect(suspend).not.toHaveBeenCalled();
    });

    it('waits on the gate with the outcome, and passes it on unchanged once approved', async () => {
      const run = jest.fn(() =>
        Promise.resolve({ output: { n: 1 }, reply: 'r' }),
      );
      const waited = await interactiveStep({ suspend }, true, { run, gate });
      expect(waited.type).toBe('suspended');
      const payload = suspend.mock.calls[0][0];
      expect(payload).toEqual({
        kind: 'review',
        question: 'Approve?',
        options: ['Approve'],
        review: 'The outcome',
        outcome: { n: 1 },
        reply: 'r',
      });
      await expect(
        interactiveStep(
          { suspend, suspendData: payload, resumeData: { answer: 'Approve' } },
          true,
          { run, gate },
        ),
      ).resolves.toEqual({ type: 'output', output: { n: 1 }, approved: true });
      expect(run).toHaveBeenCalledTimes(1);
    });

    it("calls the agent again with its reply and the user's words on a revision", async () => {
      const run = jest.fn(() =>
        Promise.resolve({ output: { n: 2 }, reply: 'r2' }),
      );
      await interactiveStep(
        {
          suspend,
          suspendData: {
            kind: 'review',
            question: 'Approve?',
            options: ['Approve'],
            review: 'x',
            outcome: { n: 1 },
            reply: 'r1',
          },
          resumeData: { answer: 'Use 2022' },
        },
        true,
        { run, gate },
      );
      expect(run).toHaveBeenCalledWith({
        canAsk: false,
        revision: { previous: 'r1', note: 'Use 2022' },
      });
      expect(suspend.mock.calls[0][0]).toMatchObject({ outcome: { n: 2 } });
    });

    it('asks first when the agent asks, then calls it again with the answer', async () => {
      const run = jest
        .fn()
        .mockResolvedValueOnce({
          output: {},
          reply: '',
          clarification: { question: 'Which?', options: ['A', 'B'] },
        })
        .mockResolvedValueOnce({ output: { n: 1 }, reply: 'r' });
      await interactiveStep({ suspend }, true, { run });
      expect(suspend.mock.calls[0][0]).toEqual({
        kind: 'clarify',
        question: 'Which?',
        options: ['A', 'B'],
      });
      const ended = await interactiveStep(
        {
          suspend,
          suspendData: suspend.mock.calls[0][0],
          resumeData: { answer: 'A' },
        },
        true,
        { run },
      );
      expect(run).toHaveBeenLastCalledWith({
        canAsk: false,
        answered: { question: 'Which?', answer: 'A' },
      });
      // No gate: the outcome goes on.
      expect(ended).toEqual({
        type: 'output',
        output: { n: 1 },
        approved: false,
      });
    });

    it('never waits on a stopped call', async () => {
      const run = jest.fn(() =>
        Promise.resolve({ output: { n: 1 }, reply: 'r', stopped: true }),
      );
      await expect(
        interactiveStep({ suspend }, true, { run, gate }),
      ).resolves.toMatchObject({ type: 'output' });
      expect(suspend).not.toHaveBeenCalled();
    });
  });

  it("writes Olivia's plan and Michael's analysis in the user's words", () => {
    expect(
      planReview({
        question: 'How many matches?',
        measures: ['match count'],
        entities: ['matches'],
        scope: '',
        assumptions: [],
        needsClarification: false,
        clarification: null,
      }),
    ).toBe(
      [
        '**Question:** How many matches?',
        '',
        '**Measures**',
        '- match count',
        '',
        '**Entities**',
        '- matches',
        '',
        '**Scope:** none given',
        '',
        '**Assumptions**',
        '- none',
      ].join('\n'),
    );
    expect(
      analysisReview({
        queries: [
          {
            sql: 'SELECT 1',
            rationale: 'Count them.',
            rows: [],
            rowCount: 1264,
            truncated: true,
          },
          {
            sql: 'SELECT x',
            rows: [],
            rowCount: 0,
            truncated: false,
            error: 'bad',
          },
        ],
        text: 'Done.',
      }),
    ).toBe(
      [
        '**Queries run:** 2',
        '1. Count them. (1,264 rows, cut at its row limit)',
        '2. A query (failed: bad)',
        '',
        '**His note**',
        'Done.',
      ].join('\n'),
    );
  });
});
