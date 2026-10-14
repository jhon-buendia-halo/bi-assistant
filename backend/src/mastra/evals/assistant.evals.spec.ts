jest.mock('@mastra/core/evals', () => ({
  runEvals: jest.fn(() => Promise.resolve({ scores: {} })),
}));
// The suite's cases are built at import; their scorers never run here.
jest.mock('@mastra/evals/checks', () => ({
  checks: new Proxy({}, { get: () => () => ({ id: 'stub-check' }) }),
}));
jest.mock('../agents/assistant.agent', () => ({ assistantAgent: {} }));
jest.mock('../agents/eval-judge.agent', () => ({
  evalJudgeAgent: {},
  evalJudgeOutputSchema: {},
}));
jest.mock('../model-resolver', () => ({ resolveAgentModel: jest.fn() }));
jest.mock('../tool-services', () => ({
  getDatasetToolServices: () => ({
    getDatasets: () => Promise.resolve([]),
  }),
}));
jest.mock('../../modules/sessions/turn-data', () => ({
  synthesizeToolOnlyTurn: jest.fn(),
  toolDataRecord: jest.fn(),
}));

import { runEvals } from '@mastra/core/evals';
import { appSkillBody } from '../app-skills';
import { ASSISTANT_EVAL_SETS, runAssistantEvalCase } from './assistant.evals';
import type { AssistantEvalCase } from './assistant.evals';

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
  const [config] = (runEvals as jest.Mock).mock.calls.at(-1) as [
    { targetOptions: { context: { role: string; content: string }[] } },
  ];
  return config.targetOptions.context;
}

beforeEach(() => {
  (runEvals as jest.Mock).mockClear();
});

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
  const [config] = (runEvals as jest.Mock).mock.calls.at(-1) as [
    { data: { requestContext: { get(key: string): unknown } }[] },
  ];
  return config.data[0].requestContext;
}

describe('tool selection in the eval cases (agents.md 8.1, ADR-0022)', () => {
  const setCases = (id: string) =>
    ASSISTANT_EVAL_SETS.find((set) => set.id === id)?.cases ?? [];

  it('has 12 World Cup cases, two of them with a tool selection', () => {
    const cases = setCases('world-cup');
    expect(cases).toHaveLength(12);
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

  it('derives the same 12 for the REST set, selections included', () => {
    const rest = setCases('world-cup-rest');
    expect(rest).toHaveLength(12);
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
