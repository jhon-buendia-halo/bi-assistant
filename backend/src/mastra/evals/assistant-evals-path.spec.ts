/**
 * Unit coverage for the dual-path eval plumbing (ADR-0007 §7, roadmap 1.2.2):
 * path selection (`model` default vs `legacy`), which agent each path
 * targets, and the `outsideModel` counter derived from a `run_raw_sql` tool
 * call. No LLM key is available in this environment, so every mastra/agent
 * dependency is stubbed — `runEvals` is the seam that stands in for an
 * actual model call, same as the other agent-touching specs in this repo
 * (see `sessions.service.spec.ts`'s header for the same pattern).
 *
 * Every import below that would otherwise drag `@mastra/core/agent`'s
 * ESM-only transitive deps into Jest's CommonJS runtime is mocked —
 * `@mastra/evals/checks` and `@mastra/core/evals` transitively pull the same
 * agent build `assistant.agent.spec.ts`'s header describes, so they need
 * mocking here too, not just the two agent files themselves.
 */
jest.mock('@mastra/evals/checks', () => ({
  checks: new Proxy({}, { get: () => jest.fn(() => ({})) }),
}));

/** The one shape `runAssistantEvalCase` actually calls `runEvals` with —
 * typed by hand (rather than imported from `@mastra/core/evals`, which this
 * file deliberately never loads for real) so the mock stays type-safe
 * without resorting to `any`. */
interface RunEvalsCall {
  target: unknown;
  targetOptions: { context: { role: string; content: string }[] };
  onItemComplete: (result: {
    targetResult: unknown;
    scorerResults: unknown;
  }) => void;
}
const runEvalsMock = jest.fn<
  Promise<{ scores: Record<string, number> }>,
  [RunEvalsCall]
>();
jest.mock('@mastra/core/evals', () => ({
  runEvals: (call: RunEvalsCall) => runEvalsMock(call),
}));
jest.mock('@mastra/core/request-context', () => ({
  RequestContext: class {
    private readonly values = new Map<string, unknown>();
    set(key: string, value: unknown) {
      this.values.set(key, value);
    }
    get(key: string) {
      return this.values.get(key);
    }
  },
}));
jest.mock('../agents/assistant.agent', () => ({
  assistantAgent: { id: 'assistant', __kind: 'model' },
}));
jest.mock('../agents/assistant-legacy.agent', () => ({
  assistantLegacyAgent: { id: 'assistant-legacy', __kind: 'legacy' },
}));
jest.mock('../agents/eval-judge.agent', () => ({
  evalJudgeAgent: { id: 'assistant-eval-judge' },
  evalJudgeOutputSchema: { safeParse: () => ({ success: false }) },
}));
jest.mock('../model-resolver', () => ({
  resolveAgentModel: jest.fn().mockResolvedValue('openai/gpt-4.1-mini'),
}));
jest.mock('./result-set-check', () => ({
  runResultSetCheck: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../modules/sessions/turn-data', () => ({
  synthesizeToolOnlyTurn: jest.fn().mockResolvedValue(''),
  toolDataRecord: jest.fn(() => null),
}));
const getDatasetsMock = jest.fn().mockResolvedValue([
  {
    name: 'World Cup',
    datasourceId: 'ds-1',
    datasourceKind: 'postgres',
    tables: ['t'],
  },
]);
const getSessionModelMock = jest.fn().mockResolvedValue({
  entities: [],
  relationships: [],
  metrics: [],
  notes: [],
});
jest.mock('../tool-services', () => ({
  getDatasetToolServices: () => ({
    getDatasets: getDatasetsMock,
    getSessionModel: getSessionModelMock,
  }),
}));

import { runAssistantEvalCase } from './assistant.evals';
import type { AssistantEvalCase } from './assistant.evals';

const evalCase: AssistantEvalCase = {
  id: 'c1',
  question: 'How many matches were played?',
  intent: 'count',
  scorers: () => [],
};

function mockRunEvalsOnce(
  toolCallNames: string[],
  answer = 'The answer',
): void {
  runEvalsMock.mockImplementationOnce(({ onItemComplete }) => {
    onItemComplete({
      targetResult: {
        text: answer,
        steps: [
          {
            toolCalls: toolCallNames.map((name, i) => ({
              payload: { toolCallId: `call-${i}`, toolName: name, args: {} },
            })),
            toolResults: toolCallNames.map((_name, i) => ({
              payload: { toolCallId: `call-${i}`, result: {} },
            })),
          },
        ],
      },
      scorerResults: {},
    });
    return Promise.resolve({ scores: {} });
  });
}

describe('runAssistantEvalCase — path selection', () => {
  beforeEach(() => jest.clearAllMocks());

  it('defaults to the "model" path and targets the current assistant', async () => {
    mockRunEvalsOnce([]);
    const result = await runAssistantEvalCase(evalCase, ['World Cup']);
    expect(result.path).toBe('model');
    expect(getSessionModelMock).toHaveBeenCalledWith(['World Cup']);
    const call = runEvalsMock.mock.calls[0][0];
    expect(call.target).toEqual({ id: 'assistant', __kind: 'model' });
  });

  it('targets the legacy assistant and skips the model block when path is "legacy"', async () => {
    mockRunEvalsOnce([]);
    const result = await runAssistantEvalCase(
      evalCase,
      ['World Cup'],
      undefined,
      undefined,
      { path: 'legacy', metricsBlock: 'Governed metric definitions' },
    );
    expect(result.path).toBe('legacy');
    expect(getSessionModelMock).not.toHaveBeenCalled();
    const call = runEvalsMock.mock.calls[0][0];
    expect(call.target).toEqual({ id: 'assistant-legacy', __kind: 'legacy' });
    const contents = call.targetOptions.context.map((c) => c.content);
    expect(
      contents.some((c) => c.includes('Governed metric definitions')),
    ).toBe(true);
  });

  it('counts the case as outside the model when run_raw_sql was called', async () => {
    mockRunEvalsOnce(['run_raw_sql']);
    const result = await runAssistantEvalCase(evalCase, ['World Cup']);
    expect(result.outsideModel).toBe(true);
  });

  it('never flags a turn that stayed on query_entities as outside the model', async () => {
    mockRunEvalsOnce(['query_entities']);
    const result = await runAssistantEvalCase(evalCase, ['World Cup']);
    expect(result.outsideModel).toBe(false);
  });
});
