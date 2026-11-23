// The eval target of Insights Analyst runs the whole answer-business-question
// workflow (agents.md 8.1): the real workflow definition, on the engine
// stand-in (the real engine is ESM-only for Jest), with stubbed model steps
// and a stubbed agent.
jest.mock('@mastra/core/workflows', () =>
  jest.requireActual<typeof import('../testing/workflows.stub')>(
    '../testing/workflows.stub',
  ),
);
jest.mock('../tool-services', () => ({
  getDatasetToolServices: () => ({
    getDatasets: (names: string[]) =>
      Promise.resolve(
        names.map((name) => ({
          name,
          datasourceId: 'ds-pg',
          datasourceKind: 'postgres',
          tables: ['world_cup.goals'],
        })),
      ),
  }),
}));
// What assistant.evals.ts loads at import; none of it runs here.
jest.mock('@mastra/core/evals', () => ({ runEvals: jest.fn() }));
jest.mock('@mastra/evals/checks', () => ({
  checks: new Proxy({}, { get: () => () => ({ id: 'stub-check' }) }),
}));
jest.mock('../agents/assistant.agent', () => ({ assistantAgent: {} }));
jest.mock('../agents/eval-judge.agent', () => ({
  evalJudgeAgent: {},
  evalJudgeOutputSchema: {},
}));
jest.mock('../model-resolver', () => ({ resolveAgentModel: jest.fn() }));

import type { Agent } from '@mastra/core/agent';
import { RequestContext } from '@mastra/core/request-context';
import { answerBusinessQuestionWorkflow } from '../workflows/answer-business-question.workflow';
import type { AnalysisPlan } from '../workflows/analysis.steps';
import { EVAL_CASE_CONTEXT_KEY, evalDetailsOf } from './eval-details';
import { endsOnClarifyingQuestion } from './insights-analyst-eval-checks';
import {
  clarificationAnswer,
  lastUserText,
  retryDoesNotRediscover,
  workflowTurnAgent,
  type WorkflowTargetParts,
} from './insights-analyst-workflow-target';

const PLAN: AnalysisPlan = {
  question: 'Who scored the most goals in 2018?',
  measures: ['goals per player'],
  entities: ['world_cup.goals'],
  scope: '2018.',
  assumptions: [],
  needsClarification: false,
  clarification: null,
};

/** One agent `generate` result: a step whose SQL call returned `rows`. */
function agentResult(rows: Record<string, unknown>[] | { error: string }) {
  const toolResults = [
    {
      payload: {
        toolName: 'run_readonly_sql',
        args: {
          sql: 'SELECT player, goals FROM world_cup.goals',
          rationale: 'I rank the players by goals.',
        },
        result: Array.isArray(rows)
          ? { columns: ['player', 'goals'], rows }
          : rows,
      },
    },
  ];
  const step = {
    toolCalls: [
      {
        payload: {
          toolName: 'run_readonly_sql',
          args: toolResults[0].payload.args,
        },
      },
    ],
    toolResults,
  };
  return {
    text: 'Kane leads with 6 goals.',
    steps: [step],
    toolResults,
    scoringData: { input: 'q', output: ['analyse messages'] },
  };
}

function setUp(plan: AnalysisPlan, results: ReturnType<typeof agentResult>[]) {
  const generate = jest.fn(
    (_input: unknown, options: Record<string, unknown>) => {
      const result = results.shift()!;
      // The agent reports each step, as `runEvals` hears it.
      (options['onStepFinish'] as (step: unknown) => void)(result.steps[0]);
      return Promise.resolve(result);
    },
  );
  const agent = {
    id: 'insights-analyst',
    name: 'Insights Analyst',
    generate,
    getModel: jest.fn(() => 'model'),
  } as unknown as Agent;
  const parts: WorkflowTargetParts & {
    plan: jest.Mock;
    writeAnswer: jest.Mock;
  } = {
    workflow:
      answerBusinessQuestionWorkflow as unknown as WorkflowTargetParts['workflow'],
    plan: jest.fn(() => Promise.resolve({ plan, stopped: false })),
    writeAnswer: jest.fn(() =>
      Promise.resolve({
        answer: {
          headline: 'Harry Kane scored the most goals: 6.',
          answer: 'Harry Kane scored the most goals: 6.\n\nHow I got this: …',
        },
        stopped: false,
      }),
    ),
  };
  const requestContext = new RequestContext();
  requestContext.set('datasets', ['World Cup']);
  const onStepFinish = jest.fn();
  const options = {
    maxSteps: 15,
    context: [{ role: 'system' as const, content: 'Orientation.' }],
    onStepFinish,
    requestContext,
    returnScorerData: true,
  };
  return {
    target: workflowTurnAgent(agent, parts),
    agent,
    generate,
    parts,
    options,
    onStepFinish,
  };
}

describe('the v2 eval target runs the whole answer-business-question workflow (agents.md 8.1)', () => {
  it("plans, analyses with the agent and scores Write answer's answer with Analyse's tool calls", async () => {
    const { target, generate, parts, options, onStepFinish } = setUp(PLAN, [
      agentResult([{ player: 'Kane', goals: 6 }]),
    ]);
    const result = (await target.generate(
      'Who scored the most in 2018?',
      options as never,
    )) as unknown as Record<string, unknown>;

    expect(parts.plan).toHaveBeenCalledWith(
      expect.objectContaining({
        question: 'Who scored the most in 2018?',
        catalogBlock:
          'Catalog loaded for this turn: 1 entity.\n- world_cup.goals (dataset: World Cup; ? columns)\n\nNo columns are known for these entities.',
      }),
      expect.objectContaining({ requestContext: options.requestContext }),
    );
    // Analyse is the agent's own generate with the case's options, plus the
    // catalog and plan blocks after the case's own context.
    expect(generate).toHaveBeenCalledTimes(1);
    const [input, analyseOptions] = generate.mock.calls[0];
    expect(input).toBe('Who scored the most in 2018?');
    expect(analyseOptions).toMatchObject({
      maxSteps: 15,
      returnScorerData: true,
    });
    const context = analyseOptions['context'] as { content: string }[];
    expect(context[0].content).toBe('Orientation.');
    // No columns are known here: Analyse's catalog block is the catalog
    // alone, as it was before Analyse was given the columns.
    expect(context[1].content).toBe(
      'Catalog loaded for this turn: 1 entity.\n- world_cup.goals (dataset: World Cup; ? columns)',
    );
    expect(context[2].content).toBe(
      `Analysis plan for this turn:\n${JSON.stringify(PLAN)}`,
    );
    // The case still hears every step (its result-set check reads them).
    expect(onStepFinish).toHaveBeenCalledTimes(1);
    // Write answer read the attempt's query and its rows.
    expect(parts.writeAnswer).toHaveBeenCalledWith(
      expect.objectContaining({
        queries: [
          expect.objectContaining({
            sql: 'SELECT player, goals FROM world_cup.goals',
            rows: [{ player: 'Kane', goals: 6 }],
          }),
        ],
      }),
      expect.anything(),
    );
    // The scored answer is Write answer's; the tool calls are Analyse's.
    expect(result['text']).toBe(
      'Harry Kane scored the most goals: 6.\n\nHow I got this: …',
    );
    expect(result['scoringData']).toEqual({
      input: 'q',
      output: ['analyse messages'],
    });
    expect((result['steps'] as unknown[]).length).toBe(1);
    // Every step's output reaches the checks: Plan's JSON, Validate's
    // findings, Write answer's headline (agents.md 8.1, "Run details").
    const steps = evalDetailsOf(result).steps ?? {};
    expect(Object.keys(steps)).toEqual(
      expect.arrayContaining(['plan', 'validate', 'write-answer']),
    );
    expect(steps['plan']).toMatchObject({ plan: PLAN });
    expect(steps['write-answer']).toMatchObject({
      answer: expect.stringContaining('Harry Kane') as string,
    });
  });

  it('retries Analyse once when Validate fails, and scores the last attempt', async () => {
    const { target, generate, options } = setUp(PLAN, [
      agentResult({ error: 'relation "goalz" does not exist' }),
      agentResult([{ player: 'Kane', goals: 6 }]),
    ]);
    const result = (await target.generate(
      'Who scored the most in 2018?',
      options as never,
    )) as unknown as Record<string, unknown>;
    expect(generate).toHaveBeenCalledTimes(2);
    const retryOptions = generate.mock.calls[1][1];
    const retryContext = (retryOptions['context'] as { content: string }[]).map(
      (entry) => entry.content,
    );
    // The same request as the turn engine's: the catalog with its columns,
    // the plan block with the failed checks, then attempt 1's queries.
    const plan = retryContext.findIndex((content) =>
      content.startsWith('Analysis plan for this turn:'),
    );
    expect(retryContext[plan]).toContain(
      'Attempt 1 of this analysis failed validation.',
    );
    expect(retryContext[plan + 1]).toContain(
      'Queries an earlier attempt of this analysis already ran',
    );
    expect(retryContext[plan + 1]).toContain(
      'failed: relation "goalz" does not exist',
    );
    // The retry's own step budget; attempt 1 keeps the case's.
    expect(generate.mock.calls[0][1]['maxSteps']).toBe(15);
    expect(retryOptions['maxSteps']).toBe(8);
    // The scorers read the tool calls and results of both attempts.
    expect(result['toolResults'] as unknown[]).toHaveLength(2);
    // The runner reads the trace from `steps` (extractRawToolCalls), and
    // the judge from `scoringData`: both hold both attempts.
    const resultSteps = result['steps'] as { toolResults: unknown[] }[];
    expect(resultSteps).toHaveLength(2);
    expect(resultSteps[0].toolResults).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          result: { error: 'relation "goalz" does not exist' },
        }) as unknown,
      }),
    ]);
    expect(result['scoringData']).toEqual({
      input: 'q',
      output: ['analyse messages', 'analyse messages'],
    });
    expect(evalDetailsOf(result).steps?.['analyse-attempts']).toEqual([
      ['run_readonly_sql'],
      ['run_readonly_sql'],
    ]);
  });

  it("fails the retry case's check when the retry lists or describes entities again, and passes otherwise", async () => {
    const check = retryDoesNotRediscover();
    const run = (attempts?: string[][]) =>
      check.run({
        answer: '',
        toolCalls: [],
        datasets: [],
        vars: {},
        details: attempts ? { steps: { 'analyse-attempts': attempts } } : {},
      });
    expect(
      await run([['describe_entity', 'run_readonly_sql'], ['describe_entity']]),
    ).toBe('the retry called describe_entity again');
    expect(
      await run([['run_readonly_sql'], ['list_entities', 'run_readonly_sql']]),
    ).toBe('the retry called list_entities again');
    expect(
      await run([
        ['describe_entity', 'run_readonly_sql'],
        ['run_readonly_sql'],
      ]),
    ).toBeUndefined();
    // No retry ran: the case proves nothing, so it fails.
    expect(await run([['run_readonly_sql']])).toBe(
      'no retry ran: the case needs two analysis attempts',
    );
    expect(await run()).toBe(
      'no retry ran: the case needs two analysis attempts',
    );
  });

  it('forces a retry for a case that asks for it: attempt 1 gains a query that timed out, Validate fails it and the retry is shown it', async () => {
    const { target, generate, parts, options } = setUp(PLAN, [
      agentResult([{ player: 'Kane', goals: 6 }]),
      agentResult([{ player: 'Kane', goals: 6 }]),
    ]);
    const forced = 'SELECT g.id FROM world_cup.goals g, world_cup.goals h';
    options.requestContext.set(EVAL_CASE_CONTEXT_KEY, {
      forceRetryWith: forced,
    });
    const result = (await target.generate(
      'Who scored the most in 2018?',
      options as never,
    )) as unknown as Record<string, unknown>;
    expect(generate).toHaveBeenCalledTimes(2);
    const retryContext = (
      generate.mock.calls[1][1]['context'] as { content: string }[]
    ).map((entry) => entry.content);
    expect(retryContext.join('\n')).toContain(
      'Attempt 1 of this analysis failed validation.',
    );
    expect(retryContext.join('\n')).toContain(forced);
    expect(retryContext.join('\n')).toContain(
      'failed: canceling statement due to statement timeout',
    );
    // The injected call is not a call of the agent: no trace holds it.
    expect(result['toolResults'] as unknown[]).toHaveLength(2);
    expect(evalDetailsOf(result).steps?.['analyse-attempts']).toEqual([
      ['run_readonly_sql'],
      ['run_readonly_sql'],
    ]);
    // Write answer reads the retry's queries only: the injected one is not an answer's.
    const written = (parts.writeAnswer.mock.calls[0] as unknown[])[0] as {
      queries: { sql: string }[];
    };
    expect(written.queries.map((query) => query.sql)).not.toContain(forced);
  });

  it("reports attempt 1's catalogue block as the judge's context", async () => {
    const { target, generate, options } = setUp(PLAN, [
      agentResult([{ player: 'Kane', goals: 6 }]),
    ]);
    const result = (await target.generate(
      'Who scored the most in 2018?',
      options as never,
    )) as unknown as Record<string, unknown>;
    const sent = (
      generate.mock.calls[0][1]['context'] as { content: string }[]
    ).map((entry) => entry.content);
    const reported = evalDetailsOf(result).judgeContext;
    expect(typeof reported).toBe('string');
    expect(reported).not.toBe('');
    // Exactly the block the request held, not a copy built apart.
    expect(sent).toContain(reported);
  });

  it('adds nothing when the case does not ask for a retry: one attempt, no injected query', async () => {
    const { target, generate, options } = setUp(PLAN, [
      agentResult([{ player: 'Kane', goals: 6 }]),
    ]);
    options.requestContext.set(EVAL_CASE_CONTEXT_KEY, { id: 'another-case' });
    await target.generate('Who scored the most in 2018?', options as never);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('keeps attempt 1 when the retry throws (agent.generate fails on a model error): the case is scored, not failed', async () => {
    const { target, generate, parts, options } = setUp(PLAN, [
      agentResult([
        { player: 'Kane', goals: 6 },
        { player: 'Lukaku', goals: 4 },
      ]),
    ]);
    // Attempt 1 kept an arbitrary sample, so Validate asks for a retry.
    const sample = agentResult([{ player: 'Kane', goals: 6 }]);
    sample.toolResults[0].payload.args = {
      sql: 'SELECT player, goals FROM world_cup.goals LIMIT 1',
      rationale: 'I look at one row.',
    };
    generate
      .mockImplementationOnce((_input, opts) => {
        (opts['onStepFinish'] as (step: unknown) => void)(sample.steps[0]);
        return Promise.resolve(sample);
      })
      .mockImplementationOnce(() => Promise.reject(new Error('Overloaded')));
    const result = (await target.generate(
      'Who scored the most in 2018?',
      options as never,
    )) as unknown as Record<string, unknown>;
    expect(generate).toHaveBeenCalledTimes(2);
    const written = (parts.writeAnswer.mock.calls[0] as unknown[])[0] as {
      queries: { sql: string }[];
      findings: { check: string }[];
    };
    expect(written.queries.map((q) => q.sql)).toEqual([
      'SELECT player, goals FROM world_cup.goals LIMIT 1',
    ]);
    expect(written.findings.at(-1)?.check).toBe(
      'Retry completed (warning only)',
    );
    expect(result['text']).toContain('Harry Kane');
    // Attempt 1's result is the one scored.
    expect(result['toolResults']).toEqual(sample.toolResults);
  });

  it('ends on the plan’s clarifying question: no Analyse, the question and options as the answer', async () => {
    const asked: AnalysisPlan = {
      ...PLAN,
      needsClarification: true,
      clarification: {
        question: 'Dominant by which measure?',
        options: ['Matches won', 'Goals scored'],
      },
    };
    const { target, generate, parts, options } = setUp(asked, []);
    const result = (await target.generate(
      'Which team was the most dominant?',
      options as never,
    )) as unknown as Record<string, unknown>;
    expect(generate).not.toHaveBeenCalled();
    expect(parts.writeAnswer).not.toHaveBeenCalled();
    expect(result['text']).toBe(
      'Dominant by which measure?\n- Matches won\n- Goals scored',
    );
    expect(result['steps']).toEqual([]);
    expect(result['scoringData']).toEqual({
      input: 'Which team was the most dominant?',
      output: [],
    });
  });

  it('scores a run suspended at Clarify on its question and options, passes the clarification check, and drops the suspended run', async () => {
    const asked: AnalysisPlan = {
      ...PLAN,
      needsClarification: true,
      clarification: {
        question: 'Dominant by which measure?',
        options: ['Matches won', 'Goals scored'],
      },
    };
    const { target, parts, options } = setUp(asked, []);
    const deleted = jest.fn(() => Promise.resolve());
    const engine = parts.workflow as unknown as {
      createRun(): Promise<{ runId?: string }>;
    };
    let runId: string | undefined;
    parts.workflow = {
      createRun: async () => {
        const created = await engine.createRun();
        runId = created.runId;
        return created as never;
      },
      deleteWorkflowRunById: deleted,
    };
    const result = (await target.generate(
      'Which team was the most dominant?',
      options as never,
    )) as unknown as Record<string, unknown>;
    expect(result['text']).toBe(
      'Dominant by which measure?\n- Matches won\n- Goals scored',
    );
    expect(
      endsOnClarifyingQuestion().run({
        answer: result['text'] as string,
      } as never),
    ).toBeUndefined();
    expect(deleted).toHaveBeenCalledWith(runId);
  });

  it("scores a run suspended at Analyse on the agent's clarifying question: no answer is written", async () => {
    const asking = agentResult([]);
    asking.steps[0].toolCalls = [
      {
        payload: {
          toolName: 'ask_clarification',
          args: {
            question: 'Which tournament?',
            options: '2018 — Russia\n2022 — Qatar',
          } as never,
        },
      },
    ];
    const { target, parts, options } = setUp(PLAN, [asking]);
    const result = (await target.generate(
      'Who scored the most?',
      options as never,
    )) as unknown as Record<string, unknown>;
    expect(parts.writeAnswer).not.toHaveBeenCalled();
    expect(result['text']).toBe(
      'Which tournament?\n- 2018 — Russia\n- 2022 — Qatar',
    );
    expect(
      endsOnClarifyingQuestion().run({
        answer: result['text'] as string,
      } as never),
    ).toBeUndefined();
    // Analyse's tool calls are still scored.
    expect(result['steps']).toEqual(asking.steps);
  });

  it('fails the case when a step fails', async () => {
    const { target, parts, options } = setUp(PLAN, [
      agentResult([{ player: 'Kane', goals: 6 }]),
    ]);
    parts.writeAnswer.mockRejectedValueOnce(new Error('model down'));
    await expect(
      target.generate('Who scored?', options as never),
    ).rejects.toThrow('model down');
  });

  it('keeps every other member of the agent its own', () => {
    const { target, agent } = setUp(PLAN, []);
    expect(target.id).toBe(agent.id);
    expect(target.name).toBe('Insights Analyst');
    // Compared, never called detached.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const [own, replaced] = [agent.generate, target.generate];
    expect(replaced).not.toBe(own);
    expect(target.getModel()).toBe('model');
  });

  it('reads the question from the last user message, and writes a clarification as lines', () => {
    expect(lastUserText('Q')).toBe('Q');
    expect(
      lastUserText([
        { role: 'user', content: 'First' },
        { role: 'assistant', content: 'A' },
        { role: 'user', content: [{ type: 'text', text: 'Second' }] },
      ]),
    ).toBe('Second');
    expect(
      clarificationAnswer({ question: 'Which?', options: ['A', 'B'] }),
    ).toBe('Which?\n- A\n- B');
  });
});
