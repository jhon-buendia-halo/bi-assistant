// The eval target of Questions to Insights v2 runs the whole qti-v2-turn
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
import { qtiV2TurnWorkflow } from '../workflows/qti-v2-turn.workflow';
import type { QtiV2Plan } from '../workflows/qti-v2-turn.steps';
import {
  clarificationAnswer,
  lastUserText,
  workflowTurnAgent,
  type WorkflowTargetParts,
} from './analyst-v2-workflow-target';

const PLAN: QtiV2Plan = {
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

function setUp(plan: QtiV2Plan, results: ReturnType<typeof agentResult>[]) {
  const generate = jest.fn(
    (_input: unknown, options: Record<string, unknown>) => {
      const result = results.shift()!;
      // The agent reports each step, as `runEvals` hears it.
      (options['onStepFinish'] as (step: unknown) => void)(result.steps[0]);
      return Promise.resolve(result);
    },
  );
  const agent = {
    id: 'questions-to-insights-v2',
    name: 'Questions to Insights v2',
    generate,
    getModel: jest.fn(() => 'model'),
  } as unknown as Agent;
  const parts: WorkflowTargetParts & {
    plan: jest.Mock;
    writeAnswer: jest.Mock;
  } = {
    workflow: qtiV2TurnWorkflow as unknown as WorkflowTargetParts['workflow'],
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

describe('the v2 eval target runs the whole qti-v2-turn workflow (agents.md 8.1)', () => {
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
    expect(context[1].content).toMatch(/^Catalog loaded for this turn/);
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
  });

  it('retries Analyse once when Validate fails, and scores the last attempt', async () => {
    const { target, generate, options } = setUp(PLAN, [
      agentResult({ error: 'relation "goalz" does not exist' }),
      agentResult([{ player: 'Kane', goals: 6 }]),
    ]);
    await target.generate('Who scored the most in 2018?', options as never);
    expect(generate).toHaveBeenCalledTimes(2);
    const retryContext = generate.mock.calls[1][1]['context'] as {
      content: string;
    }[];
    expect(retryContext.at(-1)?.content).toContain(
      'Attempt 1 of this analysis failed validation.',
    );
  });

  it('ends on the plan’s clarifying question: no Analyse, the question and options as the answer', async () => {
    const asked: QtiV2Plan = {
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
    expect(target.name).toBe('Questions to Insights v2');
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
