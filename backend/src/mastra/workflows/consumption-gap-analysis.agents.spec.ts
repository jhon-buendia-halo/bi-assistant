/**
 * The model calls of Consumption Gap Analysis (agents.md 2.18 to 2.20,
 * 5.20): what each request carries, how the replies are read, ids, a stop
 * and a model error. The agents and the checks of ./consumption-gap.gaps
 * are stubbed: Jest cannot load Mastra's ESM.
 */
const analyst = jest.fn<Promise<unknown>, unknown[]>();
const mapper = jest.fn<Promise<unknown>, unknown[]>();
const advisor = jest.fn<Promise<unknown>, unknown[]>();
jest.mock('../agents/requirements-analyst.agent', () => ({
  requirementsAnalystAgent: {
    generate: (...args: unknown[]) => analyst(...args),
  },
}));
jest.mock('../agents/layer-mapper.agent', () => ({
  layerMapperAgent: { generate: (...args: unknown[]) => mapper(...args) },
}));
jest.mock('../agents/gap-advisor.agent', () => ({
  gapAdvisorAgent: { generate: (...args: unknown[]) => advisor(...args) },
}));
jest.mock('../agents/dashboard-reader.agent', () => ({
  dashboardReaderAgent: {},
}));
jest.mock('../agents/data-mapper.agent', () => ({ dataMapperAgent: {} }));
jest.mock('../agents/analysis-planner.agent', () => ({
  analysisPlannerAgent: {},
}));
jest.mock('../agents/answer-writer.agent', () => ({ answerWriterAgent: {} }));
jest.mock('../agents/data-readiness.agent', () => ({}));
const checkedMappings = jest.fn<unknown, unknown[]>();
const checkedFixes = jest.fn<unknown, unknown[]>();
jest.mock('./consumption-gap.gaps', () => ({
  checkedMappings: (...args: unknown[]) => checkedMappings(...args),
  checkedFixes: (...args: unknown[]) => checkedFixes(...args),
}));

import type { AgentExchange } from '../agent-threads';
import {
  deriveRequirementsWithModel,
  mapRequirementsWithModel,
  recommendFixesWithModel,
  reviseRequirementsWithModel,
} from './consumption-gap-analysis.agents';
import { ModelTimeoutError, ReplyCutError } from './model-call';
import {
  GAP_ADVISOR_INSTRUCTIONS,
  LAYER_MAPPER_INSTRUCTIONS,
  REQUIREMENTS_ANALYST_INSTRUCTIONS,
} from './consumption-gap-analysis.prompts';
import {
  derivedRequirementsOf,
  revisedRequirementsOf,
} from './consumption-gap-analysis.replies';
import type {
  LayerTable,
  Requirement,
  RequirementAssessment,
} from './consumption-gap-analysis.schemas';

const QUESTIONS = [
  'How many goals did each team score in 2018 and 2022?',
  'Which stage had the highest attendance?',
  'What is the win rate by team?',
];

const DERIVED = {
  requirements: [
    {
      question: 1,
      fields: [
        {
          name: 'goals',
          role: 'measure',
          aggregation: 'sum',
          description: 'Goals scored',
        },
        {
          name: 'team',
          role: 'dimension',
          aggregation: '',
          description: 'The team',
        },
        {
          name: 'year',
          role: 'time',
          aggregation: '',
          description: 'Tournament year',
        },
      ],
      grain: 'team x tournament',
      periodValues: ['2018', '2022'],
    },
    {
      question: 2,
      fields: [
        {
          name: 'attendance',
          role: 'measure',
          aggregation: 'max',
          description: '',
        },
        { name: 'stage', role: 'dimension', aggregation: '', description: '' },
      ],
      grain: 'stage',
      periodValues: [],
    },
  ],
};

const req = (over: Partial<Requirement>): Requirement => ({
  id: 'Q1',
  kind: 'question',
  title: 'T',
  source: 'Question 1',
  dashboardId: '',
  ref: '',
  fields: [],
  grain: '',
  periodValues: [],
  ...over,
});

const TABLES: LayerTable[] = [
  {
    entity: 'wc.landing.matches_raw',
    layer: 'landing',
    dataset: 'wc',
    datasourceId: null,
    datasourceKind: null,
    columns: [{ name: 'home_score', type: 'text' }],
    more: 0,
  },
  {
    entity: 'wc.consumption.fact_goals',
    layer: 'consumption',
    dataset: 'wc',
    datasourceId: null,
    datasourceKind: null,
    columns: [
      { name: 'goal_id', type: 'int' },
      { name: 'team', type: 'text' },
    ],
    more: 2,
  },
];

const text = (request: unknown) => request as string;

describe('deriveRequirementsWithModel (agents.md 2.18)', () => {
  beforeEach(() => analyst.mockReset());

  it('sends the numbered questions and the dashboards as context, with structured output and no tools', async () => {
    analyst.mockResolvedValue({ object: DERIVED, text: '' });
    await deriveRequirementsWithModel(
      {
        questions: QUESTIONS,
        dashboards: [
          {
            id: 'D1',
            source: 'image',
            name: 'Tournament overview',
            blueprint: {
              widgets: [{ title: 'Goals by team' }],
            },
          } as never,
        ],
      },
      {},
    );
    const [request, options] = analyst.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(request).toContain('1. How many goals did each team score');
    expect(request).toContain('3. What is the win rate by team?');
    expect(request).toContain('Tournament overview');
    expect(request).toContain('Goals by team');
    expect(options).toMatchObject({
      maxSteps: 1,
      toolChoice: 'none',
      structuredOutput: {
        jsonPromptInjection: 'inline',
        errorStrategy: 'warn',
      },
    });
  });

  it('builds one requirement per question with ids Q1.. and the missed question has no fields', async () => {
    analyst.mockResolvedValue({ object: DERIVED, text: '' });
    const outcome = await deriveRequirementsWithModel(
      { questions: QUESTIONS, dashboards: [] },
      {},
    );
    expect(outcome.stopped).toBe(false);
    expect(outcome.requirements.map((r) => r.id)).toEqual(['Q1', 'Q2', 'Q3']);
    expect(outcome.requirements[0]).toMatchObject({
      kind: 'question',
      title: QUESTIONS[0],
      source: 'Question 1',
      dashboardId: '',
      ref: '',
      grain: 'team x tournament',
      periodValues: ['2018', '2022'],
    });
    expect(outcome.requirements[0].fields.map((f) => f.role)).toEqual([
      'measure',
      'dimension',
      'time',
    ]);
    expect(outcome.requirements[2]).toMatchObject({
      title: QUESTIONS[2],
      fields: [],
      grain: '',
      periodValues: [],
    });
  });

  it('reads leniently: unknown role is a dimension, no aggregation is empty, text-wrapped JSON is found', async () => {
    const wrapped = `Here you go:\n\`\`\`json\n${JSON.stringify({
      requirements: [
        {
          question: '1',
          fields: [
            { name: 'goals', role: 'METRIC' },
            { name: '', role: 'measure' },
            { name: 'year', role: 'time', aggregation: 'SUM' },
          ],
          periodValues: [2018, '2022', ''],
        },
        { question: 9, fields: [{ name: 'ghost', role: 'measure' }] },
        { question: 1, fields: [{ name: 'dup', role: 'measure' }] },
      ],
    })}\n\`\`\``;
    analyst.mockResolvedValue({ object: undefined, text: wrapped });
    const { requirements } = await deriveRequirementsWithModel(
      { questions: QUESTIONS.slice(0, 2), dashboards: [] },
      {},
    );
    expect(requirements).toHaveLength(2);
    expect(requirements[0].fields).toEqual([
      { name: 'goals', role: 'dimension', aggregation: '', description: '' },
      { name: 'year', role: 'time', aggregation: 'sum', description: '' },
    ]);
    expect(requirements[0].periodValues).toEqual(['2018', '2022']);
    expect(requirements[1].fields).toEqual([]);
  });

  it('turns garbage into questions with no fields', () => {
    for (const garbage of ['no json here', undefined, 42, '{broken']) {
      const out = derivedRequirementsOf(garbage, QUESTIONS);
      expect(out.map((r) => r.id)).toEqual(['Q1', 'Q2', 'Q3']);
      expect(out.every((r) => r.fields.length === 0)).toBe(true);
    }
  });

  it('records the exchange as text', async () => {
    analyst.mockResolvedValue({ object: DERIVED, text: '' });
    const exchanges: AgentExchange[] = [];
    await deriveRequirementsWithModel(
      { questions: QUESTIONS, dashboards: [] },
      { onExchange: (exchange) => void exchanges.push(exchange) },
    );
    expect(exchanges).toHaveLength(1);
    expect(exchanges[0].request).toContain('1. How many goals');
    expect(exchanges[0].reply).toBe(JSON.stringify(DERIVED));
  });

  it('returns nothing and stopped when the turn was stopped', async () => {
    analyst.mockResolvedValue({ object: DERIVED, text: '' });
    const controller = new AbortController();
    controller.abort();
    const exchanges: AgentExchange[] = [];
    const outcome = await deriveRequirementsWithModel(
      { questions: QUESTIONS, dashboards: [] },
      {
        abortSignal: controller.signal,
        onExchange: (exchange) => void exchanges.push(exchange),
      },
    );
    expect(outcome).toEqual({ requirements: [], stopped: true });
    expect(exchanges).toEqual([]);
  });

  it('throws the model error', async () => {
    analyst.mockResolvedValue({ error: new Error('model down') });
    await expect(
      deriveRequirementsWithModel({ questions: QUESTIONS, dashboards: [] }, {}),
    ).rejects.toThrow('model down');
    analyst.mockRejectedValue(new Error('network'));
    await expect(
      deriveRequirementsWithModel({ questions: QUESTIONS, dashboards: [] }, {}),
    ).rejects.toThrow('network');
  });
});

describe('reviseRequirementsWithModel (agents.md 2.18)', () => {
  beforeEach(() => analyst.mockReset());

  const current: Requirement[] = [
    req({ id: 'Q1', title: 'Goals?', fields: [] }),
    req({
      id: 'W1',
      kind: 'widget',
      title: 'Goals by team',
      source: 'Overview · bar',
      dashboardId: 'D1',
      ref: 'goals-by-team',
    }),
    req({
      id: 'F1',
      kind: 'filter',
      title: 'Year',
      source: 'Overview · filter',
      dashboardId: 'D1',
      ref: 'year',
    }),
  ];
  const field = {
    name: 'goals',
    role: 'measure',
    aggregation: 'sum',
    description: '',
  };

  it('sends the current requirements with their ids and the feedback', async () => {
    analyst.mockResolvedValue({ object: { requirements: [] }, text: '' });
    await reviseRequirementsWithModel(
      {
        questions: ['Goals?'],
        requirements: current,
        feedback: 'Drop the filter',
      },
      {},
    );
    const request = text(analyst.mock.calls[0][0]);
    expect(request).toContain('"id": "W1"');
    expect(request).toContain('"id": "F1"');
    expect(request).toContain('Drop the filter');
    expect(request).toContain('<feedback>');
  });

  it('keeps ids and links of kept requirements, drops the dropped, adds with the next free id of the kind', async () => {
    analyst.mockResolvedValue({
      object: {
        requirements: [
          {
            id: 'Q1',
            kind: 'question',
            title: 'Goals?',
            fields: [field],
            grain: 'team',
            periodValues: [],
          },
          {
            id: 'W1',
            kind: 'widget',
            title: 'Goals by team',
            fields: [field],
            grain: '',
            periodValues: [],
          },
          {
            id: '',
            kind: 'question',
            title: 'New question',
            fields: [],
            grain: '',
            periodValues: [],
          },
          {
            id: 'W9',
            kind: 'widget',
            title: 'Extra widget',
            fields: [],
            grain: '',
            periodValues: [],
          },
          {
            id: 'F7',
            kind: 'filter',
            title: 'Extra filter',
            fields: [],
            grain: '',
            periodValues: [],
          },
        ],
      },
      text: '',
    });
    const { requirements, stopped } = await reviseRequirementsWithModel(
      { questions: ['Goals?'], requirements: current, feedback: 'x' },
      {},
    );
    expect(stopped).toBe(false);
    expect(requirements.map((r) => r.id)).toEqual([
      'Q1',
      'W1',
      'Q2',
      'W2',
      'F2',
    ]);
    expect(requirements[1]).toMatchObject({
      kind: 'widget',
      dashboardId: 'D1',
      ref: 'goals-by-team',
      source: 'Overview · bar',
      fields: [field],
    });
    expect(requirements[2]).toMatchObject({
      kind: 'question',
      source: 'Question 2',
      dashboardId: '',
      ref: '',
    });
    expect(requirements[3]).toMatchObject({ kind: 'widget', ref: '' });
  });

  it('keeps the list when the reply is garbage or has no requirements list', () => {
    expect(revisedRequirementsOf('sorry, no', current)).toEqual(current);
    expect(revisedRequirementsOf({ nope: 1 }, current)).toEqual(current);
  });

  it('treats a repeated known id as a new requirement and skips an untitled new one', () => {
    const out = revisedRequirementsOf(
      {
        requirements: [
          { id: 'Q1', title: 'Goals?', fields: [] },
          { id: 'Q1', title: 'Again', fields: [] },
          { id: '', title: '', fields: [field] },
        ],
      },
      [current[0]],
    );
    expect(out.map((r) => [r.id, r.title])).toEqual([
      ['Q1', 'Goals?'],
      ['Q2', 'Again'],
    ]);
  });

  it('returns nothing and stopped when stopped', async () => {
    analyst.mockResolvedValue({ object: { requirements: [] }, text: '' });
    const controller = new AbortController();
    controller.abort();
    await expect(
      reviseRequirementsWithModel(
        { questions: [], requirements: current, feedback: 'x' },
        { abortSignal: controller.signal },
      ),
    ).resolves.toEqual({ requirements: [], stopped: true });
  });

  it('throws the model error', async () => {
    analyst.mockRejectedValue(new Error('boom'));
    await expect(
      reviseRequirementsWithModel(
        { questions: [], requirements: current, feedback: 'x' },
        {},
      ),
    ).rejects.toThrow('boom');
  });
});

describe('mapRequirementsWithModel (agents.md 2.19)', () => {
  beforeEach(() => {
    mapper.mockReset();
    checkedMappings.mockReset();
  });
  const requirements = [
    req({
      fields: [
        { name: 'goals', role: 'measure', aggregation: 'sum', description: '' },
      ],
    }),
  ];

  it('sends the fields and the catalogs grouped by layer, and checks the reply', async () => {
    const reply = {
      mappings: [
        { requirementId: 'Q1', field: 'goals', sources: [], note: '' },
      ],
    };
    mapper.mockResolvedValue({ object: reply, text: '' });
    checkedMappings.mockReturnValue([
      { requirementId: 'Q1', field: 'goals', sources: [], note: 'ok' },
    ]);
    const outcome = await mapRequirementsWithModel(
      { requirements, tables: TABLES },
      {},
    );
    const [request, options] = mapper.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(request).toContain('"id": "Q1"');
    expect(request).toContain('"name": "goals"');
    expect(request).toContain(
      'Landing:\n- wc.landing.matches_raw: home_score text',
    );
    expect(request).toContain('Normalized:\n- (no entity)');
    expect(request).toContain(
      'Consumption:\n- wc.consumption.fact_goals: goal_id int, team text (+2 more not listed)',
    );
    expect(options).toMatchObject({ maxSteps: 1, toolChoice: 'none' });
    expect(checkedMappings).toHaveBeenCalledWith(reply, requirements, TABLES);
    expect(outcome).toEqual({
      mappings: [
        { requirementId: 'Q1', field: 'goals', sources: [], note: 'ok' },
      ],
      stopped: false,
    });
  });

  it('hands a text-wrapped reply to the check as the text', async () => {
    mapper.mockResolvedValue({
      object: undefined,
      text: 'prose {"mappings": []}',
    });
    checkedMappings.mockReturnValue([]);
    await mapRequirementsWithModel({ requirements, tables: TABLES }, {});
    expect(checkedMappings.mock.calls[0][0]).toBe('prose {"mappings": []}');
  });

  it('is stopped with nothing, or throws the model error', async () => {
    mapper.mockResolvedValue({ object: {}, text: '' });
    const controller = new AbortController();
    controller.abort();
    await expect(
      mapRequirementsWithModel(
        { requirements, tables: TABLES },
        { abortSignal: controller.signal },
      ),
    ).resolves.toEqual({ mappings: [], stopped: true });
    expect(checkedMappings).not.toHaveBeenCalled();
    mapper.mockResolvedValue({ error: 'rate limited' });
    await expect(
      mapRequirementsWithModel({ requirements, tables: TABLES }, {}),
    ).rejects.toThrow('rate limited');
  });
});

// The guarded call (workflows R43): one retry of a reset or a cut reply, a
// deadline per try, ten minutes for Map requirements' 16,000-token reply.
describe('the Consumption Gap calls under the guarded call (workflows R43)', () => {
  const requirements = [req({})];
  const reset = () =>
    new TypeError('fetch failed', {
      cause: Object.assign(new Error('read ECONNRESET'), {
        code: 'ECONNRESET',
      }),
    });
  beforeEach(() => {
    jest.useFakeTimers();
    analyst.mockReset();
    mapper.mockReset();
    checkedMappings.mockReset();
  });
  afterEach(() => jest.useRealTimers());

  it('retries a reset once, with the same request, and reports one line', async () => {
    analyst
      .mockRejectedValueOnce(reset())
      .mockResolvedValueOnce({ object: DERIVED, text: '' });
    const lines: string[] = [];
    const pending = deriveRequirementsWithModel(
      { questions: QUESTIONS, dashboards: [] },
      { onRetry: (line) => lines.push(line) },
    );
    await jest.advanceTimersByTimeAsync(2_000);
    const outcome = await pending;
    expect(outcome.stopped).toBe(false);
    expect(outcome.requirements).toHaveLength(QUESTIONS.length);
    expect(analyst).toHaveBeenCalledTimes(2);
    expect(analyst.mock.calls[1][0]).toBe(analyst.mock.calls[0][0]);
    expect(lines).toEqual([
      'Derive requirements: the model call failed (fetch failed). Trying once more in 2 seconds.',
    ]);
  });

  it('fails with ReplyCutError naming the step and its limit when the reply is cut twice, never an empty result', async () => {
    mapper.mockResolvedValue({
      object: undefined,
      text: '{"mappings": [',
      finishReason: 'length',
    });
    const exchanges: AgentExchange[] = [];
    const pending = mapRequirementsWithModel(
      { requirements, tables: TABLES },
      { onExchange: (exchange) => void exchanges.push(exchange) },
    ).catch((error: Error) => error);
    await jest.advanceTimersByTimeAsync(2_000);
    const error = await pending;
    expect(error).toBeInstanceOf(ReplyCutError);
    expect((error as Error).message).toContain(
      "Map requirements failed: the model's reply was cut at its output limit (16000 tokens)",
    );
    expect(mapper).toHaveBeenCalledTimes(2);
    expect(checkedMappings).not.toHaveBeenCalled();
    expect(exchanges).toEqual([]);
  });

  it('gives Map requirements ten minutes, and fails with ModelTimeoutError past them', async () => {
    mapper.mockImplementation(() => new Promise(() => undefined));
    const pending = mapRequirementsWithModel(
      { requirements, tables: TABLES },
      { abortSignal: new AbortController().signal },
    ).catch((error: Error) => error);
    let settledEarly = false;
    void pending.then(() => (settledEarly = true));
    await jest.advanceTimersByTimeAsync(5 * 60_000);
    expect(settledEarly).toBe(false);
    await jest.advanceTimersByTimeAsync(5 * 60_000);
    const error = await pending;
    expect(error).toBeInstanceOf(ModelTimeoutError);
    expect((error as Error).message).toContain(
      'Map requirements failed: the model did not answer within 10 minutes',
    );
    expect(mapper).toHaveBeenCalledTimes(1);
  });

  it('gives Derive requirements five minutes', async () => {
    analyst.mockImplementation(() => new Promise(() => undefined));
    const pending = deriveRequirementsWithModel(
      { questions: QUESTIONS, dashboards: [] },
      {},
    ).catch((error: Error) => error);
    await jest.advanceTimersByTimeAsync(5 * 60_000);
    expect(await pending).toBeInstanceOf(ModelTimeoutError);
  });
});

describe('recommendFixesWithModel (agents.md 2.20)', () => {
  beforeEach(() => {
    advisor.mockReset();
    checkedFixes.mockReset();
  });
  const requirements = [
    req({ id: 'Q1', title: 'Goals per team' }),
    req({ id: 'Q2', title: 'Supported one' }),
  ];
  const assessments: RequirementAssessment[] = [
    {
      requirementId: 'Q1',
      status: 'normalized-only',
      reason: 'goals exists in Normalized only',
      evidence: '12 rows found',
      fields: [
        {
          field: 'goals',
          status: 'normalized-only',
          consumption: null,
          upstream: {
            layer: 'normalized',
            entity: 'wc.normalized.goals',
            column: 'goal_id',
            expression: 'count(goal_id)',
          },
          path: [{ entity: 'wc.landing.goals_raw', column: 'id' }],
        },
      ],
    },
    {
      requirementId: 'Q2',
      status: 'supported',
      reason: 'fine',
      evidence: '',
      fields: [],
    },
  ];
  const lineage = { edges: [], checkedPairs: 0, failedChecks: 0 };

  it('sends only the gaps with reason, evidence, sources and path, and the catalogs, and checks the reply', async () => {
    const reply = { fixes: [{ title: 'Goal fact', closes: ['Q1'] }] };
    advisor.mockResolvedValue({ object: reply, text: '' });
    checkedFixes.mockReturnValue([{ id: 'X1' }]);
    const outcome = await recommendFixesWithModel(
      { requirements, assessments, tables: TABLES, lineage },
      {},
    );
    const request = text(advisor.mock.calls[0][0]);
    expect(request).toContain('"id": "Q1"');
    expect(request).toContain('Goals per team');
    expect(request).toContain('normalized-only');
    expect(request).toContain('12 rows found');
    expect(request).toContain('count(goal_id)');
    expect(request).toContain('wc.landing.goals_raw.id');
    expect(request).not.toContain('Supported one');
    expect(request).toContain('wc.consumption.fact_goals: goal_id int');
    expect(checkedFixes).toHaveBeenCalledWith(reply, requirements, assessments);
    expect(outcome).toEqual({ fixes: [{ id: 'X1' }], stopped: false });
  });

  it('is stopped with nothing, or throws the model error', async () => {
    advisor.mockResolvedValue({ object: {}, text: '' });
    const controller = new AbortController();
    controller.abort();
    await expect(
      recommendFixesWithModel(
        { requirements, assessments, tables: TABLES, lineage },
        { abortSignal: controller.signal },
      ),
    ).resolves.toEqual({ fixes: [], stopped: true });
    advisor.mockRejectedValue(new Error('down'));
    await expect(
      recommendFixesWithModel(
        { requirements, assessments, tables: TABLES, lineage },
        {},
      ),
    ).rejects.toThrow('down');
  });
});

describe('the shipped instructions state the reply shape', () => {
  it('name the JSON each agent replies with', () => {
    expect(REQUIREMENTS_ANALYST_INSTRUCTIONS).toContain('"requirements"');
    expect(LAYER_MAPPER_INSTRUCTIONS).toContain('"mappings"');
    expect(GAP_ADVISOR_INSTRUCTIONS).toContain('"fixes"');
  });
});
