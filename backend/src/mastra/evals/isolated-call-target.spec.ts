// The isolated-call eval target (agents.md 8.1): one model function per
// case, over the case's frozen `input`. No model is called: the call is a
// stand-in.
import type { Agent } from '@mastra/core/agent';
import { RequestContext } from '@mastra/core/request-context';
import type { AssistantEvalCase, AssistantEvalSet } from './assistant.evals';
import {
  EVAL_CASE_CONTEXT_KEY,
  EVAL_DETAILS_KEY,
  evalDetailsOf,
  recordStepOutput,
} from './eval-details';
import {
  caseInputOf,
  isolatedCallTarget,
  isolatedCase,
} from './isolated-call-target';

interface PlanInput {
  question: string;
  catalogBlock: string;
}

const CASE = isolatedCase<PlanInput>({
  id: 'example-plan',
  question: 'Plan: revenue by category',
  intent: 'Example.',
  scorers: [],
  input: { question: 'Revenue by category?', catalogBlock: 'Catalog.' },
});

const SET: AssistantEvalSet = {
  id: 'example',
  name: 'Example',
  description: 'Example.',
  fixtureId: 'edge-cases',
  agentKey: 'analysis-planner',
  cases: [CASE],
};

function agent(): Agent {
  return {
    id: 'analysis-planner',
    getModel: jest.fn(() => 'model'),
    name: 'Olivia',
  } as unknown as Agent;
}

function contextFor(evalCase: AssistantEvalCase): RequestContext {
  const requestContext = new RequestContext();
  requestContext.set(EVAL_CASE_CONTEXT_KEY, evalCase);
  return requestContext;
}

describe('isolatedCallTarget (agents.md 8.1)', () => {
  it('calls the function once with the case input and scores its output as JSON text', async () => {
    const call = jest.fn((input: PlanInput) =>
      Promise.resolve({ plan: { question: input.question }, stopped: false }),
    );
    const target = isolatedCallTarget<PlanInput, { plan: unknown }>({
      agentKey: 'analysis-planner',
      sets: [SET],
      loadAgent: agent,
      call,
      answerOf: (output) => output.plan,
    });
    expect(target.agentKey).toBe('analysis-planner');
    expect(target.sets).toEqual([SET]);
    expect(target.sendsKnowledge).toBe(false);
    expect(await target.orientation({} as never)).toBe('');
    const requestContext = contextFor(CASE);
    const result = (await target.runTarget!.generate(
      'Plan: revenue by category',
      { requestContext } as never,
    )) as unknown as Record<string, unknown>;
    expect(call).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith(
      { question: 'Revenue by category?', catalogBlock: 'Catalog.' },
      expect.objectContaining({ requestContext }),
    );
    expect(JSON.parse(result['text'] as string)).toEqual({
      question: 'Revenue by category?',
    });
    // The whole output reaches the checks as `details.output`.
    expect(evalDetailsOf(result)).toEqual({
      output: { plan: { question: 'Revenue by category?' }, stopped: false },
    });
    expect(result[EVAL_DETAILS_KEY]).toBeDefined();
    // What the built-in scorers read: the answer as an assistant message.
    const scoring = result['scoringData'] as { output: unknown[] };
    expect(scoring.output).toHaveLength(1);
  });

  it('answers the whole output when no answerOf is given', async () => {
    const target = isolatedCallTarget<PlanInput, { a: number }>({
      agentKey: 'analysis-planner',
      sets: [SET],
      loadAgent: agent,
      call: () => Promise.resolve({ a: 1 }),
    });
    const result = (await target.runTarget!.generate('x', {
      requestContext: contextFor(CASE),
    } as never)) as unknown as { text: string };
    expect(JSON.parse(result.text)).toEqual({ a: 1 });
  });

  it('maps the case with inputOf when given', async () => {
    const call = jest.fn(() => Promise.resolve({}));
    const target = isolatedCallTarget<string, unknown>({
      agentKey: 'analysis-planner',
      sets: [SET],
      loadAgent: agent,
      call,
      inputOf: (evalCase) => `${evalCase.id}!`,
    });
    await target.runTarget!.generate('x', {
      requestContext: contextFor(CASE),
    } as never);
    expect(call).toHaveBeenCalledWith('example-plan!', expect.anything());
  });

  it("rejects with the call's error, so the case reports it as its error", async () => {
    const target = isolatedCallTarget<PlanInput, unknown>({
      agentKey: 'analysis-planner',
      sets: [SET],
      loadAgent: agent,
      call: () => Promise.reject(new Error('model unreachable')),
    });
    await expect(
      target.runTarget!.generate('x', {
        requestContext: contextFor(CASE),
      } as never),
    ).rejects.toThrow('model unreachable');
  });

  it('fails a case that carries no input, and a run without the case', async () => {
    const target = isolatedCallTarget<PlanInput, unknown>({
      agentKey: 'analysis-planner',
      sets: [SET],
      loadAgent: agent,
      call: () => Promise.resolve({}),
    });
    const bare = { ...CASE, input: undefined };
    await expect(
      target.runTarget!.generate('x', {
        requestContext: contextFor(bare),
      } as never),
    ).rejects.toThrow('Eval case "example-plan" has no input');
    await expect(
      target.runTarget!.generate('x', {
        requestContext: new RequestContext(),
      } as never),
    ).rejects.toThrow('An isolated-call case runs with its case');
  });

  it('loads the agent only when it is read, and keeps its own members', () => {
    const load = jest.fn(agent);
    const target = isolatedCallTarget<PlanInput, unknown>({
      agentKey: 'analysis-planner',
      sets: [SET],
      loadAgent: load,
      call: () => Promise.resolve({}),
    });
    expect(load).not.toHaveBeenCalled();
    expect((target.runTarget as unknown as { name: string }).name).toBe(
      'Olivia',
    );
    void target.agent;
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('reads a case input as given (caseInputOf)', () => {
    expect(caseInputOf<PlanInput>(CASE)).toEqual(CASE.input);
  });
});

describe('workflow step outputs (recordStepOutput)', () => {
  it('keeps the output of each step that succeeded or bailed, by its own id', () => {
    const steps: Record<string, unknown> = {};
    recordStepOutput(
      {
        type: 'workflow-step-result',
        payload: { id: 'question-path.plan', status: 'success', output: 1 },
      },
      steps,
    );
    recordStepOutput(
      {
        type: 'workflow-step-result',
        payload: { id: 'save-report', status: 'bailed', output: 2 },
      },
      steps,
    );
    recordStepOutput(
      { type: 'workflow-step-result', payload: { id: 'x', status: 'failed' } },
      steps,
    );
    recordStepOutput(
      { type: 'workflow-step-start', payload: { id: 'y', output: 3 } },
      steps,
    );
    expect(steps).toEqual({ plan: 1, 'save-report': 2 });
  });
});
