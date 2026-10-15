// The assistant and the judge pull in the whole Mastra agent stack; the runner
// only needs their `generate`, which these tests control. `runEvals` is
// replaced so no model is called: it reports every scorer as scoring 1.
jest.mock('../agents/assistant.agent', () => ({ assistantAgent: {} }));
jest.mock('../agents/eval-judge.agent', () => {
  const { z } = jest.requireActual<typeof import('zod')>('zod');
  return {
    evalJudgeAgent: { generate: jest.fn() },
    evalJudgeOutputSchema: z.object({ pass: z.boolean(), reason: z.string() }),
  };
});
jest.mock('../model-resolver', () => ({
  resolveAgentModel: jest.fn().mockResolvedValue({}),
}));
jest.mock('../model-compat', () => ({ providerOptionsFor: () => ({}) }));
jest.mock('../tool-services', () => ({
  getDatasetToolServices: () => ({ getDatasets: () => Promise.resolve([]) }),
}));
// `@mastra/core/evals` and `@mastra/evals/checks` pull in ESM-only packages
// Jest cannot require (see eval-set-files.spec.ts); the cases here are built by
// hand, so the suite's own sets are not needed.
jest.mock('@mastra/core/evals', () => ({ runEvals: jest.fn() }));
jest.mock('./eval-check-scorers', () => ({ toAssistantEvalSets: () => [] }));

import { runEvals } from '@mastra/core/evals';
import { evalJudgeAgent } from '../agents/eval-judge.agent';
import { runAssistantEvalCase } from './assistant.evals';
import type { AssistantEvalCase } from './assistant.evals';

/** The judge's `generate`, a plain mock here (see the module mock above). */
const generate = (evalJudgeAgent as unknown as { generate: jest.Mock })
  .generate;

/** What the runner passes to `runEvals` and reads back. */
interface RunEvalsCall {
  scorers: { id: string }[];
  onItemComplete?: (item: {
    targetResult: { text: string };
    scorerResults: Record<string, unknown>;
  }) => void;
}

/** A case with one file check (criterion D3) and, unless `judgeOnly`, a rubric. */
function evalCase(
  category: AssistantEvalCase['category'],
  options: { judgeOnly?: boolean; rubric?: boolean } = {},
): AssistantEvalCase {
  const { judgeOnly = false, rubric = true } = options;
  return {
    id: `case-${category}`,
    question: `A ${category} question?`,
    intent: 'probes something',
    scorers: judgeOnly
      ? []
      : [
          {
            id: 'check-no-tool-errors',
            name: 'No tool errors',
            description: 'Checks that no tool calls resulted in errors',
          } as never,
        ],
    checkCriteria: judgeOnly ? [] : ['D3'],
    ...(rubric ? { judgeRubric: 'Says it cannot answer.' } : {}),
    category,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(runEvals).mockImplementation(((config: RunEvalsCall) => {
    config.onItemComplete?.({
      targetResult: { text: 'The data covers 2018 and 2022.' },
      scorerResults: {},
    });
    return Promise.resolve({
      scores: Object.fromEntries(
        config.scorers.map((scorer) => [scorer.id, 1]),
      ),
    });
  }) as never);
  generate.mockResolvedValue({
    object: { pass: false, reason: 'It invented a figure.' },
  });
});

describe('runAssistantEvalCase judge option (agents-evals R143 to R146)', () => {
  it('makes no judge call with the judge off, the default, and records the judge check as not scored', async () => {
    const result = await runAssistantEvalCase(evalCase('out-of-scope'), [
      'World Cup',
    ]);
    expect(generate).not.toHaveBeenCalled();
    expect(result.checkResults).toEqual([
      {
        id: 'check-no-tool-errors',
        description: 'Checks that no tool calls resulted in errors',
        score: 1,
        passed: true,
        status: 'passed',
        criterion: 'D3',
      },
      {
        id: 'llm-judge',
        description: 'LLM judge: Says it cannot answer.',
        score: 0,
        passed: false,
        status: 'not-scored',
        reason: 'Judge off for this run',
        criterion: 'G2',
      },
    ]);
    // The scored check passed, so the question passes; the gap is not a fail.
    expect(result).toMatchObject({
      category: 'out-of-scope',
      status: 'passed',
      passed: true,
    });
  });

  it('does not score a question whose only check is the judge when the judge is off', async () => {
    const result = await runAssistantEvalCase(
      evalCase('ambiguous', { judgeOnly: true }),
      ['World Cup'],
      undefined,
      undefined,
      { mode: 'off' },
    );
    expect(generate).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'not-scored', passed: false });
    expect(result.checkResults).toEqual([
      expect.objectContaining({ status: 'not-scored', criterion: 'I5' }),
    ]);
  });

  it('calls the judge with the judge on, and its verdict is scored', async () => {
    const result = await runAssistantEvalCase(
      evalCase('out-of-scope'),
      ['World Cup'],
      undefined,
      undefined,
      { mode: 'on' },
    );
    expect(generate).toHaveBeenCalledTimes(1);
    expect(result.checkResults[1]).toEqual({
      id: 'llm-judge',
      description: 'LLM judge: Says it cannot answer.',
      score: 0,
      passed: false,
      status: 'failed',
      reason: 'It invented a figure.',
      criterion: 'G2',
    });
    expect(result).toMatchObject({ status: 'failed', passed: false });
  });

  it('a judge that errors is failed, not not-scored', async () => {
    generate.mockRejectedValueOnce(new Error('model down'));
    const result = await runAssistantEvalCase(
      evalCase('reasoning'),
      ['World Cup'],
      undefined,
      undefined,
      { mode: 'on' },
    );
    expect(result.checkResults[1]).toMatchObject({
      status: 'failed',
      reason: 'judge error: model down',
      criterion: 'G3',
    });
    expect(result.status).toBe('failed');
  });

  it('judges only the listed categories with categories', async () => {
    const judge = {
      mode: 'categories' as const,
      categories: ['ambiguous' as const],
    };
    const skipped = await runAssistantEvalCase(
      evalCase('out-of-scope'),
      ['World Cup'],
      undefined,
      undefined,
      judge,
    );
    expect(generate).not.toHaveBeenCalled();
    expect(skipped.checkResults[1].status).toBe('not-scored');

    generate.mockResolvedValueOnce({
      object: { pass: true, reason: 'Asked with three options.' },
    });
    const judged = await runAssistantEvalCase(
      evalCase('ambiguous'),
      ['World Cup'],
      undefined,
      undefined,
      judge,
    );
    expect(generate).toHaveBeenCalledTimes(1);
    expect(judged.checkResults[1]).toMatchObject({
      status: 'passed',
      score: 1,
      criterion: 'I5',
    });
    expect(judged.status).toBe('passed');
  });

  it('adds no judge check to a question without a rubric, whatever the option', async () => {
    const result = await runAssistantEvalCase(
      evalCase('lookup', { rubric: false }),
      ['World Cup'],
      undefined,
      undefined,
      { mode: 'on' },
    );
    expect(generate).not.toHaveBeenCalled();
    expect(result.checkResults.map((check) => check.id)).toEqual([
      'check-no-tool-errors',
    ]);
  });

  it('fails a question whose run threw, keeping its category', async () => {
    jest.mocked(runEvals).mockRejectedValueOnce(new Error('connection lost'));
    const result = await runAssistantEvalCase(
      evalCase('lookup'),
      ['World Cup'],
      undefined,
      undefined,
      { mode: 'on' },
    );
    expect(generate).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      category: 'lookup',
      status: 'failed',
      passed: false,
      error: 'connection lost',
      checkResults: [],
    });
  });
});
