// The `insights-lead` target runs one whole conversation run per case
// through the app's run service (agents.md 8.1): here the service is a
// stand-in, so no model, engine or store is used.
jest.mock('@mastra/core/evals', () => ({ runEvals: jest.fn() }));
jest.mock('@mastra/evals/checks', () => ({
  checks: new Proxy({}, { get: () => () => ({ id: 'stub-check' }) }),
}));
jest.mock('../agents/assistant.agent', () => ({ assistantAgent: {} }));
jest.mock('../agents/data-readiness.agent', () => ({
  dataReadinessAgent: { id: 'data-readiness' },
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

import { readFileSync } from 'fs';
import { join } from 'path';
import type { Agent } from '@mastra/core/agent';
import { RequestContext } from '@mastra/core/request-context';
import { INSIGHTS_LEAD_WORKFLOW_ID } from '../workflows/conversation-turn.steps';
import { DATASETS_CONTEXT_KEY } from '../tools/dataset-tool-context';
import { AVERY_CASE_SOURCES, AVERY_EVAL_SET } from './avery-workflow.evals';
import {
  AVERY_WORKFLOW_ID,
  installAveryEvalRuns,
  workflowEvalRunsOf,
  type AveryEvalRuns,
  type StoredAveryRun,
} from './avery-workflow-target';
import { evalDetailsOf } from './eval-details';
import { EVAL_SETS, evalTargetFor, setsOfTarget } from './eval-sets';
import {
  INSIGHTS_LEAD_EVAL_CASES,
  INSIGHTS_LEAD_EVAL_SET,
} from './insights-lead.evals';
import {
  INSIGHTS_LEAD_EVAL_TARGET,
  insightsLeadEvalRuns,
  insightsLeadEvalTarget,
  insightsLeadRunView,
  insightsLeadScoredAnswer,
  insightsLeadTurnAgent,
  type InsightsLeadRunView,
  type StoredInsightsLeadRun,
} from './insights-lead-target';

const stored = JSON.parse(
  readFileSync(
    join(__dirname, '__fixtures__', 'insights-lead-run.json'),
    'utf8',
  ),
) as StoredInsightsLeadRun;

describe('insightsLeadRunView', () => {
  it('reads the answer step: answer, calls, the stored rows and checks', () => {
    const view = insightsLeadRunView(stored);
    expect(view.status).toBe('success');
    expect(view.answer).toContain('Web Shop Americas');
    expect(view.calls.map((call) => call.tool)).toEqual([
      'run_readonly_sql',
      'run_readonly_sql',
      'run_readonly_sql',
    ]);
    expect(view.calls[0]).toMatchObject({ rowCount: 1 });
    expect(view.rows.length).toBeGreaterThan(5);
    expect(view.checks).toHaveLength(1);
    expect(view.attempts).toBe(1);
    expect(view.waitingFor).toBeUndefined();
  });

  it('reads a repair round from the step output’s attempts', () => {
    const run: StoredInsightsLeadRun = {
      ...stored,
      steps: [
        {
          ...stored.steps[0],
          output: { ...stored.steps[0].output, attempts: 2 },
        },
      ],
    };
    expect(insightsLeadRunView(run).attempts).toBe(2);
  });

  it('keeps the question a suspended run waits for', () => {
    const run: StoredInsightsLeadRun = {
      id: 'r',
      status: 'suspended',
      steps: [{ id: 'answer', toolCalls: [] }],
      waitingFor: { question: 'Which reading?', options: ['Champion', 'Wins'] },
    };
    const view = insightsLeadRunView(run);
    expect(view.waitingFor?.options).toEqual(['Champion', 'Wins']);
    expect(insightsLeadScoredAnswer(view)).toBe(
      'Insights Lead asks the user:\nWhich reading?\n- Champion\n- Wins',
    );
  });

  it('falls back to the stored answer when the step has no output', () => {
    const run: StoredInsightsLeadRun = {
      id: 'r',
      status: 'success',
      steps: [{ id: 'answer' }],
      answer: { content: ' Done. ' },
    };
    expect(insightsLeadRunView(run).answer).toBe('Done.');
  });
});

describe('workflowEvalRunsOf for her workflow', () => {
  it('prepares the run of agent:insights-lead, not Avery’s', async () => {
    const service = {
      prepare: jest.fn(() => Promise.resolve({})),
      stream: jest.fn(() => Promise.resolve({ id: 'run-1' } as StoredAveryRun)),
      delete: jest.fn(() => Promise.resolve()),
    };
    const input = { question: 'q', datasets: ['World Cup'] };
    await workflowEvalRunsOf(service, INSIGHTS_LEAD_WORKFLOW_ID).run(input);
    expect(service.prepare).toHaveBeenCalledWith(INSIGHTS_LEAD_WORKFLOW_ID, {
      input,
    });
    await workflowEvalRunsOf(service, AVERY_WORKFLOW_ID).run(input);
    expect(service.prepare).toHaveBeenLastCalledWith(AVERY_WORKFLOW_ID, {
      input,
    });
  });

  it('serves her target from the service installed at boot', async () => {
    const service = {
      prepare: jest.fn(() => Promise.resolve({})),
      stream: jest.fn(() => Promise.resolve({ id: 'run-2' } as StoredAveryRun)),
      delete: jest.fn(() => Promise.resolve()),
    };
    installAveryEvalRuns(service);
    await insightsLeadEvalRuns().run({ question: 'q', datasets: ['d'] });
    expect(service.prepare).toHaveBeenCalledWith(
      INSIGHTS_LEAD_WORKFLOW_ID,
      expect.anything(),
    );
    installAveryEvalRuns(undefined);
    expect(() => insightsLeadEvalRuns()).toThrow(/run service/);
  });
});

describe('insightsLeadTurnAgent', () => {
  const agent = { id: 'insights-lead', name: 'x' } as unknown as Agent;

  function contextOf(datasets: string[]) {
    const requestContext = new RequestContext();
    requestContext.set(DATASETS_CONTEXT_KEY, datasets);
    return { requestContext };
  }

  it('runs the whole conversation, reads the run and deletes it', async () => {
    const run = jest.fn(() => Promise.resolve(stored));
    const remove = jest.fn(() => Promise.resolve());
    const services: AveryEvalRuns = { run, remove };
    const turn = insightsLeadTurnAgent(agent, () => services);
    const result = (await turn.generate(
      [{ role: 'user', content: ' Which store had the highest sales? ' }],
      contextOf(['Retail Ops']) as never,
    )) as { text: string };
    expect(run).toHaveBeenCalledWith({
      question: 'Which store had the highest sales?',
      datasets: ['Retail Ops'],
    });
    expect(result.text).toContain('Web Shop Americas');
    const details = evalDetailsOf(result);
    expect((details?.output as InsightsLeadRunView).runId).toBe(stored.id);
    expect(remove).toHaveBeenCalledWith(stored.id);
  });

  it('refuses a case without a dataset', async () => {
    const turn = insightsLeadTurnAgent(agent, () => {
      throw new Error('not reached');
    });
    await expect(turn.generate('q', contextOf([]) as never)).rejects.toThrow(
      'needs a dataset',
    );
  });
});

describe('the insights-lead set', () => {
  it('is registered on its own target, on her agent key', () => {
    expect(EVAL_SETS).toContain(INSIGHTS_LEAD_EVAL_SET);
    expect(INSIGHTS_LEAD_EVAL_SET.target).toBe(INSIGHTS_LEAD_EVAL_TARGET);
    expect(setsOfTarget(INSIGHTS_LEAD_EVAL_TARGET)).toEqual([
      INSIGHTS_LEAD_EVAL_SET,
    ]);
    const target = evalTargetFor('insights-lead');
    expect(target.agentKey).toBe('insights-lead');
    expect(target.sets).toEqual([INSIGHTS_LEAD_EVAL_SET]);
    expect(target.sendsKnowledge).toBe(false);
  });

  it('builds a target whose run is the whole conversation', () => {
    const agent = { id: 'insights-lead' } as unknown as Agent;
    const target = insightsLeadEvalTarget(
      [INSIGHTS_LEAD_EVAL_SET],
      () => agent,
    );
    expect(target.agent).toBe(agent);
    expect(target.runTarget).not.toBe(agent);
    expect(target.runTarget).toBe(target.runTarget);
  });

  it('holds Avery’s eight cases, same questions and intents, ids ending -elena', () => {
    expect(INSIGHTS_LEAD_EVAL_SET.fixtureId).toBe(AVERY_EVAL_SET.fixtureId);
    expect(INSIGHTS_LEAD_EVAL_CASES).toHaveLength(8);
    INSIGHTS_LEAD_EVAL_CASES.forEach((evalCase, index) => {
      const source = AVERY_CASE_SOURCES[index];
      expect(evalCase.id).toMatch(/-elena$/);
      expect(evalCase.id).not.toMatch(/^avery-/);
      expect(evalCase.question).toBe(source.question);
      expect(evalCase.intent).toBe(source.intent);
      expect(Boolean(evalCase.judgeRubric)).toBe(Boolean(source.body));
    });
    expect(new Set(INSIGHTS_LEAD_EVAL_CASES.map((c) => c.id)).size).toBe(8);
  });

  it('shares Avery’s text checks and her rules, and names no Michael or Avery in a rubric', () => {
    for (const evalCase of INSIGHTS_LEAD_EVAL_CASES) {
      const ids = (evalCase.customChecks ?? []).map((check) => check.id);
      expect(ids).toEqual(
        expect.arrayContaining([
          'ran-a-query',
          'asks-at-most-once',
          'only-her-tools',
          'run-status',
          'figures-from-queries',
          'repair-at-most-once',
        ]),
      );
      if (evalCase.judgeRubric) {
        expect(evalCase.judgeRubric).not.toMatch(/Michael|Avery|closing/);
        expect(evalCase.judgeRubric.match(/pass=true only if/g)).toHaveLength(
          1,
        );
      }
    }
    const best = INSIGHTS_LEAD_EVAL_CASES.find((c) =>
      c.id.includes('ambiguous'),
    )!;
    expect(best.customChecks?.map((c) => c.id)).toContain(
      'clarification-options',
    );
    expect(best.judgeRubric).toContain('"Elena asks the user:"');
  });

  it('leaves Avery’s own cases and rubrics as they were', () => {
    expect(AVERY_EVAL_SET.cases).toHaveLength(8);
    expect(AVERY_EVAL_SET.cases[0].judgeRubric).toMatch(
      /^The final answer shows Michael's answer/,
    );
    expect(AVERY_EVAL_SET.cases[2].judgeRubric).toMatch(
      /^The final answer is either Avery's question/,
    );
  });
});
