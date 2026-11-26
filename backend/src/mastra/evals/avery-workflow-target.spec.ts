// The `avery-michael-workflow` target runs one whole workflow run per case
// through the app's run service (agents.md 8.1, 5.23): here the service is
// a stand-in, so no model, engine or store is used.
jest.mock('@mastra/core/evals', () => ({ runEvals: jest.fn() }));
jest.mock('@mastra/evals/checks', () => ({
  checks: new Proxy({}, { get: () => () => ({ id: 'stub-check' }) }),
}));
jest.mock('../agents/insights-analyst.agent', () => ({
  insightsAnalystAgent: { id: 'insights-analyst' },
}));
jest.mock('../agents/query-explainer.agent', () => ({
  queryExplainerAgent: { id: 'query-explainer' },
  explainQueryWithModel: jest.fn(),
}));
jest.mock('../agents/result-explorer.agent', () => ({
  resultExplorerAgent: { id: 'result-explorer' },
  interpretResultWithModel: jest.fn(),
}));
jest.mock('../agents/eval-judge.agent', () => ({
  evalJudgeAgent: {},
  evalJudgeOutputSchema: {},
}));
jest.mock('../model-resolver', () => ({ resolveAgentModel: jest.fn() }));
jest.mock('../../modules/sessions/turn-data', () => ({
  synthesizeToolOnlyTurn: jest.fn(),
  toolDataRecord: jest.fn(),
}));

import type { Agent } from '@mastra/core/agent';
import { RequestContext } from '@mastra/core/request-context';
import { DATASETS_CONTEXT_KEY } from '../tools/dataset-tool-context';
import { evalDetailsOf } from './eval-details';
import { AVERY_EVAL_SET } from './avery-workflow.evals';
import {
  AVERY_WORKFLOW_EVAL_TARGET,
  AVERY_WORKFLOW_ID,
  STORED_REPLY_CAP,
  averyEvalRunsOf,
  averyRunView,
  averyWorkflowEvalTarget,
  averyWorkflowTurnAgent,
  splitClosing,
  type AveryEvalRuns,
  type AveryRunCall,
  type AveryRunView,
  type StoredAveryRun,
} from './avery-workflow-target';
import { EVAL_SETS, evalTargetFor, setsOfTarget } from './eval-sets';

const MICHAEL = '**24 goals were scored at the 2022 World Cup.**';
const CLOSING = 'That is 24 goals over the 8 matches in the data.';

const brief = (reply: string): AveryRunCall => ({
  tool: 'answer_from_data',
  agent: 'chief-of-staff',
  input: 'How many goals were scored at the 2022 World Cup?',
  reply,
});

function storedRun(overrides: Partial<StoredAveryRun> = {}): StoredAveryRun {
  return {
    id: 'run-7',
    status: 'success',
    steps: [
      {
        id: 'orchestrate',
        output: { answer: `${MICHAEL}\n\n${CLOSING}` },
        toolCalls: [
          { tool: 'skill', input: 'avery-playbooks', agent: 'chief-of-staff' },
          { ...brief(MICHAEL), teammate: 'insights-analyst' },
          {
            tool: 'run_readonly_sql',
            input: 'SELECT count(*) FROM world_cup.goals',
            rowCount: 1,
          },
        ],
      },
    ],
    answer: {
      // The stored message links its figures; the step output does not.
      content: `**[24](query:Q1) goals were scored.**\n\n${CLOSING}`,
      data: [{ tool: 'run_readonly_sql', rows: [{ goals: 24 }] }],
    },
    ...overrides,
  };
}

function context(datasets: string[] = ['World Cup']): RequestContext {
  const requestContext = new RequestContext();
  requestContext.set(DATASETS_CONTEXT_KEY, datasets);
  return requestContext;
}

function fakeRuns(run: StoredAveryRun = storedRun()) {
  const services = {
    run: jest.fn<Promise<StoredAveryRun>, [unknown]>(() =>
      Promise.resolve(run),
    ),
    remove: jest.fn<Promise<void>, [string]>(() => Promise.resolve()),
  };
  // Kept as mocks for the assertions; the target takes them as AveryEvalRuns.
  return services satisfies AveryEvalRuns;
}

const agent = {
  id: 'chief-of-staff',
  name: 'Chief of Staff',
} as unknown as Agent;

describe('splitClosing', () => {
  it('takes his reply off the front of the answer', () => {
    expect(
      splitClosing(`${MICHAEL}\n\n${CLOSING}`, [
        brief('first try'),
        brief(MICHAEL),
      ]),
    ).toEqual({ michaelAnswer: MICHAEL, closing: CLOSING });
  });

  it('is her words alone when he wrote no answer', () => {
    expect(splitClosing(CLOSING, [])).toEqual({
      michaelAnswer: '',
      closing: CLOSING,
    });
  });

  it('is the last paragraph when the store cut his reply', () => {
    const long = `${'Goals by match. '.repeat(200)}\n\nMore rows.`;
    const capped = long.slice(0, STORED_REPLY_CAP);
    expect(splitClosing(`${long}\n\n${CLOSING}`, [brief(capped)])).toEqual({
      michaelAnswer: long.trim(),
      closing: CLOSING,
    });
  });
});

describe('averyRunView', () => {
  it('reads the step output’s answer, her calls and his rows', () => {
    const view = averyRunView(storedRun());
    expect(view).toEqual<AveryRunView>({
      runId: 'run-7',
      status: 'success',
      answer: `${MICHAEL}\n\n${CLOSING}`,
      michaelAnswer: MICHAEL,
      closing: CLOSING,
      calls: [
        { tool: 'skill', agent: 'chief-of-staff', input: 'avery-playbooks' },
        brief(MICHAEL),
        {
          tool: 'run_readonly_sql',
          input: 'SELECT count(*) FROM world_cup.goals',
          rowCount: 1,
        },
      ],
      rows: [{ goals: 24 }],
    });
  });

  it('keeps what a waiting run asks, and no closing', () => {
    const view = averyRunView(
      storedRun({
        status: 'suspended',
        steps: [{ id: 'orchestrate', status: 'suspended' }],
        answer: undefined,
        waitingFor: {
          question: 'Which reading of best?',
          options: ['The champion', 'The most wins'],
        },
      }),
    );
    expect(view.waitingFor).toEqual({
      question: 'Which reading of best?',
      options: ['The champion', 'The most wins'],
    });
    expect(view.closing).toBe('');
  });
});

describe('averyWorkflowTurnAgent', () => {
  it('runs the case’s question on the run’s datasets, scores the run and deletes it', async () => {
    const runs = fakeRuns();
    const turn = averyWorkflowTurnAgent(agent, () => runs);
    const result = (await turn.generate(
      'How many goals were scored at the 2022 World Cup?  ',
      { requestContext: context() } as never,
    )) as unknown as Record<string, unknown>;
    expect(runs.run).toHaveBeenCalledWith({
      question: 'How many goals were scored at the 2022 World Cup?',
      datasets: ['World Cup'],
    });
    expect(runs.remove).toHaveBeenCalledWith('run-7');
    expect(result['text']).toBe(
      `Michael's answer:\n${MICHAEL}\n\nAvery's closing:\n${CLOSING}`,
    );
    const view = evalDetailsOf(result).output as AveryRunView;
    expect(view.closing).toBe(CLOSING);
    const step = (result['steps'] as Record<string, unknown[]>[])[0];
    expect(step['toolCalls']).toHaveLength(3);
    expect(step['toolCalls'][1]).toEqual({
      payload: {
        toolCallId: 'avery-run-call-2',
        toolName: 'answer_from_data',
        args: {
          by: 'chief-of-staff',
          input: 'How many goals were scored at the 2022 World Cup?',
        },
      },
    });
    expect(step['toolResults'][1]).toEqual({
      payload: {
        toolCallId: 'avery-run-call-2',
        toolName: 'answer_from_data',
        result: MICHAEL,
      },
    });
    // Michael's own calls are his.
    expect(
      (step['toolCalls'][2] as { payload: { args: unknown } }).payload.args,
    ).toEqual({
      by: 'insights-analyst',
      input: 'SELECT count(*) FROM world_cup.goals',
    });
  });

  it('scores a waiting run as her question with its options', async () => {
    const runs = fakeRuns(
      storedRun({
        status: 'suspended',
        waitingFor: { question: 'Best by what?', options: ['Titles', 'Wins'] },
      }),
    );
    const result = (await averyWorkflowTurnAgent(agent, () => runs).generate(
      'Which team had the best World Cup?',
      { requestContext: context() } as never,
    )) as unknown as Record<string, unknown>;
    expect(result['text']).toBe(
      'Avery asks the user:\nBest by what?\n- Titles\n- Wins',
    );
    expect(runs.remove).toHaveBeenCalledWith('run-7');
  });

  it('refuses a case without a dataset, before any run', async () => {
    const runs = fakeRuns();
    await expect(
      averyWorkflowTurnAgent(agent, () => runs).generate('q', {
        requestContext: context([]),
      } as never),
    ).rejects.toThrow('An Avery + Michael case needs a dataset');
    expect(runs.run).not.toHaveBeenCalled();
  });
});

describe('averyEvalRunsOf', () => {
  it('prepares and streams the workflow as the run route does', async () => {
    const prepared = { workflow: 'prepared' };
    const service = {
      prepare: jest.fn(() => Promise.resolve(prepared)),
      stream: jest.fn(
        (
          _p: unknown,
          emit: (event: { type: string; runId?: string }) => void,
        ) => {
          emit({ type: 'run', runId: 'run-9' });
          return Promise.resolve(storedRun({ id: 'run-9' }));
        },
      ),
      delete: jest.fn(() => Promise.resolve()),
    };
    const runs = averyEvalRunsOf(service);
    const input = { question: 'How many goals?', datasets: ['World Cup'] };
    await expect(runs.run(input)).resolves.toMatchObject({ id: 'run-9' });
    expect(service.prepare).toHaveBeenCalledWith(AVERY_WORKFLOW_ID, { input });
    expect(service.stream.mock.calls[0][0]).toBe(prepared);
    expect(service.delete).not.toHaveBeenCalled();
    await runs.remove('run-9');
    expect(service.delete).toHaveBeenCalledWith('run-9');
  });

  it('deletes a stored run whose stream threw, and rethrows', async () => {
    const service = {
      prepare: jest.fn(() => Promise.resolve({})),
      stream: jest.fn(
        (
          _p: unknown,
          emit: (event: { type: string; runId?: string }) => void,
        ) => {
          emit({ type: 'run', runId: 'run-10' });
          return Promise.reject(new Error('host lost'));
        },
      ),
      delete: jest.fn(() => Promise.resolve()),
    };
    await expect(
      averyEvalRunsOf(service).run({ question: 'q', datasets: ['World Cup'] }),
    ).rejects.toThrow('host lost');
    expect(service.delete).toHaveBeenCalledWith('run-10');
  });
});

describe('the avery-michael-workflow set', () => {
  it('is registered on its own target, on Avery’s agent key', () => {
    expect(EVAL_SETS).toContain(AVERY_EVAL_SET);
    expect(AVERY_EVAL_SET.target).toBe(AVERY_WORKFLOW_EVAL_TARGET);
    expect(setsOfTarget(AVERY_WORKFLOW_EVAL_TARGET)).toEqual([AVERY_EVAL_SET]);
    const target = evalTargetFor('chief-of-staff');
    expect(target.agentKey).toBe('chief-of-staff');
    expect(target.sets).toEqual([AVERY_EVAL_SET]);
    expect(target.sendsKnowledge).toBe(false);
  });

  it('builds a target whose run is the whole workflow', () => {
    const target = averyWorkflowEvalTarget([AVERY_EVAL_SET], () => agent);
    expect(target.agent).toBe(agent);
    expect(target.runTarget).not.toBe(agent);
    expect(target.runTarget).toBe(target.runTarget);
  });

  it('holds the eight cases on the World Cup sample, judged only where code cannot decide', () => {
    expect(AVERY_EVAL_SET.fixtureId).toBe('world-cup');
    expect(AVERY_EVAL_SET.cases.map((c) => c.id)).toEqual([
      'avery-ranking-tie-top-3-scorers-2022',
      'avery-period-change-goals-2018-2022',
      'avery-ambiguous-best-team',
      'avery-no-rows-free-kick-goals-2022',
      'avery-false-premise-goals-drop-2022',
      'avery-partial-coverage-all-champions',
      'avery-simple-attendance-2022-final',
      'avery-unanswerable-ticket-prices-2022-final',
    ]);
    const judged = AVERY_EVAL_SET.cases.filter((c) => c.judgeRubric);
    expect(judged).toHaveLength(7);
    for (const evalCase of judged) {
      // One pass condition each.
      expect(evalCase.judgeRubric!.match(/pass=true only if/g)).toHaveLength(1);
    }
    for (const evalCase of AVERY_EVAL_SET.cases) {
      const ids = (evalCase.customChecks ?? []).map((check) => check.id);
      expect(ids).toEqual(
        expect.arrayContaining(['answer-from-data-calls', 'run-status']),
      );
    }
  });
});
