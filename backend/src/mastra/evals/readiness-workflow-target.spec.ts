// The Assess Data Readiness eval target runs the whole workflow (agents.md
// 8.1): the real workflow definition, on the engine stand-in (the real
// engine is ESM-only for Jest), with a stubbed assessment, SQL and agent.
// No model is called.
jest.mock('@mastra/core/workflows', () =>
  jest.requireActual<typeof import('../testing/workflows.stub')>(
    '../testing/workflows.stub',
  ),
);
// What the eval catalogue loads at import; none of it runs here.
jest.mock('@mastra/core/evals', () => ({ runEvals: jest.fn() }));
jest.mock('@mastra/evals/checks', () => ({
  checks: new Proxy({}, { get: () => () => ({ id: 'stub-check' }) }),
}));
jest.mock('../agents/assistant.agent', () => ({ assistantAgent: {} }));
jest.mock('../agents/data-readiness.agent', () => ({
  dataReadinessAgent: { id: 'data-readiness' },
}));
jest.mock('../agents/eval-judge.agent', () => ({
  evalJudgeAgent: {},
  evalJudgeOutputSchema: {},
}));
jest.mock('../model-resolver', () => ({ resolveAgentModel: jest.fn() }));

import type { Agent } from '@mastra/core/agent';
import { RequestContext } from '@mastra/core/request-context';
import { dataReadinessAssessmentWorkflow } from '../workflows/data-readiness-assessment.workflow';
import { ASSESSED_REPORT_CONTEXT_KEY } from '../readiness-tool-services';
import { evalDetailsOf } from './eval-details';
import {
  readinessWorkflowEvalTarget,
  readinessWorkflowTurnAgent,
  type ReadinessWorkflowParts,
} from './readiness-workflow-target';
import type { AssistantEvalSet } from './assistant.evals';

const DIMENSIONS = [
  {
    dimension: 'completeness',
    score: 62,
    assessed: true,
    findingCount: 3,
    maxSeverity: 'high',
    totalChecks: 10,
  },
  {
    dimension: 'accuracy',
    score: 100,
    assessed: false,
    findingCount: 0,
    maxSeverity: null,
    totalChecks: 0,
  },
];

const SUMMARY = {
  reportId: 'rep-1',
  datasourceName: 'Edge Cases PostgreSQL',
  generatedAt: '2026-11-16T00:00:00.000Z',
  entityCount: 19,
  overallScore: 71,
  maturity: 'developing',
  dimensionScores: DIMENSIONS,
  findingCount: 3,
  topFindings: [],
};

function setUp(config: { failProfile?: boolean } = {}) {
  const generate = jest.fn((_input: unknown, opts: Record<string, unknown>) => {
    const requestContext = opts['requestContext'] as RequestContext;
    return Promise.resolve({
      text: `  The data scores 71 (report ${String(requestContext.get(ASSESSED_REPORT_CONTEXT_KEY))}).  `,
      toolCalls: [{ payload: { toolName: 'get_readiness_report' } }],
      toolResults: [],
      steps: [],
      scoringData: { input: 'q', output: ['explain messages'] },
    });
  });
  const agent = {
    id: 'data-readiness',
    name: 'Sarah',
    generate,
    getModel: jest.fn(() => 'model'),
  } as unknown as Agent;
  const assessment = {
    dataset: 'Edge Cases',
    datasourceName: 'Edge Cases PostgreSQL',
    datasourceKind: 'postgres' as const,
    tableCount: 19,
    profile: jest.fn(() =>
      config.failProfile
        ? Promise.reject(new Error('Could not reach "Edge Cases PostgreSQL"'))
        : Promise.resolve({
            entityCount: 19,
            relationshipCount: 12,
            notProfiledCount: 0,
          }),
    ),
    score: jest.fn(() => SUMMARY),
    save: jest.fn(() =>
      Promise.resolve({
        report: {
          id: 'rep-1',
          datasourceId: 'ds-edge',
          datasourceKind: 'postgres',
          findings: [],
        },
        summary: SUMMARY,
      }),
    ),
  };
  const parts = {
    workflow:
      dataReadinessAssessmentWorkflow as unknown as ReadinessWorkflowParts['workflow'],
    startAssessment: jest.fn(() => Promise.resolve(assessment)),
    runSql: jest.fn(),
    recordFindingSources: jest.fn(
      (
        input: Parameters<ReadinessWorkflowParts['recordFindingSources']>[0],
      ) => {
        input.record(
          {
            sql: 'SELECT * FROM edge_cases.customers WHERE email IS NULL',
            rationale: 'Nulls.',
          },
          { columns: ['id'], rows: [{ id: 1 }] },
          { datasourceId: 'ds-edge', rowLimit: 500 },
        );
        input.record(
          { sql: 'SELECT 1', rationale: 'Broken.' },
          { error: 'syntax error' },
          { datasourceId: 'ds-edge', rowLimit: 500 },
        );
        return Promise.resolve({
          sourceCount: 2,
          failedSourceCount: 1,
          stopped: false,
        });
      },
    ),
  };
  const requestContext = new RequestContext();
  requestContext.set('datasets', ['Edge Cases', 'Other']);
  requestContext.set('session-id', 'run-eval-1');
  const options = {
    maxSteps: 15,
    context: [{ role: 'system' as const, content: 'Block D1.' }],
    requestContext,
  };
  return {
    target: readinessWorkflowTurnAgent(
      agent,
      parts as unknown as ReadinessWorkflowParts,
    ),
    generate,
    parts,
    assessment,
    options,
    requestContext,
  };
}

describe('readinessWorkflowTurnAgent (agents.md 8.1)', () => {
  it("runs every step on the run's first dataset and scores Explain report's answer", async () => {
    const { target, generate, parts, assessment, options } = setUp();
    const result = (await target.generate(
      'Is this data ready for a revenue dashboard?',
      options as never,
    )) as unknown as Record<string, unknown>;
    expect(parts.startAssessment).toHaveBeenCalledWith({
      sessionId: 'run-eval-1',
      datasetName: 'Edge Cases',
    });
    expect(assessment.profile).toHaveBeenCalledTimes(1);
    expect(assessment.save).toHaveBeenCalledTimes(1);
    expect(parts.recordFindingSources).toHaveBeenCalledTimes(1);
    // Explain report: the agent's own generate, the case's context plus
    // the report block; the assessed report on the context.
    expect(generate).toHaveBeenCalledTimes(1);
    const [input, explainOptions] = generate.mock.calls[0] as [
      unknown,
      { context: { content: string }[]; maxSteps: number },
    ];
    expect(input).toBe('Is this data ready for a revenue dashboard?');
    expect(explainOptions.maxSteps).toBe(15);
    expect(explainOptions.context[0].content).toBe('Block D1.');
    expect(explainOptions.context[1].content).toContain(
      'stored readiness report rep-1',
    );
    expect(result['text']).toBe('The data scores 71 (report rep-1).');
    // The scored tool calls are Explain report's.
    expect(result['toolCalls']).toEqual([
      { payload: { toolName: 'get_readiness_report' } },
    ]);
  });

  it('hands the checks the report, the finding sources and every step output', async () => {
    const { target, options } = setUp();
    const result = await target.generate('How ready is it?', options as never);
    const details = evalDetailsOf(result);
    expect(details.report).toMatchObject({
      overallScore: 71,
      findingCount: 3,
      dimensionScores: DIMENSIONS,
    });
    expect(details.findingSources).toEqual([
      {
        name: 'run_readonly_sql',
        input: {
          sql: 'SELECT * FROM edge_cases.customers WHERE email IS NULL',
          rationale: 'Nulls.',
        },
        output: { columns: ['id'], rows: [{ id: 1 }] },
        failed: false,
      },
      {
        name: 'run_readonly_sql',
        input: { sql: 'SELECT 1', rationale: 'Broken.' },
        output: { error: 'syntax error' },
        failed: true,
      },
    ]);
    expect(Object.keys(details.steps ?? {})).toEqual(
      expect.arrayContaining([
        'resolve-dataset',
        'profile-source',
        'score-readiness',
        'save-report',
        'finding-rows',
        'explain-report',
        'wrap-up',
      ]),
    );
    expect(details.steps?.['score-readiness']).toMatchObject({
      overallScore: 71,
    });
    expect(details.steps?.['explain-report']).toMatchObject({
      reportId: 'rep-1',
      answer: 'The data scores 71 (report rep-1).',
    });
  });

  it('fails the case with the failed step error', async () => {
    const { target, options, generate } = setUp({ failProfile: true });
    await expect(
      target.generate('How ready is it?', options as never),
    ).rejects.toThrow('Could not reach "Edge Cases PostgreSQL"');
    expect(generate).not.toHaveBeenCalled();
  });

  it('needs the run host and a dataset', async () => {
    const { target, options, requestContext } = setUp();
    requestContext.set('session-id', '');
    await expect(target.generate('q', options as never)).rejects.toThrow(
      'needs the run host',
    );
    requestContext.set('datasets', []);
    await expect(target.generate('q', options as never)).rejects.toThrow(
      'needs a dataset',
    );
  });
});

describe('readinessWorkflowEvalTarget', () => {
  const set: AssistantEvalSet = {
    id: 'readiness-workflow-example',
    name: 'Example',
    description: 'Example.',
    fixtureId: 'edge-cases',
    agentKey: 'data-readiness',
    target: 'data-readiness:assessment-workflow',
    cases: [],
  };

  it("runs on Sarah, bound to her host, with Block D1 over the set's datasource", async () => {
    const wholeRun = jest.fn(() => ({ id: 'whole-run' }) as unknown as Agent);
    const target = readinessWorkflowEvalTarget(
      [set],
      () => new Date('2026-11-16T10:00:00Z'),
      () => ({ id: 'sarah' }) as unknown as Agent,
      wholeRun,
    );
    expect(target.agentKey).toBe('data-readiness');
    expect(target.sessionAgentKey).toBe('data-readiness');
    expect(target.sets).toEqual([set]);
    expect(target.sendsKnowledge).toBe(false);
    expect(wholeRun).not.toHaveBeenCalled();
    expect(target.runTarget).toEqual({ id: 'whole-run' });
    const orientation = await target.orientation({
      datasets: ['Edge Cases'],
      snapshots: [
        {
          name: 'Edge Cases',
          datasourceId: 'ds-edge',
          datasourceKind: 'postgres',
          tables: ['edge_cases.edge_cases.orders'],
        },
      ],
      requestContext: new RequestContext(),
    });
    expect(orientation).toContain('datasource "Edge Cases PostgreSQL"');
    expect(orientation).toContain('Today is 2026-11-16.');
  });
});
