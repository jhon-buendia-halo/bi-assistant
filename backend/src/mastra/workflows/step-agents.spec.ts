/**
 * Write answer's model call (agents.md 5.11; plan 1.25.6): the answer's row
 * markers are expanded into tables from the stored rows, in the stored
 * answer and in the streamed text, and never reach a reader. The agents are
 * stubbed: Jest cannot load Mastra's ESM.
 */
const stream = jest.fn<Promise<unknown>, unknown[]>();
const generate = jest.fn<Promise<unknown>, unknown[]>();
jest.mock('../agents/answer-writer.agent', () => ({
  answerWriterAgent: { stream: (...args: unknown[]) => stream(...args) },
}));
jest.mock('../agents/analysis-planner.agent', () => ({
  analysisPlannerAgent: {
    generate: (...args: unknown[]) => generate(...args),
  },
}));

import {
  ANSWER_CUT_NOTE,
  planWithModel,
  writeAnswerWithModel,
} from './step-agents';
import { ModelTimeoutError, ReplyCutError } from './model-call';
import { findingStatus, writeAnswerRequest } from './analysis.prompts';
import type { AnalyseQuery, AnalysisPlan } from './analysis.steps';

const PLAN: AnalysisPlan = {
  question: 'Which 100 drivers have the most race starts?',
  measures: ['race starts'],
  entities: ['f1.drivers'],
  scope: 'All seasons.',
  assumptions: [],
  needsClarification: false,
  clarification: null,
};

const rows = Array.from({ length: 102 }, (_, i) => ({
  name: `Driver ${i + 1}`,
  total_race_starts: 400 - i,
}));
const QUERY: AnalyseQuery = {
  sql: 'SELECT name, total_race_starts FROM drivers ORDER BY 2 DESC LIMIT 102',
  rationale: 'I rank the drivers by race starts.',
  rows,
  rowCount: 102,
  truncated: false,
};

/** A model reply streamed as partial objects, a few characters at a time. */
function reply(answer: string, headline: string) {
  const partials: { headline: string; answer: string }[] = [];
  for (let i = 3; i < answer.length; i += 3) {
    partials.push({ headline, answer: answer.slice(0, i) });
  }
  return {
    objectStream: (async function* () {
      for (const partial of partials) yield await Promise.resolve(partial);
    })(),
    object: Promise.resolve({ headline, answer }),
    text: Promise.resolve(JSON.stringify({ headline, answer })),
    error: undefined,
  };
}

describe('writeAnswerWithModel (plan 1.25.6)', () => {
  beforeEach(() => stream.mockReset());

  it('stores the answer with its marker expanded, and never streams a marker', async () => {
    stream.mockResolvedValue(
      reply(
        'Lewis Hamilton leads with 400 starts.\n\n[[rows:1 | name=Driver, total_race_starts=Race starts]]\n\nThe list covers every season.',
        'Lewis Hamilton leads with 400 starts.',
      ),
    );
    const deltas: string[] = [];
    const { answer } = await writeAnswerWithModel(
      { question: PLAN.question, plan: PLAN, queries: [QUERY], findings: [] },
      { onText: (delta) => deltas.push(delta) },
    );
    expect(answer.headline).toBe('Lewis Hamilton leads with 400 starts.');
    expect(answer.answer).not.toContain('[[');
    expect(answer.answer).toContain('| Driver | Race starts |');
    expect(answer.answer).toContain('| Driver 102 | 299 |');
    expect(answer.answer.endsWith('The list covers every season.')).toBe(true);
    expect(deltas.join('')).toBe(answer.answer);
    expect(deltas.some((delta) => delta.includes('[['))).toBe(false);
  });

  it('removes a marker it cannot expand', async () => {
    stream.mockResolvedValue(reply('Nothing to list.\n[[rows:7]]', 'Nothing.'));
    const { answer } = await writeAnswerWithModel(
      { question: PLAN.question, plan: PLAN, queries: [QUERY], findings: [] },
      {},
    );
    expect(answer.answer).toBe('Nothing to list.');
  });
});

// What the model receives.
describe('the requests of Plan and Write answer', () => {
  const INPUT = {
    question: PLAN.question,
    plan: PLAN,
    queries: [QUERY],
    findings: [],
  };

  beforeEach(() => {
    stream.mockReset();
    generate.mockReset();
  });

  it("sends Write answer's request", async () => {
    stream.mockResolvedValue(reply('Lewis leads.', 'Lewis leads.'));
    await writeAnswerWithModel(INPUT, {});
    expect(stream.mock.calls[0][0]).toBe(writeAnswerRequest(INPUT));
  });

  it("sends Plan's request: the question, then the catalog", async () => {
    generate.mockResolvedValue({ object: PLAN, text: JSON.stringify(PLAN) });
    await planWithModel(
      { messages: 'Q', question: 'Q', catalogBlock: 'CAT' },
      {},
    );
    expect(generate.mock.calls.map((call) => call[0])).toEqual([
      'Question: Q\n\nCAT',
    ]);
  });
});

// The guarded calls (workflows R43): a deadline, one retry of a transient
// failure or a cut reply, and Write answer's rule once text was shown.
describe('Plan and Write answer under the guarded call (workflows R43)', () => {
  const INPUT = {
    question: PLAN.question,
    plan: PLAN,
    queries: [QUERY],
    findings: [],
  };
  const PLAN_INPUT = { messages: 'Q', question: 'Q', catalogBlock: 'CAT' };
  const reset = () =>
    new TypeError('fetch failed', {
      cause: Object.assign(new Error('read ECONNRESET'), {
        code: 'ECONNRESET',
      }),
    });
  /** A reply streamed as `reply` does, its finish reason given. */
  const finished = (answer: string, finishReason: string) => ({
    ...reply(answer, 'Headline.'),
    finishReason: Promise.resolve(finishReason),
  });
  /** A stream that shows `shown`, then fails. */
  const failsAfter = (shown: string, error: Error) => ({
    objectStream: (async function* () {
      if (shown) yield await Promise.resolve({ answer: shown });
      throw error;
    })(),
    object: Promise.resolve(undefined),
    text: Promise.resolve(''),
    error: undefined,
  });

  beforeEach(() => {
    jest.useFakeTimers();
    stream.mockReset();
    generate.mockReset();
  });
  afterEach(() => jest.useRealTimers());

  it('retries Plan once after a reset, with the same request, and reports one line', async () => {
    generate
      .mockRejectedValueOnce(reset())
      .mockResolvedValueOnce({ object: PLAN, text: JSON.stringify(PLAN) });
    const lines: string[] = [];
    const pending = planWithModel(PLAN_INPUT, {
      onRetry: (line) => lines.push(line),
    });
    await jest.advanceTimersByTimeAsync(2_000);
    const { plan, stopped } = await pending;
    expect(stopped).toBe(false);
    expect(plan.question).toBe(PLAN.question);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate.mock.calls[1][0]).toEqual(generate.mock.calls[0][0]);
    expect(lines).toEqual([
      'Plan: the model call failed (fetch failed). Trying once more in 2 seconds.',
    ]);
  });

  it('fails Plan with ReplyCutError when its reply is cut twice', async () => {
    generate.mockResolvedValue({
      object: undefined,
      text: '{"question": "Which',
      finishReason: 'length',
    });
    const pending = planWithModel(PLAN_INPUT, {}).catch(
      (error: Error) => error,
    );
    await jest.advanceTimersByTimeAsync(2_000);
    const error = await pending;
    expect(error).toBeInstanceOf(ReplyCutError);
    expect((error as Error).message).toContain('Plan failed');
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it('fails Plan with ModelTimeoutError past five minutes, aborting the call', async () => {
    let signal: AbortSignal | undefined;
    generate.mockImplementation((_messages, options) => {
      signal = (options as { abortSignal?: AbortSignal }).abortSignal;
      return new Promise(() => undefined);
    });
    const run = new AbortController();
    const pending = planWithModel(PLAN_INPUT, {
      abortSignal: run.signal,
    }).catch((error: Error) => error);
    await jest.advanceTimersByTimeAsync(5 * 60_000);
    expect(await pending).toBeInstanceOf(ModelTimeoutError);
    expect(signal).not.toBe(run.signal);
    expect(signal?.aborted).toBe(true);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('a Stop of Plan is a stop, not a timeout', async () => {
    const run = new AbortController();
    generate.mockImplementation(() => {
      run.abort();
      return Promise.reject(new Error('aborted'));
    });
    await expect(
      planWithModel(PLAN_INPUT, { abortSignal: run.signal }),
    ).resolves.toMatchObject({ stopped: true });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('retries Write answer while nothing was shown', async () => {
    stream
      .mockResolvedValueOnce(failsAfter('', reset()))
      .mockResolvedValueOnce(reply('Lewis leads.', 'Lewis leads.'));
    const deltas: string[] = [];
    const pending = writeAnswerWithModel(INPUT, {
      onText: (delta) => deltas.push(delta),
    });
    await jest.advanceTimersByTimeAsync(2_000);
    const { answer } = await pending;
    expect(answer.answer).toBe('Lewis leads.');
    expect(deltas.join('')).toBe('Lewis leads.');
    expect(stream).toHaveBeenCalledTimes(2);
  });

  it('does not retry Write answer once text was shown', async () => {
    stream.mockResolvedValueOnce(failsAfter('Lewis\n', reset()));
    await expect(
      writeAnswerWithModel(INPUT, { onText: () => undefined }),
    ).rejects.toThrow('fetch failed');
    expect(stream).toHaveBeenCalledTimes(1);
  });

  it('keeps the text shown when the reply is cut after it, with a note, and succeeds', async () => {
    stream.mockResolvedValueOnce(
      finished('Lewis Hamilton leads.\nThen come', 'length'),
    );
    const deltas: string[] = [];
    const { answer, stopped } = await writeAnswerWithModel(INPUT, {
      onText: (delta) => deltas.push(delta),
    });
    expect(stopped).toBe(false);
    expect(answer.answer.startsWith('Lewis Hamilton leads.\nThen')).toBe(true);
    expect(answer.answer.endsWith(`\n\n${ANSWER_CUT_NOTE}`)).toBe(true);
    expect(answer.headline).toBe('Headline.');
    expect(ANSWER_CUT_NOTE).toBe('The answer was cut at the output limit.');
    expect(deltas.join('')).toBe(answer.answer);
    expect(stream).toHaveBeenCalledTimes(1);
  });

  // The note streams as the stored answer carries it: the shown text is
  // kept as it is, whatever whitespace it ends or starts with.
  it.each([
    ['a row marker and a blank line', 'Intro\n[[rows:1]]\n\n'],
    ['trailing spaces', 'Line one.  \nLine two.  \n'],
    ['a leading newline', '\nLewis leads.\n'],
  ])(
    'streams the note after a cut reply whose shown text ends in %s',
    async (_case, shown) => {
      stream.mockResolvedValueOnce({
        objectStream: (async function* () {
          yield await Promise.resolve({ headline: 'H.', answer: shown });
        })(),
        object: Promise.resolve(undefined),
        text: Promise.resolve(JSON.stringify({ answer: shown })),
        error: undefined,
        finishReason: Promise.resolve('length'),
      });
      const deltas: string[] = [];
      const { answer } = await writeAnswerWithModel(INPUT, {
        onText: (delta) => deltas.push(delta),
      });
      expect(deltas.join('')).toBe(answer.answer);
      expect(answer.answer.endsWith(`\n\n${ANSWER_CUT_NOTE}`)).toBe(true);
      expect(deltas.at(-1)).toContain(ANSWER_CUT_NOTE);
    },
  );

  it('shows nothing more and records no exchange once Write answer timed out', async () => {
    const onExchange = jest.fn();
    stream.mockImplementationOnce((_request, options) => {
      const signal = (options as { abortSignal: AbortSignal }).abortSignal;
      const aborted = new Promise<void>((resolve) =>
        signal.addEventListener('abort', () => resolve()),
      );
      const full = 'Lewis leads.\nThen Michael.\n';
      // Mastra ends an aborted stream: the rest of the partial resolves.
      return Promise.resolve({
        objectStream: (async function* () {
          yield await Promise.resolve({ answer: 'Lewis leads.\n' });
          await aborted;
          yield { answer: full };
        })(),
        object: aborted.then(() => ({ headline: 'H.', answer: full })),
        text: aborted.then(() => JSON.stringify({ answer: full })),
        error: undefined,
        finishReason: aborted.then(() => 'stop'),
      });
    });
    const deltas: string[] = [];
    const pending = writeAnswerWithModel(INPUT, {
      abortSignal: new AbortController().signal,
      onText: (delta) => deltas.push(delta),
      onExchange,
    }).catch((error: Error) => error);
    await jest.advanceTimersByTimeAsync(5 * 60_000);
    expect(await pending).toBeInstanceOf(ModelTimeoutError);
    await jest.advanceTimersByTimeAsync(1_000);
    expect(deltas.join('')).toBe('Lewis leads.\n');
    expect(onExchange).not.toHaveBeenCalled();
    expect(stream).toHaveBeenCalledTimes(1);
  });

  it('records no Plan exchange once Plan timed out, though the call then resolves', async () => {
    const onExchange = jest.fn();
    generate.mockImplementationOnce((_messages, options) => {
      const signal = (options as { abortSignal: AbortSignal }).abortSignal;
      return new Promise((resolve) =>
        signal.addEventListener('abort', () =>
          resolve({ object: PLAN, text: JSON.stringify(PLAN) }),
        ),
      );
    });
    const pending = planWithModel(PLAN_INPUT, {
      abortSignal: new AbortController().signal,
      onExchange,
    }).catch((error: Error) => error);
    await jest.advanceTimersByTimeAsync(5 * 60_000);
    expect(await pending).toBeInstanceOf(ModelTimeoutError);
    await jest.advanceTimersByTimeAsync(1_000);
    expect(onExchange).not.toHaveBeenCalled();
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('retries a cut reply when nothing was shown, and fails when it is cut again', async () => {
    stream.mockImplementation(() =>
      Promise.resolve(finished('{"answer": "Lewis', 'length')),
    );
    const pending = writeAnswerWithModel(INPUT, {}).catch(
      (error: Error) => error,
    );
    await jest.advanceTimersByTimeAsync(2_000);
    expect(await pending).toBeInstanceOf(ReplyCutError);
    expect(stream).toHaveBeenCalledTimes(2);
  });
});

describe('the findings as the writer reads them (roadmap 1.29.8, issue D)', () => {
  it('reads a warning-only check that did not pass as a warning, never as failed', () => {
    expect(findingStatus({ passed: true, check: 'Ran a query' })).toBe(
      'passed',
    );
    expect(findingStatus({ passed: false, check: 'Ran a query' })).toBe(
      'failed',
    );
    expect(
      findingStatus({
        passed: false,
        check: 'Measures covered (warning only)',
      }),
    ).toBe('warning');
  });

  it('writes the warning into the request with its status', () => {
    const request = writeAnswerRequest({
      question: 'How many orders were delivered?',
      plan: {
        question: 'How many orders were delivered?',
        measures: ['delivered orders'],
        entities: ['orders'],
        scope: 'all',
        assumptions: [],
        needsClarification: false,
        clarification: null,
      },
      queries: [],
      findings: [
        {
          check: 'Measures covered (warning only)',
          passed: false,
          detail: 'No query names "delivery rate".',
        },
        { check: 'Ran a query', passed: false, detail: 'No SQL query ran.' },
      ],
    });
    expect(request).toContain('- warning: Measures covered (warning only).');
    expect(request).toContain('- failed: Ran a query.');
  });
});
