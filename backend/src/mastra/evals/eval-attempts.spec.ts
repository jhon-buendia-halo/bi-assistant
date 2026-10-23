import {
  costUsdOf,
  foldAttempts,
  runCaseAttempts,
  sumCostUsd,
} from './eval-attempts';
import type { AssistantEvalCaseResult } from './assistant.evals';
import type { EvalStatus } from './eval-summary';
import type { ModelUsageEntry } from './eval-usage';

/** The assistant's tokens on gpt-4o-mini for one call. */
function usage(inputTokens: number, outputTokens: number): ModelUsageEntry[] {
  return [
    {
      agent: 'assistant',
      model: 'gpt-4o-mini',
      inputTokens,
      cachedInputTokens: 0,
      outputTokens,
      reasoningTokens: 0,
      calls: 1,
      unreportedCalls: 0,
    },
  ];
}

/** One attempt as `runAssistantEvalCase` returns it. */
function attempt(
  status: EvalStatus,
  overrides: Partial<AssistantEvalCaseResult> = {},
): AssistantEvalCaseResult {
  return {
    id: 'shot-conversion-2022',
    question: 'What share of shots were converted in 2022?',
    category: 'ratio',
    split: 'held-out',
    scores: { 'check-includes': status === 'passed' ? 1 : 0 },
    checkResults: [
      {
        id: 'check-includes',
        description: 'Checks if output includes "11%"',
        score: status === 'passed' ? 1 : 0,
        passed: status === 'passed',
        status: status === 'not-scored' ? 'not-scored' : status,
      },
    ],
    answer: `answer (${status})`,
    toolCalls: [],
    status,
    passed: status === 'passed',
    durationMs: 100,
    passes: status === 'passed' ? 1 : 0,
    runs: 1,
    flaky: false,
    usage: usage(1_000_000, 0),
    costUsd: 0.15,
    ...overrides,
  };
}

describe('foldAttempts (agents-evals R211)', () => {
  it('passes a question only when every attempt passed', () => {
    const folded = foldAttempts([
      attempt('passed'),
      attempt('passed'),
      attempt('passed'),
    ]);
    expect(folded).toMatchObject({
      status: 'passed',
      passed: true,
      passes: 3,
      runs: 3,
      flaky: false,
    });
    expect(folded.attempts?.map((each) => each.attempt)).toEqual([1, 2, 3]);
  });

  it('fails a question that passed 2 of 3 attempts, flaky, showing the failed attempt', () => {
    const folded = foldAttempts([
      attempt('passed', { durationMs: 10 }),
      attempt('failed', { durationMs: 20, answer: 'the wrong share' }),
      attempt('passed', { durationMs: 30 }),
    ]);
    expect(folded).toMatchObject({
      status: 'failed',
      passed: false,
      passes: 2,
      runs: 3,
      flaky: true,
      // The representative attempt: the first failed one.
      answer: 'the wrong share',
      durationMs: 20,
      split: 'held-out',
      category: 'ratio',
    });
    expect(folded.checkResults[0].status).toBe('failed');
    expect(folded.attempts?.map((each) => each.status)).toEqual([
      'passed',
      'failed',
      'passed',
    ]);
  });

  it('does not score a question none of whose attempts was scored', () => {
    const folded = foldAttempts([
      attempt('not-scored'),
      attempt('not-scored'),
      attempt('not-scored'),
    ]);
    expect(folded).toMatchObject({
      status: 'not-scored',
      passed: false,
      passes: 0,
      flaky: false,
    });
  });

  it('fails every attempt failed, not flaky, with the first as representative', () => {
    const folded = foldAttempts([
      attempt('failed', { answer: 'first' }),
      attempt('failed', { answer: 'second' }),
      attempt('failed', { answer: 'third' }),
    ]);
    expect(folded).toMatchObject({
      status: 'failed',
      passes: 0,
      flaky: false,
      answer: 'first',
    });
  });

  it('shows the first attempt when none failed', () => {
    const folded = foldAttempts([
      attempt('passed', { answer: 'first' }),
      attempt('passed', { answer: 'second' }),
    ]);
    expect(folded.answer).toBe('first');
  });

  it('keeps one attempt as the result itself, with no attempts list', () => {
    const folded = foldAttempts([attempt('passed')]);
    expect(folded).toMatchObject({ passes: 1, runs: 1, flaky: false });
    expect(folded).not.toHaveProperty('attempts');
  });

  it('sums usage and cost over the attempts and keeps those of each attempt', () => {
    const folded = foldAttempts([
      attempt('passed', { usage: usage(1_000_000, 0), costUsd: 0.15 }),
      attempt('passed', { usage: usage(0, 1_000_000), costUsd: 0.6 }),
    ]);
    expect(folded.usage).toEqual([
      {
        agent: 'assistant',
        model: 'gpt-4o-mini',
        inputTokens: 1_000_000,
        cachedInputTokens: 0,
        outputTokens: 1_000_000,
        reasoningTokens: 0,
        calls: 2,
        unreportedCalls: 0,
      },
    ]);
    expect(folded.costUsd).toBe(0.75);
    expect(folded.attempts?.map((each) => each.costUsd)).toEqual([0.15, 0.6]);
    expect(folded.attempts?.[1].usage).toEqual(usage(0, 1_000_000));
  });

  it('is not priced when any attempt is not priced', () => {
    const folded = foldAttempts([
      attempt('passed'),
      attempt('passed', { costUsd: null }),
    ]);
    expect(folded.costUsd).toBeNull();
  });

  it('refuses to fold no attempt', () => {
    expect(() => foldAttempts([])).toThrow(RangeError);
  });
});

describe('runCaseAttempts (agents-evals R210)', () => {
  const evalCase = {
    id: 'shot-conversion-2022',
    question: 'What share of shots were converted in 2022?',
    category: 'ratio' as const,
    split: 'held-out' as const,
  };

  it('runs k attempts one after another, announcing each before it runs', async () => {
    const order: string[] = [];
    const folded = await runCaseAttempts(
      evalCase,
      3,
      (n) => {
        order.push(`run ${n}`);
        return Promise.resolve(attempt('passed'));
      },
      (n) => order.push(`attempt ${n}`),
    );
    expect(order).toEqual([
      'attempt 1',
      'run 1',
      'attempt 2',
      'run 2',
      'attempt 3',
      'run 3',
    ]);
    expect(folded).toMatchObject({ status: 'passed', runs: 3 });
  });

  it('fails an attempt that throws with its error, and still runs the others', async () => {
    const runOnce = jest
      .fn()
      .mockResolvedValueOnce(attempt('passed'))
      .mockRejectedValueOnce(new Error('connection lost'))
      .mockResolvedValueOnce(attempt('passed'));
    const folded = await runCaseAttempts(evalCase, 3, runOnce);
    expect(runOnce).toHaveBeenCalledTimes(3);
    expect(folded).toMatchObject({
      status: 'failed',
      passes: 2,
      flaky: true,
      error: 'connection lost',
      split: 'held-out',
      checkResults: [],
    });
  });

  it('runs once with Repeats 1', async () => {
    const runOnce = jest.fn().mockResolvedValue(attempt('failed'));
    const folded = await runCaseAttempts(evalCase, 1, runOnce);
    expect(runOnce).toHaveBeenCalledTimes(1);
    expect(folded).toMatchObject({ status: 'failed', runs: 1, flaky: false });
  });
});

describe('cost helpers (agents-evals R221)', () => {
  it('prices usage, or answers null for a model with no rate', () => {
    expect(costUsdOf(usage(1_000_000, 1_000_000))).toBe(0.75);
    expect(
      costUsdOf([{ ...usage(10, 10)[0], model: 'no-such-model' }]),
    ).toBeNull();
    expect(costUsdOf([])).toBe(0);
  });

  it('sums costs to six decimals, null when any is not priced', () => {
    expect(sumCostUsd([0.1234564, 0.0000004])).toBe(0.123457);
    expect(sumCostUsd([0.1, undefined])).toBe(0.1);
    expect(sumCostUsd([0.1, null])).toBeNull();
    expect(sumCostUsd([])).toBe(0);
  });
});
