jest.mock('@mastra/core/evals', () => ({
  runEvals: jest.fn(() => Promise.resolve({ scores: {} })),
}));
jest.mock('@mastra/evals/checks', () => ({
  checks: new Proxy({}, { get: () => () => ({ id: 'stub-check' }) }),
}));
jest.mock('../agents/eval-judge.agent', () => ({
  evalJudgeAgent: {},
  evalJudgeOutputSchema: {},
}));
jest.mock('../model-resolver', () => ({
  resolveAgentModel: jest.fn(),
  resolveAgentModelConfig: jest.fn().mockResolvedValue('anthropic/claude-test'),
}));
const mockToolServices = {
  getDatasets: jest.fn(() => Promise.resolve([] as unknown[])),
  runReadOnlySql: jest.fn(),
};
jest.mock('../tool-services', () => ({
  getDatasetToolServices: () => mockToolServices,
}));
jest.mock('../../modules/sessions/turn-data', () => ({
  synthesizeToolOnlyTurn: jest.fn(),
  toolDataRecord: jest.fn(),
}));

import type { Agent } from '@mastra/core/agent';
import { runEvals } from '@mastra/core/evals';
import { appSkillBody } from '../app-skills';
import { evalJudgeAgent } from '../agents/eval-judge.agent';
import { EVAL_RUN_CONTEXT_KEY } from './eval-trace-marker';
import { currentEvalRunId } from './eval-run-scope';
import { EVAL_DETAILS_KEY, type EvalRunRecord } from './eval-details';
import { RESULT_SET_CHECK_ID } from './result-set-check';
import { synthesizeToolOnlyTurn } from '../../modules/sessions/turn-data';
import {
  judgePrompt,
  runAssistantEvalCase,
  type AssistantEvalCase,
  type EvalTarget,
} from './assistant.evals';

const BLOCK =
  'Curated dataset knowledge (user-authored — treat as authoritative over anything you infer from schema):\n- [instruction] Coverage: only 2018 and 2022.';

const evalCase: AssistantEvalCase = {
  id: 'demo',
  question: 'Who won in 2022?',
  intent: 'demo',
  scorers: [],
};

/** An agent's own target: its orientation, and the knowledge block. */
const target: EvalTarget = {
  agentKey: 'stub-agent',
  agent: { id: 'stub-agent' } as unknown as Agent,
  sets: [],
  orientation: ({ datasets }) =>
    `Datasets for this session: ${datasets.join(', ')}.`,
  sendsKnowledge: true,
};

/** The system messages the eval run sent with the question. */
function sentContext(): { role: string; content: string }[] {
  const [config] = (runEvals as jest.Mock).mock.calls.at(-1) as [
    { targetOptions: { context: { role: string; content: string }[] } },
  ];
  return config.targetOptions.context;
}

/** The requestContext the eval run sent with the question. */
function sentRequestContext(): {
  get(key: string): unknown;
  keys(): IterableIterator<string>;
} {
  const [config] = (runEvals as jest.Mock).mock.calls.at(-1) as [
    {
      data: {
        requestContext: {
          get(key: string): unknown;
          keys(): IterableIterator<string>;
        };
      }[];
    },
  ];
  return config.data[0].requestContext;
}

/** The next `runEvals` call hands back this target result. */
function nextTargetResult(targetResult: unknown): void {
  (runEvals as jest.Mock).mockImplementationOnce(
    (config: { onItemComplete(item: { targetResult: unknown }): void }) => {
      config.onItemComplete({ targetResult });
      return Promise.resolve({ scores: {} });
    },
  );
}

beforeEach(() => {
  (runEvals as jest.Mock).mockClear();
  mockToolServices.getDatasets.mockReset();
  mockToolServices.getDatasets.mockResolvedValue([]);
  mockToolServices.runReadOnlySql.mockReset();
});

describe('runAssistantEvalCase context (agents.md 4.1, 8.5)', () => {
  it('sends the knowledge block without the on-demand skill', async () => {
    const result = await runAssistantEvalCase(
      evalCase,
      ['World Cup Core'],
      target,
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
      await runAssistantEvalCase(evalCase, ['World Cup Core'], target, block);

      const contents = sentContext().map((message) => message.content);
      expect(contents).toHaveLength(1);
      expect(contents.join('\n')).not.toContain('Curated knowledge:');
    }
  });

  it('scopes the case to its datasets and question, with no host or visual keys (the eval host is gone)', async () => {
    await runAssistantEvalCase(evalCase, ['World Cup Core'], target);

    const context = sentRequestContext();
    expect([...context.keys()].sort()).toEqual([
      'datasets',
      'eval-case',
      'turn-question',
    ]);
    expect(context.get('datasets')).toEqual(['World Cup Core']);
    expect(context.get('turn-question')).toBe('Who won in 2022?');
  });
});

describe("the result-set check over a whole run's records (agents.md 8.1)", () => {
  const sqlCase: AssistantEvalCase = {
    ...evalCase,
    expectedSql: 'SELECT champion FROM world_cup.tournaments',
  };
  const answerRecord: EvalRunRecord = {
    tool: 'run_readonly_sql',
    input: "SELECT name AS champion FROM teams WHERE id = 'ARG'",
    rows: [{ champion: 'Argentina' }],
    rowCount: 1,
  };

  beforeEach(() => {
    mockToolServices.getDatasets.mockResolvedValue([
      { name: 'World Cup Core', datasourceId: 'wc', tables: [] },
    ]);
    mockToolServices.runReadOnlySql.mockResolvedValue({
      rows: [{ champion: 'Argentina' }],
      truncated: false,
    });
  });

  async function resultSetCheck(records?: EvalRunRecord[]) {
    nextTargetResult({
      text: 'Argentina won.',
      ...(records ? { [EVAL_DETAILS_KEY]: { records } } : {}),
    });
    const result = await runAssistantEvalCase(
      sqlCase,
      ['World Cup Core'],
      target,
    );
    return result.checkResults.find(
      (check) => check.id === RESULT_SET_CHECK_ID,
    );
  }

  it("passes when a stored record holds the reference rows (the run's records feed it)", async () => {
    await expect(
      resultSetCheck([
        { tool: 'list_entities', rows: [{ entity: 'teams' }] },
        answerRecord,
      ]),
    ).resolves.toMatchObject({ passed: true, score: 1 });
    expect(mockToolServices.runReadOnlySql).toHaveBeenCalledWith(
      'wc',
      sqlCase.expectedSql,
      500,
      ['World Cup Core'],
    );
  });

  it('fails when no stored record holds them', async () => {
    const check = await resultSetCheck([
      { ...answerRecord, rows: [{ champion: 'France' }] },
    ]);
    expect(check).toMatchObject({ passed: false });
    expect(check?.reason).toContain('none of 1 successful SQL result(s)');
  });

  it('fails on a stored record whose rows storage clipped', async () => {
    const check = await resultSetCheck([
      { ...answerRecord, rows: [], rowCount: 400, truncated: true },
    ]);
    expect(check?.reason).toContain('captured rows are missing or truncated');
  });

  it('says so when the run kept no query', async () => {
    const check = await resultSetCheck();
    expect(check).toMatchObject({
      passed: false,
      reason: 'the agent ran no successful run_readonly_sql to compare',
    });
  });
});

describe('eval trace marker (ADR-0054)', () => {
  it('sets the run id on the case request context', async () => {
    await runAssistantEvalCase(
      evalCase,
      ['World Cup Core'],
      target,
      undefined,
      'job-1',
    );

    expect(sentRequestContext().get(EVAL_RUN_CONTEXT_KEY)).toBe('job-1');
  });

  it('sets no marker without a run id', async () => {
    await runAssistantEvalCase(evalCase, ['World Cup Core'], target);

    expect(sentRequestContext().get(EVAL_RUN_CONTEXT_KEY)).toBeUndefined();
  });

  it('hands the judge the same request context', async () => {
    const generate = jest.fn().mockResolvedValue({
      object: { score: 1, reason: 'ok' },
    });
    (evalJudgeAgent as unknown as { generate: jest.Mock }).generate = generate;

    await runAssistantEvalCase(
      { ...evalCase, judgeRubric: 'Answers the question.' },
      ['World Cup Core'],
      target,
      undefined,
      'job-2',
    );

    expect(generate).toHaveBeenCalledTimes(1);
    const options = (generate.mock.calls as unknown[][])[0][1] as {
      requestContext: { get(key: string): unknown };
    };
    expect(options.requestContext).toBe(sentRequestContext());
    expect(options.requestContext.get(EVAL_RUN_CONTEXT_KEY)).toBe('job-2');
  });

  it("runs the target and the judge inside the run's scope, so a call that builds its own request context is marked too", async () => {
    const scopes: Record<string, string | undefined> = {};
    (runEvals as jest.Mock).mockImplementationOnce(() => {
      scopes.target = currentEvalRunId();
      return Promise.resolve({ scores: {} });
    });
    (evalJudgeAgent as unknown as { generate: jest.Mock }).generate = jest.fn(
      () => {
        scopes.judge = currentEvalRunId();
        return Promise.resolve({ object: { score: 1, reason: 'ok' } });
      },
    );

    await runAssistantEvalCase(
      { ...evalCase, judgeRubric: 'Answers the question.' },
      ['World Cup Core'],
      target,
      undefined,
      'job-3',
    );

    expect(scopes).toEqual({ target: 'job-3', judge: 'job-3' });
    expect(currentEvalRunId()).toBeUndefined();
  });

  it("runs the tool-only answer's synthesis inside the run's scope", async () => {
    let scope: string | undefined;
    nextTargetResult({
      text: '',
      steps: [
        {
          toolCalls: [{ payload: { toolName: 'sample_rows', args: {} } }],
          toolResults: [],
        },
      ],
    });
    jest.mocked(synthesizeToolOnlyTurn).mockImplementationOnce(() => {
      scope = currentEvalRunId();
      return Promise.resolve('synthesized');
    });

    const result = await runAssistantEvalCase(
      evalCase,
      ['World Cup Core'],
      target,
      undefined,
      'job-4',
    );

    expect(result.answer).toBe('synthesized');
    expect(scope).toBe('job-4');
  });

  it('opens no scope without a run id', async () => {
    let scope: string | undefined = 'unset';
    (runEvals as jest.Mock).mockImplementationOnce(() => {
      scope = currentEvalRunId();
      return Promise.resolve({ scores: {} });
    });

    await runAssistantEvalCase(evalCase, ['World Cup Core'], target);

    expect(scope).toBeUndefined();
  });
});

describe('judgePrompt (agents.md 8.1, 8.2)', () => {
  const judged: AssistantEvalCase = {
    ...evalCase,
    judgeRubric: 'RUBRIC',
  };
  const calls = [{ name: 'run_readonly_sql', input: 'SELECT 1', output: '1' }];

  it('keeps the prompt as it was for a target that reports no context', () => {
    expect(judgePrompt(judged, 'ANSWER', calls, 'Q?', [])).toBe(
      [
        'Question asked: Q?',
        '',
        'Rubric:',
        'RUBRIC',
        '',
        'Tool calls the assistant made, in order:',
        JSON.stringify([
          {
            name: 'run_readonly_sql',
            input: 'SELECT 1',
            output: '1',
            error: undefined,
          },
        ]),
        '',
        "Assistant's final answer to the user:",
        'ANSWER',
      ].join('\n'),
    );
  });

  it('puts the reported context in a section of its own before the tool calls', () => {
    const prompt = judgePrompt(
      judged,
      'ANSWER',
      calls,
      'Q?',
      [],
      'matches: home_penalties, away_penalties',
    );
    const heading =
      'Catalogue the assistant was given (entities and their columns):';
    expect(prompt).toContain(
      `${heading}\nmatches: home_penalties, away_penalties\n`,
    );
    expect(prompt.indexOf(heading)).toBeGreaterThan(prompt.indexOf('RUBRIC'));
    expect(prompt.indexOf(heading)).toBeLessThan(
      prompt.indexOf('Tool calls the assistant made, in order:'),
    );
  });
});
