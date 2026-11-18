// The real engine pulls in ESM-only packages Jest cannot require; the stub
// runs `.then()` steps in order with the engine's step events, suspend and
// resume (see it).
jest.mock('@mastra/core/workflows', () =>
  jest.requireActual<typeof import('../testing/workflows.stub')>(
    '../testing/workflows.stub',
  ),
);
// The pure code of the steps has its own specs: here each function returns
// a fixed value, so the test reads the workflow's wiring only.
jest.mock('./consumption-gap.gaps');
jest.mock('./consumption-gap.lineage');
jest.mock('./consumption-gap.report');

import { RequestContext } from '@mastra/core/request-context';
import { earlyWork, memoisedBy } from '../../modules/sessions/turn/early-work';
import type {
  FieldMapping,
  GapFix,
  LayerSchemaNote,
  LayerTable,
  Lineage,
  Requirement,
  RequirementAssessment,
  StatusCounts,
} from './consumption-gap-analysis.schemas';
import {
  CONFIRM_REQUIREMENTS_OPTION,
  CONSUMPTION_GAP_EDGES,
  CONSUMPTION_GAP_RUNTIME_KEY,
  CONSUMPTION_GAP_STEPS,
  CONSUMPTION_GAP_WORKFLOW_ID,
  type ConsumptionGapRuntime,
  type GapQuery,
} from './consumption-gap-analysis.steps';
import { consumptionGapAnalysisWorkflow } from './consumption-gap-analysis.workflow';
import * as gaps from './consumption-gap.gaps';
import * as lineage from './consumption-gap.lineage';
import * as report from './consumption-gap.report';
import { SAMPLE_BLUEPRINT_REPLY } from './recreate-dashboard.sample';
import {
  blueprintOf,
  type DashboardBlueprint,
  type MockBundle,
} from './recreate-dashboard.steps';

interface StubStream {
  fullStream: AsyncIterable<{
    type: string;
    payload?: { id?: string; status?: string; suspendPayload?: unknown };
  }>;
  result: Promise<{
    status: string;
    result?: unknown;
    error?: unknown;
    suspended?: string[][];
    steps?: Record<string, { status: string; suspendPayload?: unknown }>;
  }>;
}

interface StubWorkflow {
  id: string;
  options?: {
    validateInputs?: boolean;
    shouldPersistSnapshot?: (args: { workflowStatus: string }) => boolean;
  };
  steps: { id: string; description?: string }[];
  createRun(): Promise<{
    stream(args: { inputData: unknown; requestContext: unknown }): StubStream;
    resumeStream(args: {
      step: string[];
      resumeData: unknown;
      requestContext: unknown;
    }): StubStream;
  }>;
}

const workflow = consumptionGapAnalysisWorkflow as unknown as StubWorkflow;

const BLUEPRINT = blueprintOf(SAMPLE_BLUEPRINT_REPLY) as DashboardBlueprint;

const LAYERS: LayerSchemaNote[] = [
  {
    schemaKey: 'world_cup.wc_normalized',
    layer: 'normalized',
    dataset: 'World Cup',
    description: '',
  },
  {
    schemaKey: 'world_cup.wc_consumption',
    layer: 'consumption',
    dataset: 'World Cup',
    description: '',
  },
];

const TABLES: LayerTable[] = [
  {
    entity: 'world_cup.wc_normalized.goals',
    layer: 'normalized',
    dataset: 'World Cup',
    datasourceId: 'ds-wc',
    datasourceKind: 'postgres',
    columns: [{ name: 'is_penalty', type: 'boolean' }],
    more: 0,
  },
  {
    entity: 'world_cup.wc_consumption.agg_player_goals',
    layer: 'consumption',
    dataset: 'World Cup',
    datasourceId: 'ds-wc',
    datasourceKind: 'postgres',
    columns: [{ name: 'goals', type: 'integer' }],
    more: 0,
  },
];

const CANDIDATE = {
  from: { entity: 'world_cup.wc_normalized.goals', column: 'player_name' },
  to: { entity: 'world_cup.wc_consumption.agg_player_goals', column: 'player' },
  method: 'similar-name' as const,
  confidence: 0.6,
};

const LINEAGE_QUERY: GapQuery = {
  id: 'lineage-1',
  datasourceId: 'ds-wc',
  sql: 'SELECT 1',
  rationale: 'Whether the players of the goals table feed the player goals.',
};

const LINEAGE: Lineage = {
  edges: [
    {
      from: CANDIDATE.from,
      to: CANDIDATE.to,
      method: 'values',
      confidence: 0.9,
      overlap: 1,
      expression: '',
    },
  ],
  checkedPairs: 1,
  failedChecks: 0,
};

const QUESTION_REQUIREMENT: Requirement = {
  id: 'Q1',
  kind: 'question',
  title: '¿Qué porcentaje de los goles fueron de penal?',
  source: 'Question 1',
  dashboardId: '',
  ref: '',
  fields: [
    {
      name: 'penalty goals',
      role: 'measure',
      aggregation: 'share',
      description: '',
    },
  ],
  grain: '',
  periodValues: [],
};

const WIDGET_REQUIREMENT: Requirement = {
  ...QUESTION_REQUIREMENT,
  id: 'W1',
  kind: 'widget',
  title: 'Revenue',
  source: 'Sales board · kpi',
  dashboardId: 'D1',
  ref: 'w1',
};

const REVISED: Requirement = { ...QUESTION_REQUIREMENT, title: 'Revised' };

const MAPPINGS: FieldMapping[] = [
  {
    requirementId: 'Q1',
    field: 'penalty goals',
    sources: [
      {
        layer: 'normalized',
        entity: 'world_cup.wc_normalized.goals',
        column: 'is_penalty',
        expression: '',
      },
    ],
    note: '',
  },
];

const ASSESSMENTS: RequirementAssessment[] = [
  {
    requirementId: 'Q1',
    status: 'normalized-only',
    fields: [],
    reason: 'Penalty goals are only in Normalized.',
    evidence: '',
  },
];

const PROBE = {
  id: 'probe-1',
  datasourceId: 'ds-wc',
  sql: 'SELECT count(*) FROM world_cup.wc_normalized.goals',
  rationale: 'How many goals are recorded.',
  requirementId: 'Q1',
  purpose: 'coverage' as const,
};

const FIXES: GapFix[] = [
  {
    id: 'X1',
    title: 'Add penalty goals to Consumption',
    startsIn: 'consumption',
    path: ['consumption'],
    closes: ['Q1'],
    why: 'The flag is in Normalized.',
    change: 'ALTER VIEW …',
  },
];

const COUNTS: StatusCounts = {
  supported: 0,
  derivable: 0,
  grain: 0,
  'normalized-only': 1,
  'landing-only': 0,
  missing: 0,
};

const BUNDLE: MockBundle = {
  title: 'Consumption gap analysis: wc_consumption',
  description: '',
  html: '<div id="gap-report-root" class="gap"></div>',
  css: '',
  javascript: '',
};

const QUESTION = '¿Qué porcentaje de los goles fueron de penal?';

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(gaps.parseQuestions).mockImplementation((text) =>
    text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean),
  );
  jest.mocked(gaps.resolveLayers).mockReturnValue(LAYERS);
  jest.mocked(gaps.layerTables).mockReturnValue(TABLES);
  jest
    .mocked(gaps.dashboardRequirements)
    .mockImplementation((dashboards) =>
      dashboards.length ? [WIDGET_REQUIREMENT] : [],
    );
  jest.mocked(gaps.confirmQuestion).mockImplementation((requirements) => ({
    question: `Confirm ${requirements.map((r) => r.id).join(', ')}`,
    options: [CONFIRM_REQUIREMENTS_OPTION],
  }));
  jest
    .mocked(gaps.isConfirmation)
    .mockImplementation((answer) => answer === CONFIRM_REQUIREMENTS_OPTION);
  jest.mocked(gaps.traceGaps).mockImplementation((input) => ({
    assessments: ASSESSMENTS,
    lineage: input.lineage,
  }));
  jest.mocked(gaps.probeQueries).mockReturnValue([PROBE]);
  jest
    .mocked(gaps.applyProbes)
    .mockImplementation((assessments) =>
      assessments.map((a) => ({ ...a, evidence: '12 goals recorded.' })),
    );
  jest.mocked(gaps.statusCounts).mockReturnValue(COUNTS);
  jest.mocked(lineage.lineageCandidates).mockReturnValue([CANDIDATE]);
  jest
    .mocked(lineage.lineageQueries)
    .mockReturnValue([{ ...LINEAGE_QUERY, candidate: CANDIDATE }]);
  jest.mocked(lineage.lineageFromChecks).mockReturnValue(LINEAGE);
  jest.mocked(report.gapReportTitle).mockReturnValue(BUNDLE.title);
  jest.mocked(report.renderGapReportBundle).mockReturnValue(BUNDLE);
  jest.mocked(report.gapAnswer).mockReturnValue('Q1 is only in Normalized.');
});

/** Each call of the runtime as a Jest mock, so a test reads its calls. */
type MockedRuntime = { [K in keyof ConsumptionGapRuntime]: jest.Mock };

/** Every query answers one row. */
const answered = (queries: GapQuery[]) => ({
  results: queries.map((query) => ({
    id: query.id,
    columns: ['n'],
    rows: [{ n: 12 }],
    error: null,
  })),
  stopped: false,
});

/**
 * A runtime whose every call succeeds. The lineage checks are held as the
 * turn holds them (`earlyWork`), each recorded into `recorded`; the dataset
 * layers are fetched once per run as the turn memoises them.
 */
function runtime(
  overrides: Partial<MockedRuntime> = {},
  given: {
    runLineage?: (
      queries: GapQuery[],
      signal: AbortSignal,
    ) => Promise<ReturnType<typeof answered>>;
    calls?: string[];
  } = {},
): MockedRuntime & {
  fetchLayers: jest.Mock;
  recorded: string[];
  calls: string[];
} {
  const work = earlyWork(new AbortController().signal);
  const recorded: string[] = [];
  const calls = given.calls ?? [];
  const fetchLayers = jest.fn(() => {
    calls.push('datasetLayers');
    return Promise.resolve([]);
  });
  return {
    fetchLayers,
    recorded,
    calls,
    readDashboard: jest.fn(({ image }: { image: string }) => {
      calls.push(`readDashboard:${image}`);
      return Promise.resolve({ blueprint: BLUEPRINT, stopped: false });
    }),
    loadDashboard: jest.fn(() =>
      Promise.resolve({ name: 'Sales board', blueprint: BLUEPRINT }),
    ),
    datasetLayers: jest.fn(
      memoisedBy(fetchLayers, ({ datasets }: { datasets: string[] }) =>
        datasets.join('\n'),
      ),
    ),
    startLineage: jest.fn(({ queries }: { queries: GapQuery[] }) => {
      calls.push('startLineage');
      work.start('lineage', async (signal, record) => {
        const ran = await (given.runLineage?.(queries, signal) ??
          Promise.resolve(answered(queries)));
        for (const result of ran.results) {
          record(() => recorded.push(result.id));
        }
        return ran;
      });
    }),
    takeLineage: jest.fn(() => {
      calls.push('takeLineage');
      return work.take('lineage');
    }),
    runQueries: jest.fn(({ queries }: { queries: GapQuery[] }) =>
      Promise.resolve(answered(queries)),
    ),
    deriveRequirements: jest.fn(() => {
      calls.push('deriveRequirements');
      return Promise.resolve({
        requirements: [QUESTION_REQUIREMENT],
        stopped: false,
      });
    }),
    reviseRequirements: jest.fn(() =>
      Promise.resolve({ requirements: [REVISED], stopped: false }),
    ),
    mapRequirements: jest.fn(() =>
      Promise.resolve({ mappings: MAPPINGS, stopped: false }),
    ),
    recommendFixes: jest.fn(() =>
      Promise.resolve({ fixes: FIXES, stopped: false }),
    ),
    saveReport: jest.fn(({ title }: { title: string }) =>
      Promise.resolve({ visualId: 'v-1', title }),
    ),
    ...overrides,
  };
}

async function drain(output: StubStream) {
  const events: string[] = [];
  for await (const event of output.fullStream) {
    if (event.payload?.id) {
      events.push(`${event.payload.id}:${event.payload.status}`);
    }
  }
  return { events, result: await output.result };
}

async function start(
  given: MockedRuntime | undefined,
  input: Record<string, unknown> = {},
) {
  const requestContext = new RequestContext();
  if (given) requestContext.set(CONSUMPTION_GAP_RUNTIME_KEY, given);
  const engineRun = await workflow.createRun();
  const drained = await drain(
    engineRun.stream({
      inputData: { question: QUESTION, datasets: ['World Cup'], ...input },
      requestContext,
    }),
  );
  return { ...drained, engineRun, requestContext };
}

async function resume(
  started: Awaited<ReturnType<typeof start>>,
  answer: string,
) {
  return drain(
    started.engineRun.resumeStream({
      step: started.result.suspended![0],
      resumeData: { answer },
      requestContext: started.requestContext,
    }),
  );
}

describe('consumption-gap-analysis workflow (agents.md 5.20)', () => {
  it('is built from the step catalogue, validates its input and snapshots only while waiting', () => {
    expect(workflow.id).toBe(CONSUMPTION_GAP_WORKFLOW_ID);
    expect(workflow.steps.map((step) => [step.id, step.description])).toEqual(
      CONSUMPTION_GAP_STEPS.map((step) => [step.id, step.title]),
    );
    // A `.then` chain: the edges are the steps in order, Start to End.
    expect(CONSUMPTION_GAP_EDGES.map((edge) => edge.to)).toEqual([
      ...CONSUMPTION_GAP_STEPS.map((step) => step.id),
      'end',
    ]);
    expect(workflow.options?.validateInputs).toBe(true);
    const persist = workflow.options?.shouldPersistSnapshot;
    expect(persist?.({ workflowStatus: 'suspended' })).toBe(true);
    expect(persist?.({ workflowStatus: 'running' })).toBe(false);
    expect(persist?.({ workflowStatus: 'success' })).toBe(false);
  });

  it('suspends at Confirm requirements with the question and the confirm option', async () => {
    const given = runtime();
    const started = await start(given);
    expect(started.result.status).toBe('suspended');
    expect(started.result.suspended).toEqual([['confirm-requirements']]);
    expect(
      started.result.steps?.['confirm-requirements']?.suspendPayload,
    ).toEqual({
      question: 'Confirm Q1',
      options: [CONFIRM_REQUIREMENTS_OPTION],
    });
    expect(
      started.events.filter((event) => event.endsWith(':success')),
    ).toEqual([
      'resolve-layers:success',
      'load-layer-catalogs:success',
      'read-dashboards:success',
      'derive-requirements:success',
      'infer-lineage:success',
    ]);
    // The lineage checks started at Load layer catalogs as queries, without
    // what the step keeps beside; Infer lineage took them.
    expect(given.startLineage).toHaveBeenCalledWith({
      queries: [LINEAGE_QUERY],
    });
    expect(given.takeLineage).toHaveBeenCalledTimes(1);
    expect(given.runQueries).not.toHaveBeenCalled();
    expect(lineage.lineageFromChecks).toHaveBeenCalledWith(
      [CANDIDATE],
      [
        {
          query: { ...LINEAGE_QUERY, candidate: CANDIDATE },
          result: {
            id: 'lineage-1',
            columns: ['n'],
            rows: [{ n: 12 }],
            error: null,
          },
        },
      ],
    );
    expect(given.deriveRequirements).toHaveBeenCalledWith({
      questions: [QUESTION],
      dashboards: [],
    });
    expect(given.mapRequirements).not.toHaveBeenCalled();
  });

  it('finishes with the report once the requirements are confirmed', async () => {
    const given = runtime();
    const started = await start(given);
    const { events, result } = await resume(
      started,
      CONFIRM_REQUIREMENTS_OPTION,
    );
    expect(result.status).toBe('success');
    expect(events.filter((event) => event.endsWith(':success'))).toEqual([
      'confirm-requirements:success',
      'map-requirements:success',
      'trace-gaps:success',
      'probe-evidence:success',
      'recommend-fixes:success',
      'render-report:success',
    ]);
    expect(given.reviseRequirements).not.toHaveBeenCalled();
    expect(given.mapRequirements).toHaveBeenCalledWith({
      requirements: [QUESTION_REQUIREMENT],
      tables: TABLES,
    });
    // The probe ran as a query; its requirement and purpose stay in the step.
    expect(given.runQueries).toHaveBeenLastCalledWith({
      queries: [
        {
          id: PROBE.id,
          datasourceId: PROBE.datasourceId,
          sql: PROBE.sql,
          rationale: PROBE.rationale,
        },
      ],
    });
    expect(given.recommendFixes).toHaveBeenCalledWith({
      requirements: [QUESTION_REQUIREMENT],
      assessments: [{ ...ASSESSMENTS[0], evidence: '12 goals recorded.' }],
      tables: TABLES,
      lineage: LINEAGE,
    });
    expect(report.renderGapReportBundle).toHaveBeenCalledWith({
      questions: [QUESTION],
      datasets: ['World Cup'],
      layers: LAYERS,
      tables: TABLES,
      lineage: LINEAGE,
      dashboards: [],
      requirements: [QUESTION_REQUIREMENT],
      assessments: [{ ...ASSESSMENTS[0], evidence: '12 goals recorded.' }],
      fixes: FIXES,
      probeCount: 1,
    });
    expect(given.saveReport).toHaveBeenCalledWith({
      bundle: BUNDLE,
      answer: 'Q1 is only in Normalized.',
      title: BUNDLE.title,
    });
    expect(result.result).toEqual({
      visualId: 'v-1',
      title: BUNDLE.title,
      requirementCount: 1,
      counts: COUNTS,
      fixCount: 1,
      edgeCount: 1,
      answer: 'Q1 is only in Normalized.',
    });
  });

  it('applies feedback through the Requirements Analyst once, then goes on', async () => {
    const given = runtime();
    const started = await start(given);
    const { result } = await resume(started, '  Drop the widgets  ');
    expect(result.status).toBe('success');
    expect(given.reviseRequirements).toHaveBeenCalledTimes(1);
    expect(given.reviseRequirements).toHaveBeenCalledWith({
      questions: [QUESTION],
      requirements: [QUESTION_REQUIREMENT],
      feedback: 'Drop the widgets',
    });
    expect(given.mapRequirements).toHaveBeenCalledWith({
      requirements: [REVISED],
      tables: TABLES,
    });
  });

  it('reads each reference image with Grace, then loads the saved dashboard', async () => {
    const given = runtime();
    await start(given, {
      images: ['inputs/images/1.png', 'inputs/images/2.png'],
      artifact: 'a-1',
    });
    expect(given.readDashboard.mock.calls).toEqual([
      [
        {
          image: 'inputs/images/1.png',
          signal: expect.any(AbortSignal) as unknown,
        },
      ],
      [
        {
          image: 'inputs/images/2.png',
          signal: expect.any(AbortSignal) as unknown,
        },
      ],
    ]);
    expect(given.loadDashboard).toHaveBeenCalledWith({ artifact: 'a-1' });
    const dashboards = (
      given.deriveRequirements.mock.calls[0] as [
        { dashboards: { id: string; source: string; name: string }[] },
      ]
    )[0].dashboards.map(({ id, source, name }) => ({ id, source, name }));
    expect(dashboards).toEqual([
      { id: 'D1', source: 'image', name: BLUEPRINT.title },
      { id: 'D2', source: 'image', name: BLUEPRINT.title },
      { id: 'D3', source: 'artifact', name: 'Sales board' },
    ]);
  });

  it('loads no saved dashboard when the artifact is empty', async () => {
    const given = runtime();
    await start(given, { artifact: '' });
    expect(given.readDashboard).not.toHaveBeenCalled();
    expect(given.loadDashboard).not.toHaveBeenCalled();
  });

  it('ends at Derive requirements when the run is stopped there', async () => {
    const given = runtime({
      deriveRequirements: jest.fn(() =>
        Promise.resolve({ requirements: [], stopped: true }),
      ),
    });
    const { result, events } = await start(given);
    expect(result.status).toBe('success');
    expect(result.result).toMatchObject({ stopped: true });
    expect(events).not.toContain('confirm-requirements:suspended');
    expect(gaps.confirmQuestion).not.toHaveBeenCalled();
    expect(given.saveReport).not.toHaveBeenCalled();
  });

  it('ends at Infer lineage when the run is stopped during its checks', async () => {
    const given = runtime(
      {},
      { runLineage: () => Promise.resolve({ results: [], stopped: true }) },
    );
    const { result, events } = await start(given);
    expect(result.status).toBe('success');
    expect(result.result).toMatchObject({ stopped: true });
    expect(events).toContain('infer-lineage:bailed');
    expect(gaps.confirmQuestion).not.toHaveBeenCalled();
  });

  it('fails naming the step when the runtime is missing', async () => {
    const { result } = await start(undefined);
    expect(result.status).toBe('failed');
    expect(String((result.error as Error).message)).toContain(
      'The Resolve layers step has no consumption model to analyse',
    );
  });

  // Independent work at the same time, on a linear graph (agents.md 5.20).
  describe('concurrent work', () => {
    const IMAGES = ['inputs/images/1.png', 'inputs/images/2.png'];

    /** Wait (a bounded number of turns) until `ready` holds; throws if never. */
    async function until(ready: () => boolean) {
      for (let turn = 0; turn < 200 && !ready(); turn++) {
        await new Promise((r) => setImmediate(r));
      }
      if (!ready()) throw new Error('The run never got there');
    }

    it('refuses a dataset with no Consumption schema before any dashboard is read', async () => {
      jest.mocked(gaps.resolveLayers).mockImplementation(() => {
        throw new Error(
          'No schema of the datasets World Cup is tagged Consumption.',
        );
      });
      const given = runtime();
      const { result } = await start(given, {
        images: IMAGES,
        artifact: 'a-1',
      });
      expect(result.status).toBe('failed');
      expect(String((result.error as Error).message)).toContain(
        'is tagged Consumption',
      );
      expect(given.readDashboard).not.toHaveBeenCalled();
      expect(given.loadDashboard).not.toHaveBeenCalled();
      expect(given.startLineage).not.toHaveBeenCalled();
    });

    it('starts both image reads before either ends, and numbers the dashboards in image order when they finish out of order', async () => {
      const pending = new Map<string, (title: string) => void>();
      const ended: string[] = [];
      const readDashboard = jest.fn(
        ({ image }: { image: string }) =>
          new Promise<{ blueprint: DashboardBlueprint; stopped: boolean }>(
            (done) =>
              pending.set(image, (title) => {
                ended.push(image);
                done({ blueprint: { ...BLUEPRINT, title }, stopped: false });
              }),
          ),
      );
      const given = runtime({ readDashboard });
      const started = start(given, { images: IMAGES, artifact: 'a-1' });
      await until(() => pending.size >= 2);
      // Both reads started, none ended.
      expect(readDashboard).toHaveBeenCalledTimes(2);
      expect(ended).toEqual([]);
      pending.get(IMAGES[1])!('Second');
      await new Promise((r) => setImmediate(r));
      pending.get(IMAGES[0])!('First');
      await started;
      expect(ended).toEqual([IMAGES[1], IMAGES[0]]);
      const dashboards = (
        given.deriveRequirements.mock.calls[0] as [
          { dashboards: { id: string; source: string; name: string }[] },
        ]
      )[0].dashboards.map(({ id, source, name }) => ({ id, source, name }));
      expect(dashboards).toEqual([
        { id: 'D1', source: 'image', name: 'First' },
        { id: 'D2', source: 'image', name: 'Second' },
        { id: 'D3', source: 'artifact', name: 'Sales board' },
      ]);
    });

    it("aborts the other reads' signal at the first failure and fails with that failure", async () => {
      const signals: AbortSignal[] = [];
      const readDashboard = jest.fn(
        ({ image, signal }: { image: string; signal: AbortSignal }) => {
          signals.push(signal);
          if (image === IMAGES[0]) {
            return Promise.reject(new Error('The image shows no dashboard'));
          }
          return new Promise((_done, fail) =>
            signal.addEventListener('abort', () =>
              fail(new Error('This operation was aborted')),
            ),
          );
        },
      );
      const given = runtime({ readDashboard });
      const { result } = await start(given, { images: IMAGES });
      expect(result.status).toBe('failed');
      expect(String((result.error as Error).message)).toContain(
        'The image shows no dashboard',
      );
      expect(signals).toHaveLength(2);
      expect(signals.every((signal) => signal.aborted)).toBe(true);
      expect(given.deriveRequirements).not.toHaveBeenCalled();
    });

    it('bails at Read dashboards with the dashboards already read when the run is stopped', async () => {
      const readDashboard = jest.fn(({ image }: { image: string }) =>
        Promise.resolve({
          blueprint: BLUEPRINT,
          stopped: image === IMAGES[1],
        }),
      );
      const given = runtime({ readDashboard });
      const { result, events } = await start(given, {
        images: IMAGES,
        artifact: 'a-1',
      });
      expect(result.status).toBe('success');
      expect(events).toContain('read-dashboards:bailed');
      expect(result.result).toMatchObject({
        stopped: true,
        dashboards: [{ id: 'D1', source: 'image', name: BLUEPRINT.title }],
      });
      expect(given.loadDashboard).not.toHaveBeenCalled();
      expect(given.deriveRequirements).not.toHaveBeenCalled();
    });

    it('takes at Infer lineage the lineage started at Load layer catalogs, its records in their order', async () => {
      const second: GapQuery = { ...LINEAGE_QUERY, id: 'lineage-2' };
      jest.mocked(lineage.lineageQueries).mockReturnValue([
        { ...LINEAGE_QUERY, candidate: CANDIDATE },
        { ...second, candidate: CANDIDATE },
      ]);
      let finish!: () => void;
      const gate = new Promise<void>((done) => (finish = done));
      const given = runtime(
        {},
        {
          runLineage: async (queries) => {
            await gate;
            return answered(queries);
          },
        },
      );
      const started = start(given, { images: IMAGES });
      // The lineage checks run while the dashboards are read and derived.
      await until(() => given.deriveRequirements.mock.calls.length > 0);
      expect(given.recorded).toEqual([]);
      finish();
      await started;
      expect(given.calls).toEqual([
        'datasetLayers',
        'startLineage',
        `readDashboard:${IMAGES[0]}`,
        `readDashboard:${IMAGES[1]}`,
        'deriveRequirements',
        'takeLineage',
      ]);
      expect(given.recorded).toEqual(['lineage-1', 'lineage-2']);
      expect(lineage.lineageFromChecks).toHaveBeenCalledWith(
        [CANDIDATE],
        [
          expect.objectContaining({
            result: expect.objectContaining({ id: 'lineage-1' }) as unknown,
          }),
          expect.objectContaining({
            result: expect.objectContaining({ id: 'lineage-2' }) as unknown,
          }),
        ],
      );
    });

    it('starts no lineage when there is no candidate pair', async () => {
      jest.mocked(lineage.lineageQueries).mockReturnValue([]);
      const given = runtime();
      const { result } = await start(given);
      expect(result.status).toBe('suspended');
      expect(given.startLineage).not.toHaveBeenCalled();
      expect(given.takeLineage).not.toHaveBeenCalled();
    });

    it('fetches the dataset layers once per run, for Resolve layers and Load layer catalogs', async () => {
      const given = runtime();
      await start(given);
      expect(given.datasetLayers.mock.calls).toEqual([
        [{ datasets: ['World Cup'] }],
        [{ datasets: ['World Cup'] }],
      ]);
      expect(given.fetchLayers).toHaveBeenCalledTimes(1);
    });
  });
});
