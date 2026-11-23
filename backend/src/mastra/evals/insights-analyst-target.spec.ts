// The eval target of Insights Analyst runs Michael as Answer a Business
// Question (Avery + Michael) runs him when Avery calls answer_from_data
// (agents.md 8.1, 5.23): a stubbed agent and a stubbed catalog read.
import type { Agent } from '@mastra/core/agent';
import { RequestContext } from '@mastra/core/request-context';
import { analyseSystemBlocks } from '../workflows/analysis.prompts';
import {
  planCatalogBlock,
  type CatalogEntity,
} from '../workflows/analysis.steps';
import {
  MICHAEL_ALONE_LINE,
  michaelAloneRequest,
} from '../workflows/orchestrated-answer-michael.prompts';
import { evalDetailsOf } from './eval-details';
import { endsOnClarifyingQuestion } from './insights-analyst-eval-checks';
import {
  clarificationAnswer,
  lastUserText,
  michaelTurnAgent,
} from './insights-analyst-target';

const CATALOG: CatalogEntity[] = [
  {
    entity: 'world_cup.goals',
    dataset: 'World Cup',
    datasourceId: 'ds-pg',
    datasourceKind: 'postgres',
    columnCount: 2,
    dataEndsAt: null,
  },
];
const COLUMNS = [
  {
    entity: 'world_cup.goals',
    columns: [
      { name: 'player', type: 'text' },
      { name: 'goals', type: 'integer' },
    ],
    more: 0,
  },
];

/** One agent `generate` result: a step whose SQL call returned two rows. */
function agentResult(toolCalls: unknown[] = []) {
  return {
    text: 'Harry Kane scored the most goals: 6.',
    steps: [{ toolCalls }],
    toolResults: [],
    scoringData: { input: 'q', output: ['analyse messages'] },
  };
}

function setUp(result: Record<string, unknown> = agentResult()) {
  const generate = jest.fn<Promise<unknown>, [unknown, unknown]>(() =>
    Promise.resolve(result),
  );
  const agent = {
    id: 'insights-analyst',
    name: 'Insights Analyst',
    generate,
    getModel: jest.fn(() => 'model'),
  } as unknown as Agent;
  const loadCatalog = jest.fn<
    Promise<{ catalog: CatalogEntity[]; columns: typeof COLUMNS }>,
    [readonly string[]]
  >(() => Promise.resolve({ catalog: CATALOG, columns: COLUMNS }));
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
    target: michaelTurnAgent(agent, { loadCatalog }),
    agent,
    generate,
    loadCatalog,
    options,
    onStepFinish,
  };
}

const QUESTION = 'Who scored the most goals in 2018?';

describe('the insights-analyst eval target runs Michael as answer_from_data does (agents.md 8.1, 5.23)', () => {
  it("gives him the case's options, then the catalog block and his request on his own, the question as Avery's brief", async () => {
    const { target, generate, loadCatalog, options, onStepFinish } = setUp();
    const input = [{ role: 'user', content: QUESTION }];
    await target.generate(input as never, options as never);
    expect(loadCatalog).toHaveBeenCalledWith(['World Cup']);
    expect(generate).toHaveBeenCalledTimes(1);
    const [given, sent] = generate.mock.calls[0] as [
      unknown,
      Record<string, unknown>,
    ];
    expect(given).toBe(input);
    // The runner's own options pass through: its step budget and its hook.
    expect(sent['maxSteps']).toBe(15);
    expect(sent['onStepFinish']).toBe(onStepFinish);
    const catalogBlock = planCatalogBlock(CATALOG, COLUMNS, {
      question: QUESTION,
    });
    expect(sent['context']).toEqual([
      { role: 'system', content: 'Orientation.' },
      ...analyseSystemBlocks({
        catalogBlock,
        planBlock: michaelAloneRequest(QUESTION),
      }).map((content) => ({ role: 'system', content })),
    ]);
    const request = (sent['context'] as { content: string }[])[2].content;
    expect(request).toBe(
      `Brief from Avery, the Chief of Staff: ${QUESTION}\n\n${MICHAEL_ALONE_LINE}`,
    );
  });

  it('scores his reply as the answer, with his tool calls, and gives the judge the catalogue', async () => {
    const { target, options } = setUp();
    const result = (await target.generate(QUESTION, options as never)) as {
      text: string;
      steps: unknown[];
      scoringData: unknown;
    };
    expect(result.text).toBe('Harry Kane scored the most goals: 6.');
    expect(result.steps).toHaveLength(1);
    expect(result.scoringData).toEqual({
      input: 'q',
      output: ['analyse messages'],
    });
    expect(evalDetailsOf(result).judgeContext).toContain('world_cup.goals');
  });

  it('runs one attempt: a failed check is never retried by the target', async () => {
    const { target, generate, options } = setUp();
    await target.generate(QUESTION, options as never);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('scores his clarifying question as the question and its options, and passes the clarification check', async () => {
    const { target, options } = setUp(
      agentResult([
        {
          payload: {
            toolName: 'ask_clarification',
            args: {
              question: 'Which tournament?',
              options: '2018\n2022',
            },
          },
        },
      ]),
    );
    const result = (await target.generate(QUESTION, options as never)) as {
      text: string;
    };
    expect(result.text).toBe('Which tournament?\n- 2018\n- 2022');
    expect(
      endsOnClarifyingQuestion().run({
        answer: result.text,
        toolCalls: [],
        details: {},
      } as never),
    ).toBeUndefined();
  });

  it('fails the case when the agent fails, and needs a context', async () => {
    const { target, generate, options } = setUp();
    generate.mockRejectedValueOnce(new Error('model down'));
    await expect(target.generate(QUESTION, options as never)).rejects.toThrow(
      'model down',
    );
    await expect(target.generate(QUESTION, {} as never)).rejects.toThrow(
      'An eval case runs with a context',
    );
  });

  it('keeps every other member of the agent its own', () => {
    const { target, agent } = setUp();
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
