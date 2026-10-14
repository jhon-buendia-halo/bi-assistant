jest.mock('@mastra/core/evals', () => ({
  runEvals: jest.fn(() => Promise.resolve({ scores: {} })),
}));
// The cases' scorers are built at import; they never run here.
jest.mock('@mastra/evals/checks', () => ({
  checks: new Proxy({}, { get: () => () => ({ id: 'stub-check' }) }),
}));
jest.mock('../agents/assistant.agent', () => ({
  assistantAgent: { id: 'assistant' },
}));
jest.mock('../agents/rfp.agent', () => ({ rfpAgent: { id: 'rfp-builder' } }));
jest.mock('../agents/eval-judge.agent', () => ({
  evalJudgeAgent: {},
  evalJudgeOutputSchema: {},
}));
jest.mock('../model-resolver', () => ({ resolveAgentModel: jest.fn() }));
const getDatasets = jest.fn();
const restTarget = jest.fn();
jest.mock('../tool-services', () => ({
  getDatasetToolServices: () => ({ getDatasets, restTarget }),
}));
jest.mock('../../modules/sessions/turn-data', () => ({
  synthesizeToolOnlyTurn: jest.fn(),
  toolDataRecord: jest.fn(),
}));

import { runEvals } from '@mastra/core/evals';
import type { RequestContext } from '@mastra/core/request-context';
import {
  ASSISTANT_EVAL_SETS,
  ASSISTANT_EVAL_TARGET,
  runAssistantEvalCase,
} from './assistant.evals';
import { RFP_EVAL_SET, RFP_ID_PLACEHOLDER, rfpEvalTarget } from './rfp.evals';
import {
  EVAL_SETS,
  agentForCases,
  evalSetsFor,
  evalTargetFor,
  hasEvals,
} from './eval-sets';

const DATASETS = [
  {
    name: 'Intellify RFP API',
    datasourceId: 'rest-1',
    datasourceKind: 'rest',
    tables: [],
  },
];
const NOW = () => new Date('2026-10-14T09:00:00Z');

let fetchMock: jest.Mock;

/** The run's config sent to `runEvals`. */
function sentConfig(): {
  data: { input: string; requestContext: RequestContext }[];
  target: unknown;
  targetOptions: { context: { role: string; content: string }[] };
} {
  const calls = (runEvals as jest.Mock).mock.calls as unknown[][];
  return calls.at(-1)?.[0] as ReturnType<typeof sentConfig>;
}

beforeEach(() => {
  (runEvals as jest.Mock).mockClear();
  getDatasets.mockReset().mockResolvedValue(DATASETS);
  restTarget.mockReset().mockResolvedValue({
    baseUrl: 'http://127.0.0.1:3100',
    headers: { 'X-API-Key': 'k' },
  });
  fetchMock = jest.fn();
  global.fetch = fetchMock;
});

describe('the rfp eval set (agents.md 8.1)', () => {
  it('has the eight cases, on the RFP Builder over the Intellify RFP API', () => {
    expect(RFP_EVAL_SET).toMatchObject({
      id: 'rfp',
      name: 'RFP Builder',
      fixtureId: 'intellify-api',
      agentKey: 'rfp',
    });
    expect(RFP_EVAL_SET.cases.map((c) => c.id)).toEqual([
      'rfp-skill-first',
      'rfp-program-review',
      'rfp-create-draft',
      'rfp-carriers-dental',
      'rfp-resume-drafts',
      'rfp-bad-rows-recovers',
      'rfp-out-of-scope',
      'rfp-no-sql',
    ]);
    expect(RFP_EVAL_SET.cases.some((c) => c.expectedSql)).toBe(false);
  });

  it('keeps the assistant sets as they were, and lists sets per agent', () => {
    expect(ASSISTANT_EVAL_SETS.map((set) => set.id)).toEqual([
      'world-cup',
      'world-cup-rest',
      'formula-1',
    ]);
    expect(ASSISTANT_EVAL_SETS.some((set) => set.agentKey)).toBe(false);
    expect(evalSetsFor('assistant')).toEqual(ASSISTANT_EVAL_SETS);
    expect(evalSetsFor('rfp')).toEqual([RFP_EVAL_SET]);
    expect(evalSetsFor('sql-fixer')).toEqual([]);
    expect(hasEvals('rfp')).toBe(true);
    expect(EVAL_SETS).toHaveLength(4);
    const ids = EVAL_SETS.flatMap((set) => set.cases.map((c) => c.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('picks the eval target by agent', () => {
    expect(evalTargetFor('assistant', 'run-1')).toBe(ASSISTANT_EVAL_TARGET);
    expect(evalTargetFor('rfp', 'run-1').agentKey).toBe('rfp');
    expect(() => evalTargetFor('sql-fixer', 'run-1')).toThrow(
      'Agent "sql-fixer" has no evals to run',
    );
    expect(agentForCases(['rfp-no-sql', 'rfp-out-of-scope'])).toEqual({
      agentKey: 'rfp',
    });
    expect(agentForCases(['champion-2022'])).toEqual({
      agentKey: 'assistant',
    });
    expect(agentForCases(['champion-2022', 'rfp-no-sql'])).toHaveProperty(
      'error',
    );
  });
});

describe('an rfp case run (agents.md 8.1, 4.1 Block R1)', () => {
  const evalCase = RFP_EVAL_SET.cases.find((c) => c.id === 'rfp-no-sql')!;

  it('runs on the RFP Builder with Block R1 only, tagged with the run', async () => {
    const result = await runAssistantEvalCase(
      evalCase,
      ['Intellify RFP API'],
      's-1',
      'Curated dataset knowledge (user-authored …):\n- [term] x',
      rfpEvalTarget('job-7', NOW),
    );

    expect(result.error).toBeUndefined();
    const config = sentConfig();
    expect(config.target).toEqual({ id: 'rfp-builder' });
    expect(config.targetOptions.context).toEqual([
      {
        role: 'system',
        content: [
          'Intellify RFP API for this session: datasource rest-1 ("Intellify RFP API").',
          'No RFP is active in this session yet: start at stage 1.',
          'Today is 2026-10-14.',
        ].join('\n'),
      },
    ]);
    const [{ input, requestContext }] = config.data;
    expect(input).toBe(evalCase.question);
    expect(requestContext.get('rfp-created-by')).toBe('eval:job-7');
    expect(requestContext.get('turn-rfp')).toEqual({});
    expect(requestContext.get('datasets')).toEqual(['Intellify RFP API']);
    expect(requestContext.get('session-id')).toBe('s-1');
  });

  it('creates the draft a case names and puts its id in the question', async () => {
    const withDraft = RFP_EVAL_SET.cases.find(
      (c) => c.id === 'rfp-bad-rows-recovers',
    )!;
    expect(withDraft.question).toContain(RFP_ID_PLACEHOLDER);
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'rfp-123' }), { status: 201 }),
    );

    const result = await runAssistantEvalCase(
      withDraft,
      ['Intellify RFP API'],
      undefined,
      undefined,
      rfpEvalTarget('job-7', NOW),
    );

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:3100/v1/rfps');
    expect(JSON.parse(init.body as string)).toEqual({
      clientOneCode: 'IC100100',
      planYear: 2027,
      createdBy: 'eval:job-7',
    });
    expect(sentConfig().data[0].input).toBe(
      'Set the timeline for RFP rfp-123 to issue on 2026-11-02, proposals due 2026-12-01 and decision 2027-01-15',
    );
    expect(result.question).toBe(sentConfig().data[0].input);
  });

  it("deletes the run's drafts when it finishes", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ deleted: 2 }), { status: 200 }),
    );
    await rfpEvalTarget('job-7').finish?.(['Intellify RFP API']);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('DELETE');
    expect(url).toBe('http://127.0.0.1:3100/v1/rfps?createdBy=eval%3Ajob-7');
  });

  it('never throws from the clean-up', async () => {
    restTarget.mockRejectedValueOnce(new Error('gone'));
    await expect(
      rfpEvalTarget('job-7').finish?.(['Intellify RFP API']),
    ).resolves.toBeUndefined();
  });
});

describe('an assistant case run is unchanged', () => {
  it('runs on the assistant with Block 1 and the knowledge block', async () => {
    getDatasets.mockResolvedValue([]);
    const block = 'Curated dataset knowledge (user-authored):\n- [term] x';
    await runAssistantEvalCase(
      { id: 'demo', question: 'Who won?', intent: 'demo', scorers: [] },
      ['World Cup Core'],
      undefined,
      block,
    );
    const config = sentConfig();
    expect(config.target).toEqual({ id: 'assistant' });
    expect(config.targetOptions.context).toHaveLength(2);
    expect(config.targetOptions.context[0].content).toContain(
      'Datasets for this session: World Cup Core.',
    );
    expect(config.targetOptions.context[1].content).toBe(block);
    expect(config.data[0].requestContext.get('rfp-created-by')).toBeUndefined();
  });
});
