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
jest.mock('../model-compat', () => ({
  providerOptionsFor: () => ({}),
  modelIdOf: (config: string | { id: string }) =>
    typeof config === 'string' ? config : config.id,
}));
jest.mock('../tool-services', () => ({
  getDatasetToolServices: () => ({ getDatasets: () => Promise.resolve([]) }),
}));
jest.mock('../../modules/sessions/turn-data', () => ({
  synthesizeToolOnlyTurn: jest.fn(),
  toolDataRecord: jest.fn(),
}));
// `@mastra/core/evals` and `@mastra/evals/checks` pull in ESM-only packages
// Jest cannot require (see eval-set-files.spec.ts). The suite's sets still
// load from ./sets: these stand-ins build a scorer per check, which never
// runs here.
jest.mock('@mastra/core/evals', () => ({
  runEvals: jest.fn(),
  createScorer: (config: Record<string, unknown>) => {
    const scorer: Record<string, unknown> = { ...config };
    for (const step of ['analyze', 'generateScore', 'generateReason']) {
      scorer[step] = () => scorer;
    }
    return scorer;
  },
}));
jest.mock('@mastra/evals/checks', () => ({
  checks: new Proxy(
    {},
    { get: (_target, type) => () => ({ id: `check-${String(type)}` }) },
  ),
}));

import { runEvals } from '@mastra/core/evals';
import { evalJudgeAgent } from '../agents/eval-judge.agent';
import { appSkillBody } from '../app-skills';
import { resolveAgentModel } from '../model-resolver';
import { USAGE_SINK_CONTEXT_KEY, usageSinkFrom } from '../usage-sink';
import {
  ASSISTANT_EVAL_SETS,
  ASSISTANT_EVAL_TARGET,
  evalRunModel,
  runAssistantEvalCase,
} from './assistant.evals';
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

/** A case with one file check (criterion D3) and, unless `judgeOnly`, a rubric. */
function judgedCase(
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

describe('runAssistantEvalCase judge option (agents-evals R144 to R147)', () => {
  it('makes no judge call with the judge off, the default, and records the judge check as not scored', async () => {
    const result = await runAssistantEvalCase(judgedCase('out-of-scope'), [
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
      judgedCase('ambiguous', { judgeOnly: true }),
      ['World Cup'],
      undefined,
      undefined,
      ASSISTANT_EVAL_TARGET,
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
      judgedCase('out-of-scope'),
      ['World Cup'],
      undefined,
      undefined,
      ASSISTANT_EVAL_TARGET,
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
      judgedCase('reasoning'),
      ['World Cup'],
      undefined,
      undefined,
      ASSISTANT_EVAL_TARGET,
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
      judgedCase('out-of-scope'),
      ['World Cup'],
      undefined,
      undefined,
      ASSISTANT_EVAL_TARGET,
      judge,
    );
    expect(generate).not.toHaveBeenCalled();
    expect(skipped.checkResults[1].status).toBe('not-scored');

    generate.mockResolvedValueOnce({
      object: { pass: true, reason: 'Asked with three options.' },
    });
    const judged = await runAssistantEvalCase(
      judgedCase('ambiguous'),
      ['World Cup'],
      undefined,
      undefined,
      ASSISTANT_EVAL_TARGET,
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
      judgedCase('lookup', { rubric: false }),
      ['World Cup'],
      undefined,
      undefined,
      ASSISTANT_EVAL_TARGET,
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
      judgedCase('lookup'),
      ['World Cup'],
      undefined,
      undefined,
      ASSISTANT_EVAL_TARGET,
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

  it('gives a custom check a status and no criterion', async () => {
    const result = await runAssistantEvalCase(
      {
        id: 'custom',
        question: 'Save it',
        intent: 'demo',
        scorers: [],
        customChecks: [
          { id: 'ok', description: 'passes', run: () => undefined },
          { id: 'bad', description: 'fails', run: () => 'it did not' },
        ],
      },
      ['World Cup'],
    );
    expect(result.checkResults).toEqual([
      {
        id: 'ok',
        description: 'passes',
        score: 1,
        passed: true,
        reason: undefined,
        status: 'passed',
      },
      {
        id: 'bad',
        description: 'fails',
        score: 0,
        passed: false,
        reason: 'it did not',
        status: 'failed',
      },
    ]);
    expect(result).toMatchObject({ status: 'failed', passed: false });
    expect(result).not.toHaveProperty('category');
  });
});

const BLOCK =
  'Curated dataset knowledge (user-authored — treat as authoritative over anything you infer from schema):\n- [instruction] Coverage: only 2018 and 2022.';

const evalCase: AssistantEvalCase = {
  id: 'demo',
  question: 'Who won in 2022?',
  intent: 'demo',
  scorers: [],
};

/** The system messages the eval run sent with the question. */
function sentContext(): { role: string; content: string }[] {
  const [config] = jest.mocked(runEvals).mock.calls.at(-1) as unknown as [
    { targetOptions: { context: { role: string; content: string }[] } },
  ];
  return config.targetOptions.context;
}

describe('runAssistantEvalCase context (agents.md 4.1, 8.5)', () => {
  it('sends the knowledge block without the on-demand skill', async () => {
    const result = await runAssistantEvalCase(
      evalCase,
      ['World Cup Core'],
      undefined,
      BLOCK,
    );

    expect(result.error).toBeUndefined();
    const contents = sentContext().map((message) => message.content);
    expect(contents).toHaveLength(2);
    expect(contents[0]).toContain('Datasets for this session: World Cup Core.');
    expect(contents[1]).toBe(BLOCK);
    expect(contents.join('\n')).not.toContain(
      appSkillBody('curated-knowledge'),
    );
    expect(sentContext().every((message) => message.role === 'system')).toBe(
      true,
    );
  });

  it('sends neither the block nor the skill when no knowledge applies', async () => {
    for (const block of [undefined, '']) {
      await runAssistantEvalCase(
        evalCase,
        ['World Cup Core'],
        undefined,
        block,
      );

      const contents = sentContext().map((message) => message.content);
      expect(contents).toHaveLength(1);
      expect(contents.join('\n')).not.toContain('Curated knowledge:');
    }
  });
});

/** The requestContext the eval run sent with the question. */
function sentRequestContext(): { get(key: string): unknown } {
  const [config] = jest.mocked(runEvals).mock.calls.at(-1) as unknown as [
    { data: { requestContext: { get(key: string): unknown } }[] },
  ];
  return config.data[0].requestContext;
}

describe('tool selection in the eval cases (agents.md 8.1, ADR-0022)', () => {
  const setCases = (id: string) =>
    ASSISTANT_EVAL_SETS.find((set) => set.id === id)?.cases ?? [];

  it('has 63 World Cup cases, two of them with a tool selection', () => {
    const cases = setCases('world-cup');
    expect(cases).toHaveLength(63);
    expect(
      cases
        .filter((evalCase) => evalCase.agentTools)
        .map(({ id, question, agentTools }) => ({ id, question, agentTools })),
    ).toEqual([
      {
        id: 'no-clarification-best-team',
        question: 'Which team performed best?',
        agentTools: ['sample_rows', 'visuals'],
      },
      {
        id: 'no-visuals-chart-request',
        question: 'Show me a chart of goals scored per World Cup tournament.',
        agentTools: ['sample_rows', 'ask_clarification'],
      },
    ]);
    expect(
      cases
        .filter((evalCase) => evalCase.agentTools)
        .every((evalCase) => evalCase.judgeRubric),
    ).toBe(true);
  });

  it('derives the same 63 for the REST set, selections included', () => {
    const rest = setCases('world-cup-rest');
    expect(rest).toHaveLength(63);
    expect(
      rest.find((evalCase) => evalCase.id === 'rest-no-visuals-chart-request')
        ?.agentTools,
    ).toEqual(['sample_rows', 'ask_clarification']);
  });

  it('runs a case with its selection on the context and the matching Block 1', async () => {
    await runAssistantEvalCase(
      { ...evalCase, agentTools: ['ask_clarification', 'visuals'] },
      ['World Cup Core'],
    );

    expect(sentRequestContext().get('agent-tools')).toEqual([
      'ask_clarification',
      'visuals',
    ]);
    expect(sentContext()[0].content).toContain(
      'Use describe_entity / run_readonly_sql to inspect and query them.',
    );
  });

  it('runs a case without a selection with every tool', async () => {
    await runAssistantEvalCase(evalCase, ['World Cup Core']);

    expect(sentRequestContext().get('agent-tools')).toBeUndefined();
    expect(sentContext()[0].content).toContain(
      'Use describe_entity / sample_rows / run_readonly_sql to inspect and query them.',
    );
  });
});

describe('runAssistantEvalCase attempt fields (agents-evals R211, R215)', () => {
  it('carries the split of its case and counts as one attempt', async () => {
    const heldOut = await runAssistantEvalCase(
      { ...judgedCase('ratio', { rubric: false }), split: 'held-out' },
      ['World Cup'],
    );
    expect(heldOut).toMatchObject({
      split: 'held-out',
      status: 'passed',
      passes: 1,
      runs: 1,
      flaky: false,
    });
    expect(heldOut).not.toHaveProperty('attempts');

    const dev = await runAssistantEvalCase(evalCase, ['World Cup']);
    expect(dev).toMatchObject({ split: 'dev', passes: 0, runs: 1 });
  });

  it('gives a thrown attempt its split and no passes', async () => {
    jest.mocked(runEvals).mockRejectedValueOnce(new Error('connection lost'));
    const result = await runAssistantEvalCase(
      { ...judgedCase('lookup'), split: 'held-out' },
      ['World Cup'],
    );
    expect(result).toMatchObject({
      split: 'held-out',
      status: 'failed',
      passes: 0,
      runs: 1,
      flaky: false,
    });
  });
});

/** runEvals for one item: the target result given, every scorer 1. */
function runEvalsReturning(
  targetResult: Record<string, unknown>,
  duringTurn?: (requestContext: { get(key: string): unknown }) => void,
) {
  jest.mocked(runEvals).mockImplementationOnce(((config: {
    scorers: { id: string }[];
    data: { requestContext: { get(key: string): unknown } }[];
    onItemComplete?: (item: unknown) => void;
  }) => {
    duringTurn?.(config.data[0].requestContext);
    config.onItemComplete?.({ targetResult, scorerResults: {} });
    return Promise.resolve({
      scores: Object.fromEntries(config.scorers.map((sc) => [sc.id, 1])),
    });
  }) as never);
}

const RUN_MODEL = { model: 'openai/gpt-4o-mini' };

describe('runAssistantEvalCase usage and cost (agents-evals R219 to R221)', () => {
  it('records the generate of the agent over every step and the call of the judge, priced', async () => {
    runEvalsReturning({
      text: 'Argentina',
      usage: { inputTokens: 1, outputTokens: 1 },
      totalUsage: { inputTokens: 10_000, outputTokens: 1_000 },
    });
    generate.mockResolvedValueOnce({
      object: { pass: true, reason: 'ok' },
      usage: { inputTokens: 2_000, outputTokens: 100 },
    });
    const result = await runAssistantEvalCase(
      judgedCase('out-of-scope'),
      ['World Cup'],
      undefined,
      undefined,
      ASSISTANT_EVAL_TARGET,
      { mode: 'on' },
      RUN_MODEL,
    );
    expect(result.usage).toEqual([
      {
        agent: 'assistant',
        model: 'gpt-4o-mini',
        inputTokens: 10_000,
        cachedInputTokens: 0,
        outputTokens: 1_000,
        reasoningTokens: 0,
        calls: 1,
        unreportedCalls: 0,
      },
      {
        agent: 'judge',
        model: 'gpt-4o-mini',
        inputTokens: 2_000,
        cachedInputTokens: 0,
        outputTokens: 100,
        reasoningTokens: 0,
        calls: 1,
        unreportedCalls: 0,
      },
    ]);
    // (10,000 × 0.15 + 1,000 × 0.60 + 2,000 × 0.15 + 100 × 0.60) / 10^6.
    expect(result.costUsd).toBe(0.00246);
  });

  it('calls the judge with the same options as before usage was recorded', async () => {
    await runAssistantEvalCase(
      judgedCase('out-of-scope'),
      ['World Cup'],
      undefined,
      undefined,
      ASSISTANT_EVAL_TARGET,
      { mode: 'on' },
      RUN_MODEL,
    );
    const [prompt, options] = generate.mock.calls[0] as [string, unknown];
    expect(prompt).toContain('Rubric:\nSays it cannot answer.');
    expect(options).toEqual({
      maxSteps: 1,
      toolChoice: 'none',
      providerOptions: {},
      structuredOutput: {
        schema: expect.anything() as unknown,
        jsonPromptInjection: 'inline',
      },
    });
  });

  it('puts the sink of the attempt on the request context for the SQL fixer and the designer', async () => {
    runEvalsReturning(
      { text: 'Argentina', totalUsage: { inputTokens: 100, outputTokens: 10 } },
      (requestContext) => {
        expect(typeof requestContext.get(USAGE_SINK_CONTEXT_KEY)).toBe(
          'function',
        );
        const sink = usageSinkFrom(requestContext);
        sink?.(
          'sql-fixer',
          { usage: { inputTokens: 60, outputTokens: 5 } },
          'openai/gpt-4o-mini-2024-07-18',
        );
        // A designer call that reported nothing, on the run's model.
        sink?.('designer', { text: '{}' });
      },
    );
    const result = await runAssistantEvalCase(
      evalCase,
      ['World Cup'],
      undefined,
      undefined,
      ASSISTANT_EVAL_TARGET,
      undefined,
      RUN_MODEL,
    );
    expect(
      result.usage?.map(({ agent, model, calls, unreportedCalls }) => ({
        agent,
        model,
        calls,
        unreportedCalls,
      })),
    ).toEqual([
      {
        agent: 'assistant',
        model: 'gpt-4o-mini',
        calls: 1,
        unreportedCalls: 0,
      },
      {
        agent: 'sql-fixer',
        model: 'gpt-4o-mini-2024-07-18',
        calls: 1,
        unreportedCalls: 0,
      },
      { agent: 'designer', model: 'gpt-4o-mini', calls: 0, unreportedCalls: 1 },
    ]);
    // (100 × 0.15 + 10 × 0.60 + 60 × 0.15 + 5 × 0.60) / 10^6: the dated
    // snapshot takes its model's rate, and the unreported call adds 0.
    expect(result.costUsd).toBe(0.000033);
  });

  it('counts a generate whose result reports no tokens as unreported, not free', async () => {
    runEvalsReturning({ text: 'Argentina' });
    const result = await runAssistantEvalCase(
      evalCase,
      ['World Cup'],
      undefined,
      undefined,
      ASSISTANT_EVAL_TARGET,
      undefined,
      RUN_MODEL,
    );
    expect(result.usage).toEqual([
      expect.objectContaining({
        agent: 'assistant',
        calls: 0,
        unreportedCalls: 1,
        inputTokens: 0,
      }),
    ]);
    expect(result.costUsd).toBe(0);
  });

  it('counts a generate that threw as an unreported call, keeping what was recorded', async () => {
    jest.mocked(runEvals).mockImplementationOnce(((config: {
      data: { requestContext: { get(key: string): unknown } }[];
    }) => {
      usageSinkFrom(config.data[0].requestContext)?.('sql-fixer', {
        usage: { inputTokens: 50, outputTokens: 5 },
      });
      return Promise.reject(new Error('model down'));
    }) as never);
    const result = await runAssistantEvalCase(
      evalCase,
      ['World Cup'],
      undefined,
      undefined,
      ASSISTANT_EVAL_TARGET,
      undefined,
      RUN_MODEL,
    );
    expect(result.error).toBe('model down');
    expect(
      result.usage?.map(({ agent, calls, unreportedCalls }) => ({
        agent,
        calls,
        unreportedCalls,
      })),
    ).toEqual([
      { agent: 'assistant', calls: 0, unreportedCalls: 1 },
      { agent: 'sql-fixer', calls: 1, unreportedCalls: 0 },
    ]);
  });

  it('counts a judge call that threw as unreported', async () => {
    generate.mockRejectedValueOnce(new Error('judge down'));
    const result = await runAssistantEvalCase(
      judgedCase('reasoning'),
      ['World Cup'],
      undefined,
      undefined,
      ASSISTANT_EVAL_TARGET,
      { mode: 'on' },
      RUN_MODEL,
    );
    expect(
      result.usage?.find((entry) => entry.agent === 'judge'),
    ).toMatchObject({ calls: 0, unreportedCalls: 1 });
  });

  it('is not priced on a model the price table does not list', async () => {
    runEvalsReturning({
      text: 'Argentina',
      totalUsage: { inputTokens: 100, outputTokens: 10 },
    });
    const result = await runAssistantEvalCase(
      evalCase,
      ['World Cup'],
      undefined,
      undefined,
      ASSISTANT_EVAL_TARGET,
      undefined,
      { model: 'openai/gpt-9-ultra' },
    );
    expect(result.usage?.[0]).toMatchObject({
      model: 'gpt-9-ultra',
      inputTokens: 100,
    });
    expect(result.costUsd).toBeNull();
  });

  it('records on the model resolved for the attempt when the run names none', async () => {
    jest.mocked(resolveAgentModel).mockResolvedValueOnce({
      id: 'lenai/gpt-4o-mini',
      apiKey: 'k',
    });
    runEvalsReturning({
      text: 'Argentina',
      totalUsage: { inputTokens: 100, outputTokens: 10 },
    });
    const result = await runAssistantEvalCase(evalCase, ['World Cup']);
    expect(result.usage?.[0].model).toBe('gpt-4o-mini');
  });
});

describe('evalRunModel (R22, R219)', () => {
  it('answers the router id of the resolved model', async () => {
    jest.mocked(resolveAgentModel).mockResolvedValueOnce('openai/gpt-4o-mini');
    await expect(evalRunModel()).resolves.toBe('openai/gpt-4o-mini');
  });

  it('answers undefined when the model cannot be resolved', async () => {
    jest
      .mocked(resolveAgentModel)
      .mockRejectedValueOnce(new Error('no settings'));
    await expect(evalRunModel()).resolves.toBeUndefined();
  });
});
