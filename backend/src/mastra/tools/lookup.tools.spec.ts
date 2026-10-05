import { RequestContext } from '@mastra/core/request-context';
import {
  ENGINE_OPTIONS_CONTEXT_KEY,
  LOOKUP_TOOL_NAMES,
  resolveEngineOptions,
  type EngineOptions,
} from '../../modules/engine/engine-options';
import {
  setDatasetToolServices,
  type DatasetSnapshot,
  type DatasetToolServices,
} from '../tool-services';
import { DATASETS_CONTEXT_KEY } from './dataset.tools';
import {
  lookupKnowledgeTool,
  lookupTools,
  lookupValuesTool,
  MATCH_THRESHOLD,
  normalizeForMatch,
  rankValues,
  valueSimilarity,
} from './lookup.tools';

const DB = 'questions_to_insights.health_insurance';
const CLAIMS = `${DB}.claims`;
const REGIONS = `${DB}.regions`;
const STATUSES = [
  { value: 'PAID', count: 700 },
  { value: 'DENIED', count: 150 },
  { value: 'PENDING', count: 100 },
  { value: 'REVERSED', count: 50 },
];
const REGION_NAMES = [
  'New York',
  'Newark',
  'New Jersey',
  'Yorkshire',
  'São Paulo',
];

const SNAPSHOTS: DatasetSnapshot[] = [
  {
    name: 'Health Insurance',
    datasourceId: 'pg-1',
    datasourceKind: 'postgres',
    tables: [CLAIMS, REGIONS],
    entities: [
      {
        key: CLAIMS,
        columns: [
          {
            name: 'status',
            type: 'text',
            nullable: false,
            sampleValues: ['PAID', 'DENIED'],
            profile: {
              sampledRows: 1000,
              nullRate: 0,
              distinctCount: 4,
              constant: false,
              topValues: STATUSES,
              profiledAt: '2026-09-23T00:00:00Z',
            },
          },
          {
            name: 'claim_number',
            type: 'text',
            nullable: false,
            sampleValues: ['C-0001', 'C-0002'],
          },
          { name: 'is_test', type: 'boolean', nullable: false },
        ],
      },
      {
        key: REGIONS,
        columns: [
          { name: 'id', type: 'bigint', nullable: false },
          {
            name: 'name',
            type: 'text',
            nullable: false,
            sampleValues: REGION_NAMES,
          },
        ],
      },
    ],
  },
];

type Bridge = jest.Mocked<Required<DatasetToolServices>>;

function install(
  overrides: Partial<Record<keyof DatasetToolServices, unknown>> = {},
): Bridge {
  const bridge = {
    getDatasets: jest.fn(async () => SNAPSHOTS),
    sampleRows: jest.fn(),
    runReadOnlySql: jest.fn(),
    createVisual: jest.fn(),
    updateVisual: jest.fn(),
    lookupValues: jest.fn(async () => []),
    knowledgeFor: jest.fn(async () => ({ snippets: [], metrics: [] })),
    defaultFilters: jest.fn(async () => []),
    ...overrides,
  } as unknown as Bridge;
  setDatasetToolServices(bridge);
  return bridge;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function call(
  tool: { execute?: (...args: any[]) => any },
  input: unknown,
  engine?: Partial<EngineOptions>,
): Promise<any> {
  const requestContext = new RequestContext();
  requestContext.set(DATASETS_CONTEXT_KEY, ['Health Insurance']);
  if (engine)
    requestContext.set(
      ENGINE_OPTIONS_CONTEXT_KEY,
      resolveEngineOptions(engine),
    );
  return tool.execute!(input, { requestContext });
}

describe('fuzzy value matching', () => {
  it('normalises case, accents and punctuation', () => {
    expect(normalizeForMatch('  São-Paulo! ')).toBe('sao paulo');
  });

  it('resolves a casing difference exactly', () => {
    const [first] = rankValues('paid', STATUSES);
    expect(first).toEqual({ value: 'PAID', count: 700, score: 1 });
  });

  it('does not turn a misspelt business term into a status', () => {
    // "approved" means PAID — a fact for lookup_knowledge, not a spelling.
    expect(rankValues('aproved', STATUSES)).toEqual([]);
    expect(rankValues('approved', STATUSES)).toEqual([]);
  });

  it('forgives a transposition, ranks the right city first, not the look-alike', () => {
    const ranked = rankValues(
      'New Yrok',
      REGION_NAMES.map((value) => ({ value })),
    );
    expect(ranked[0].value).toBe('New York');
    expect(ranked.map((match) => match.value)).not.toContain('Newark');
  });

  it('matches a part of a value, and accents both ways', () => {
    expect(
      rankValues(
        'york',
        REGION_NAMES.map((value) => ({ value })),
      )[0].value,
    ).toBe('New York');
    expect(
      rankValues(
        'Sao Paulo',
        REGION_NAMES.map((value) => ({ value })),
      )[0],
    ).toEqual({ value: 'São Paulo', score: 1 });
  });

  it('keeps every score inside [threshold, 1]', () => {
    for (const phrase of ['pend', 'reversal', 'denid', 'x']) {
      for (const match of rankValues(phrase, STATUSES)) {
        expect(match.score).toBeGreaterThanOrEqual(MATCH_THRESHOLD);
        expect(match.score).toBeLessThanOrEqual(1);
      }
    }
    expect(valueSimilarity('', 'PAID')).toBe(0);
    expect(rankValues('denid', STATUSES)[0].value).toBe('DENIED');
  });
});

describe('lookup_values', () => {
  it('answers from a complete profile without touching the datasource', async () => {
    const bridge = install();
    const output = await call(lookupValuesTool, {
      entity: CLAIMS,
      column: 'status',
      phrase: 'Paid',
    });
    expect(output).toEqual({
      entity: CLAIMS,
      column: 'status',
      matches: [{ value: 'PAID', count: 700, score: 1 }],
      source: 'profile',
      note: 'Use the exact value in your filter — stored values are case-sensitive.',
    });
    expect(bridge.lookupValues).not.toHaveBeenCalled();
  });

  it('lists the vocabulary when nothing resembles the phrase', async () => {
    install();
    const output = await call(lookupValuesTool, {
      entity: CLAIMS,
      column: 'status',
      phrase: 'approved',
    });
    expect(output.matches).toEqual([]);
    expect(output.note).toContain('It holds: PAID, DENIED, PENDING, REVERSED.');
    expect(output.note).toContain('lookup_knowledge');
  });

  it('goes live when only sample values are stored', async () => {
    const bridge = install({
      lookupValues: jest.fn(async () => [
        { value: 'New York', count: 120 },
        { value: 'New York Metro', count: 12 },
      ]),
    });
    const output = await call(lookupValuesTool, {
      entity: REGIONS,
      column: 'name',
      phrase: 'new york',
      limit: 5,
    });
    expect(bridge.lookupValues).toHaveBeenCalledWith(
      'pg-1',
      REGIONS,
      'name',
      'new york',
      25,
    );
    expect(output.source).toBe('live');
    expect(output.matches[0]).toEqual({
      value: 'New York',
      count: 120,
      score: 1,
    });
  });

  it('falls back to the stored samples when the live lookup fails or finds nothing', async () => {
    install({
      lookupValues: jest.fn(async () => {
        throw new Error('warehouse asleep');
      }),
    });
    const failed = await call(lookupValuesTool, {
      entity: REGIONS,
      column: 'name',
      phrase: 'New Yrok',
    });
    expect(failed.source).toBe('profile');
    expect(failed.matches[0].value).toBe('New York');

    install({ lookupValues: jest.fn(async () => []) });
    const empty = await call(lookupValuesTool, {
      entity: REGIONS,
      column: 'name',
      phrase: 'New Yrok',
    });
    expect(empty.source).toBe('profile');
    expect(empty.matches[0].value).toBe('New York');
  });

  it('accepts schema.table when it names one entity, refuses anything outside the session', async () => {
    install();
    expect(
      (
        await call(lookupValuesTool, {
          entity: 'health_insurance.claims',
          column: 'status',
          phrase: 'paid',
        })
      ).entity,
    ).toBe(CLAIMS);
    expect(
      await call(lookupValuesTool, {
        entity: 'other.schema.claims_x',
        column: 'status',
        phrase: 'paid',
      }),
    ).toEqual({
      error: `Entity "other.schema.claims_x" is not part of this session's datasets`,
    });
  });

  it('names the closest columns for an unknown one', async () => {
    install();
    const output = await call(lookupValuesTool, {
      entity: CLAIMS,
      column: 'claim_status',
      phrase: 'paid',
    });
    expect(output.error).toMatch(
      /^Column "claim_status" is not on .*claims — closest: status/,
    );
  });
});

describe('lookup_knowledge', () => {
  it('asks the bridge with the session datasets and the resolved entity', async () => {
    const bridge = install({
      knowledgeFor: jest.fn(async () => ({
        snippets: [
          {
            kind: 'term',
            title: 'Approved',
            body: "'approved' means status PAID",
            column: 'status',
          },
        ],
        metrics: [
          {
            name: 'net_paid',
            entity: CLAIMS,
            expression: 'SUM(paid_amount_cents)',
          },
        ],
      })),
    });
    const output = await call(lookupKnowledgeTool, {
      phrase: 'approved',
      entity: 'health_insurance.claims',
      column: 'status',
    });
    expect(bridge.knowledgeFor).toHaveBeenCalledWith(['Health Insurance'], {
      phrase: 'approved',
      entity: CLAIMS,
      column: 'status',
    });
    expect(output.snippets).toHaveLength(1);
    expect(output.metrics).toHaveLength(1);
    expect(output.note).toMatch(/^Curated by the data owner/);
  });

  it('says plainly when nothing is defined', async () => {
    install();
    const output = await call(lookupKnowledgeTool, { phrase: 'churn' });
    expect(output).toEqual({
      snippets: [],
      metrics: [],
      note: 'No curated definition matches — rely on the schema and the stored values, and do not invent a definition.',
    });
  });

  it('refuses an entity outside the session and stays empty in the bare arm', async () => {
    const bridge = install();
    expect(
      (await call(lookupKnowledgeTool, { phrase: 'x', entity: 'other.s.t' }))
        .error,
    ).toContain('is not part of');
    const bare = await call(
      lookupKnowledgeTool,
      { phrase: 'approved' },
      { context: 'bare' },
    );
    expect(bare.snippets).toEqual([]);
    expect(bridge.knowledgeFor).not.toHaveBeenCalled();
  });

  it('reports a failed lookup as a tool error', async () => {
    install({
      knowledgeFor: jest.fn(async () => {
        throw new Error('store down');
      }),
    });
    expect(await call(lookupKnowledgeTool, { phrase: 'approved' })).toEqual({
      error: 'Knowledge lookup failed: store down',
    });
  });
});

describe('lookup tool registration', () => {
  it('uses exactly the ids SessionsService filters by', () => {
    expect(Object.keys(lookupTools)).toEqual([...LOOKUP_TOOL_NAMES]);
    for (const [key, tool] of Object.entries(lookupTools))
      expect(tool.id).toBe(key);
  });
});
