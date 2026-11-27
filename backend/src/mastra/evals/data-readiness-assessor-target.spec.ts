// The `data-readiness-assessor` target runs one whole run of Dana's
// conversation per case through the app's run service (agents.md 8.1):
// here the service and the readiness bridge are stand-ins, so no model,
// engine or store is used.
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

import type { Agent } from '@mastra/core/agent';
import { RequestContext } from '@mastra/core/request-context';
import type { ReadinessAssessment } from '../../modules/readiness-assessor/readiness.types';
import type { ReadinessToolServices } from '../readiness-tool-services';
import { DATASETS_CONTEXT_KEY } from '../tools/dataset-tool-context';
import { DATA_READINESS_ASSESSOR_WORKFLOW_ID } from '../workflows/conversation-turn.steps';
import {
  installAveryEvalRuns,
  type AveryEvalRuns,
  type StoredAveryRun,
} from './avery-workflow-target';
import {
  DATA_READINESS_ASSESSOR_EVAL_CASES,
  DATA_READINESS_ASSESSOR_EVAL_SET,
} from './data-readiness-assessor.evals';
import {
  DATA_READINESS_ASSESSOR_EVAL_TARGET,
  assessmentsOfRun,
  capturingAssessments,
  danaEvalRuns,
  danaRawToolCalls,
  danaTurnAgent,
  dataReadinessAssessorEvalTarget,
  type DanaRunView,
  type ReadinessBridge,
} from './data-readiness-assessor-target';
import { evalDetailsOf } from './eval-details';
import { EVAL_SETS, evalTargetFor, setsOfTarget } from './eval-sets';
import type { StoredInsightsLeadRun } from './insights-lead-target';

function assessment(
  over: Partial<ReadinessAssessment> = {},
): ReadinessAssessment {
  return {
    id: 'a-1',
    createdAt: '2026-11-26T08:00:00.000Z',
    rubricVersion: '1.0',
    useCaseKey: 'weekly revenue dashboard|Readiness Lab',
    sessionId: 'run-run-1',
    datasets: ['Readiness Lab'],
    scope: {
      useCase: 'Weekly revenue dashboard',
      useType: 'dashboard',
      risk: 'medium',
      entities: ['readiness_lab.readiness_lab.orders_crm'],
      criticalFields: [],
      personalDataNeeded: false,
      assumptions: [],
    },
    verdict: 'not-ready',
    weightedScore: 2.5,
    conditions: [],
    gates: [{ gate: 'G5', status: 'fail', reason: '', evidenceIds: ['EV-1'] }],
    dimensions: [],
    findings: [],
    evidence: [
      {
        id: 'EV-1',
        dimension: 'D2',
        description: 'Null rate of customer_id',
        source: 'sql',
        sql: 'SELECT 1',
        datasourceId: 'ds-secret',
        coverage: 'whole-table',
        result: { null_rate: 0.3 },
      },
    ],
    notEvaluated: [],
    escalations: [],
    ...over,
  };
}

const STORED: StoredInsightsLeadRun = {
  id: 'run-1',
  status: 'success',
  steps: [
    {
      id: 'answer',
      status: 'success',
      output: { answer: '## 1. Verdict\n**Not ready.**' },
      toolCalls: [
        { tool: 'describe_entity', input: 'readiness_lab.orders_crm' },
        { tool: 'assess_readiness' },
      ],
    },
  ],
  answer: {
    content: '## 1. Verdict\n**Not ready.**',
    data: [{ tool: 'run_readonly_sql', input: 'SELECT 1', rows: [{ n: 1 }] }],
  },
};

/** A bridge over an in-memory store, as SessionsService installs the real one. */
function memoryBridge() {
  const stored: ReadinessAssessment[] = [];
  let services: ReadinessToolServices = {
    previous: () => Promise.resolve(null),
    save: (a) => {
      stored.push(a);
      return Promise.resolve();
    },
  };
  const bridge: ReadinessBridge = {
    get: () => services,
    set: (next) => {
      services = next;
    },
  };
  return { bridge, stored };
}

const agent = { id: 'data-readiness-assessor', name: 'x' } as unknown as Agent;

function contextOf(datasets: string[]) {
  const requestContext = new RequestContext();
  requestContext.set(DATASETS_CONTEXT_KEY, datasets);
  return { requestContext };
}

describe('capturingAssessments', () => {
  it('collects what is saved while the run is in flight, and still stores it', async () => {
    const { bridge, stored } = memoryBridge();
    const { result, saved } = await capturingAssessments(async () => {
      await bridge.get().save(assessment());
      return 'done';
    }, bridge);
    expect(result).toBe('done');
    expect(saved.map((a) => a.id)).toEqual(['a-1']);
    expect(stored.map((a) => a.id)).toEqual(['a-1']);
    // After the run nothing more is captured, and the bridge is tapped once.
    const tapped = bridge.get();
    await bridge.get().save(assessment({ id: 'a-2' }));
    expect(saved).toHaveLength(1);
    await capturingAssessments(() => Promise.resolve(), bridge);
    expect(bridge.get()).toBe(tapped);
  });

  it("keeps the run's own assessments when the session names the run", () => {
    const mine = assessment({ id: 'mine', sessionId: 'run-run-1' });
    const other = assessment({ id: 'other', sessionId: 'run-run-9' });
    expect(assessmentsOfRun('run-1', [other, mine])).toEqual([mine]);
    const anonymous = assessment({ id: 'anon', sessionId: undefined });
    expect(assessmentsOfRun('run-1', [anonymous])).toEqual([anonymous]);
  });
});

describe('danaTurnAgent', () => {
  it('runs her whole conversation, reads the assessment it saved as the model read it, and deletes the run', async () => {
    const { bridge } = memoryBridge();
    const run = jest.fn(async () => {
      // The tool saves its assessment during the run.
      await bridge.get().save(assessment());
      return STORED;
    });
    const remove = jest.fn(() => Promise.resolve());
    const services: AveryEvalRuns = { run, remove };
    const turn = danaTurnAgent(agent, () => services, bridge);
    const result = (await turn.generate(
      [{ role: 'user', content: ' Is readiness_lab.orders_crm ready? ' }],
      contextOf(['Readiness Lab']) as never,
    )) as { text: string };

    expect(run).toHaveBeenCalledWith({
      question: 'Is readiness_lab.orders_crm ready?',
      datasets: ['Readiness Lab'],
    });
    expect(result.text).toBe('## 1. Verdict\n**Not ready.**');
    const view = evalDetailsOf(result).output as DanaRunView;
    expect(view.assessments).toHaveLength(1);
    expect(view.assessments[0]).toMatchObject({
      verdict: 'not-ready',
      gates: [{ gate: 'G5', status: 'fail' }],
    });
    // The model's projection: no datasource id, no use-case key.
    expect(JSON.stringify(view.assessments[0])).not.toContain('ds-secret');
    expect(view.assessments[0]).not.toHaveProperty('useCaseKey');
    expect(view.records).toEqual(STORED.answer!.data);
    expect(remove).toHaveBeenCalledWith('run-1');

    const raw = danaRawToolCalls(view);
    expect(raw.map((call) => call.name)).toEqual([
      'describe_entity',
      'assess_readiness',
    ]);
    expect(raw[1].output).toBe(view.assessments[0]);
  });

  it('scores a waiting run as her question with its options', async () => {
    const { bridge } = memoryBridge();
    const waiting = {
      ...STORED,
      status: 'suspended',
      steps: [{ id: 'answer', status: 'suspended', toolCalls: [] }],
      answer: undefined,
      waitingFor: { question: 'What is it for?', options: ['A', 'B'] },
    };
    const services: AveryEvalRuns = {
      run: () => Promise.resolve(waiting as unknown as StoredAveryRun),
      remove: () => Promise.resolve(),
    };
    const result = (await danaTurnAgent(agent, () => services, bridge).generate(
      'Is the Readiness Lab data ready?',
      contextOf(['Readiness Lab']) as never,
    )) as { text: string };
    expect(result.text).toBe('Dana asks the user:\nWhat is it for?\n- A\n- B');
    expect((evalDetailsOf(result).output as DanaRunView).assessments).toEqual(
      [],
    );
  });

  it('refuses a case without a dataset', async () => {
    const turn = danaTurnAgent(agent, () => {
      throw new Error('not reached');
    });
    await expect(turn.generate('q', contextOf([]) as never)).rejects.toThrow(
      'needs a dataset',
    );
  });

  it('serves her target from the run service installed at boot, on her workflow', async () => {
    const service = {
      prepare: jest.fn(() => Promise.resolve({})),
      stream: jest.fn(() => Promise.resolve({ id: 'run-2' } as StoredAveryRun)),
      delete: jest.fn(() => Promise.resolve()),
    };
    installAveryEvalRuns(service);
    await danaEvalRuns().run({ question: 'q', datasets: ['Readiness Lab'] });
    expect(service.prepare).toHaveBeenCalledWith(
      DATA_READINESS_ASSESSOR_WORKFLOW_ID,
      expect.anything(),
    );
    installAveryEvalRuns(undefined);
  });
});

describe('the data-readiness-assessor set', () => {
  it('is registered on its own target, on her agent key', () => {
    expect(EVAL_SETS).toContain(DATA_READINESS_ASSESSOR_EVAL_SET);
    expect(DATA_READINESS_ASSESSOR_EVAL_SET).toMatchObject({
      id: 'data-readiness-assessor',
      agentKey: 'data-readiness-assessor',
      target: DATA_READINESS_ASSESSOR_EVAL_TARGET,
      fixtureId: 'readiness-lab',
    });
    expect(setsOfTarget(DATA_READINESS_ASSESSOR_EVAL_TARGET)).toEqual([
      DATA_READINESS_ASSESSOR_EVAL_SET,
    ]);
    const target = evalTargetFor('data-readiness-assessor');
    expect(target.agentKey).toBe('data-readiness-assessor');
    expect(target.sets).toEqual([DATA_READINESS_ASSESSOR_EVAL_SET]);
    expect(target.sendsKnowledge).toBe(false);
  });

  it('builds a target whose run is the whole conversation', () => {
    const target = dataReadinessAssessorEvalTarget(
      [DATA_READINESS_ASSESSOR_EVAL_SET],
      () => agent,
    );
    expect(target.agent).toBe(agent);
    expect(target.runTarget).not.toBe(agent);
    expect(target.runTarget).toBe(target.runTarget);
  });

  it('holds the cases of source section 9, prefixed dra-, code-checked only', () => {
    expect(DATA_READINESS_ASSESSOR_EVAL_CASES.map((c) => c.id)).toEqual([
      'dra-clean-ready',
      'dra-null-customer-id',
      'dra-duplicate-grain',
      'dra-daily-over-weekly',
      'dra-hidden-pii-notes',
      'dra-pressure-mark-ready',
      'dra-injection-in-description',
      'dra-ml-not-evaluable',
      'dra-missing-scope',
    ]);
    for (const evalCase of DATA_READINESS_ASSESSOR_EVAL_CASES) {
      expect(evalCase.judgeRubric).toBeUndefined();
      const ids = (evalCase.customChecks ?? []).map((check) => check.id);
      expect(ids).toContain('no-personal-values');
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('states the use, freshness and owner in every scoped case, so scoping needs no question', () => {
    const scoped = DATA_READINESS_ASSESSOR_EVAL_CASES.filter(
      (c) => c.id !== 'dra-missing-scope',
    );
    for (const evalCase of scoped) {
      expect(evalCase.question).toMatch(/readiness_lab\.\w+/);
      expect(evalCase.question).toMatch(/at most (?:\d+|a week \(\d+) hours/);
      expect(evalCase.question).toContain('owned by the Sales data team');
      const ids = (evalCase.customChecks ?? []).map((check) => check.id);
      expect(ids).toEqual(
        expect.arrayContaining([
          'assessed',
          'verdict-quoted',
          'report-order',
          'run-status',
        ]),
      );
      expect(ids.some((id) => id.startsWith('gates-failed:'))).toBe(true);
    }
  });
});
