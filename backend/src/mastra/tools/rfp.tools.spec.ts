import { RequestContext } from '@mastra/core/request-context';
import {
  type DatasetSnapshot,
  type DatasetToolServices,
  type RestTarget,
  setDatasetToolServices,
} from '../tool-services';
import {
  RFP_CREATED_BY_CONTEXT_KEY,
  TURN_RFP_CONTEXT_KEY,
} from '../rfp-context';
import {
  NO_REST_DATASOURCE_ERROR,
  apiErrorText,
  rfpApiUrl,
  rfpTools,
} from './rfp.tools';

type Execute = (
  input: Record<string, unknown>,
  context: { requestContext: RequestContext },
) => Promise<unknown>;

const BASE = 'http://127.0.0.1:3100';
const HEADERS = { 'X-API-Key': 'secret' };
const RFP_ID = '3f0c1b2a-0000-4000-8000-000000000001';

const DATASETS: DatasetSnapshot[] = [
  {
    name: 'World Cup',
    datasourceId: 'pg-1',
    datasourceKind: 'postgres',
    tables: [],
  },
  {
    name: 'Intellify RFP API',
    datasourceId: 'rest-1',
    datasourceKind: 'rest',
    tables: [],
  },
];

let services: jest.Mocked<
  Pick<DatasetToolServices, 'getDatasets' | 'restTarget' | 'exportRfpPackage'>
>;
let fetchMock: jest.Mock;

function contextWith(
  datasets: string[] = ['World Cup', 'Intellify RFP API'],
): RequestContext {
  const context = new RequestContext();
  context.set('datasets', datasets);
  context.set('session-id', 's-1');
  context.set(RFP_CREATED_BY_CONTEXT_KEY, 'user:42');
  context.set(TURN_RFP_CONTEXT_KEY, {});
  return context;
}

function run(
  name: keyof typeof rfpTools,
  input: Record<string, unknown>,
  context = contextWith(),
): Promise<unknown> {
  const execute = rfpTools[name].execute as unknown as Execute;
  return execute(input, { requestContext: context });
}

function respond(status: number, body: unknown): void {
  fetchMock.mockResolvedValueOnce(
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
    }),
  );
}

/** The one request the tool sent. */
function sent(): {
  url: string;
  method: string;
  body: unknown;
  headers: Record<string, string>;
} {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return {
    url,
    method: String(init.method),
    body: init.body === undefined ? undefined : JSON.parse(init.body as string),
    headers: init.headers as Record<string, string>,
  };
}

beforeEach(() => {
  services = {
    getDatasets: jest.fn((names: string[]) =>
      Promise.resolve(DATASETS.filter((d) => names.includes(d.name))),
    ),
    restTarget: jest.fn<Promise<RestTarget>, [string]>(() =>
      Promise.resolve({ baseUrl: BASE, headers: HEADERS }),
    ),
    exportRfpPackage: jest.fn(),
  };
  setDatasetToolServices(services as unknown as DatasetToolServices);
  fetchMock = jest.fn();
  global.fetch = fetchMock;
});

describe('target resolution (agents.md 3.10)', () => {
  it('calls the first REST datasource of the session, with its headers', async () => {
    respond(200, {
      data: [{ oneCode: 'IC100100' }],
      page: 1,
      per_page: 50,
      total: 1,
    });

    const result = await run('list_clients', { query: ' orchard ' });

    expect(services.restTarget).toHaveBeenCalledWith('rest-1');
    const request = sent();
    expect(request.url).toBe(`${BASE}/v1/clients?q=orchard&per_page=50`);
    expect(request.method).toBe('GET');
    expect(request.headers).toEqual({
      'X-API-Key': 'secret',
      Accept: 'application/json',
    });
    // With the API's total, so the model never counts rows.
    expect(result).toEqual({ clients: [{ oneCode: 'IC100100' }], total: 1 });
  });

  it('answers the fixed message when no REST datasource is in scope', async () => {
    for (const datasets of [['World Cup'], []]) {
      expect(
        await run(
          'get_client_renewals',
          { clientOneCode: 'IC1' },
          contextWith(datasets),
        ),
      ).toEqual({ error: NO_REST_DATASOURCE_ERROR });
    }
    expect(NO_REST_DATASOURCE_ERROR).toBe(
      'No Intellify API datasource is bound to this session. Load the "Intellify RFP API" sample in Settings → Testing Data and start the chat from the RFP Builder card.',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns a bridge failure as an error, never throwing', async () => {
    services.restTarget.mockRejectedValueOnce(
      new Error('Datasource "rest-1" not found'),
    );
    expect(await run('get_rfp', { rfpId: RFP_ID })).toEqual({
      error: 'Datasource "rest-1" not found',
    });
  });

  it('builds URLs without doubling /v1 or sending empty params', () => {
    expect(
      rfpApiUrl(`${BASE}/`, '/v1/carriers', {
        line: undefined,
        clientOneCode: '',
      }),
    ).toBe(`${BASE}/v1/carriers`);
    expect(rfpApiUrl(`${BASE}/v1/`, '/v1/rfps', { status: 'draft' })).toBe(
      `${BASE}/v1/rfps?status=draft`,
    );
  });
});

describe('errors (agents.md 3.10, Call)', () => {
  it('maps an API error to "<status> <code>: <message>[; <details>]"', async () => {
    respond(400, {
      statusCode: 400,
      error: 'Bad Request',
      message: 'Invalid lines',
      code: 'validation',
      details: ['Unknown line "Pet"', 'Plan design "x" is not the client\'s'],
    });
    expect(await run('get_rfp', { rfpId: RFP_ID })).toEqual({
      error:
        '400 validation: Invalid lines; Unknown line "Pet"; Plan design "x" is not the client\'s',
    });
  });

  it('falls back to the error name when there is no code', () => {
    expect(
      apiErrorText(401, {
        statusCode: 401,
        error: 'Unauthorized',
        message: 'API key required',
      }),
    ).toBe('401 Unauthorized: API key required');
    expect(apiErrorText(502, undefined, 'Bad gateway')).toBe(
      '502 error: Bad gateway',
    );
  });

  it('reports an unreachable API with its address and cause', async () => {
    fetchMock.mockRejectedValueOnce(
      Object.assign(new TypeError('fetch failed'), {
        cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:3100'), {
          code: 'ECONNREFUSED',
        }),
      }),
    );
    expect(await run('list_rfps', {})).toEqual({
      error: `Intellify API unreachable at ${BASE}: connect ECONNREFUSED 127.0.0.1:3100`,
    });
  });

  it('reports a timeout as unreachable', async () => {
    fetchMock.mockRejectedValueOnce(
      Object.assign(new Error('The operation was aborted due to timeout'), {
        name: 'TimeoutError',
      }),
    );
    expect(await run('get_client_census', { clientOneCode: 'IC1' })).toEqual({
      error: `Intellify API unreachable at ${BASE}: no answer within 20 s`,
    });
  });
});

describe('read tools', () => {
  it('get_client_financials adds the columns of its rows', async () => {
    respond(200, {
      planYear: 2026,
      rows: [
        { line: 'Medical', annualPremium: 10 },
        { line: 'Dental', carrier: 'Cigna' },
      ],
      totals: { annualPremium: 10 },
    });

    const result = await run('get_client_financials', {
      clientOneCode: 'IC 1',
      line: 'Medical',
    });

    expect(sent().url).toBe(
      `${BASE}/v1/clients/IC%201/financials?line=Medical`,
    );
    expect(result).toEqual({
      planYear: 2026,
      columns: ['line', 'annualPremium', 'carrier'],
      rows: [
        { line: 'Medical', annualPremium: 10 },
        { line: 'Dental', carrier: 'Cigna' },
      ],
      totals: { annualPremium: 10 },
    });
  });

  it('list_reference_data reads the matching collection', async () => {
    respond(200, { data: [{ name: 'PPO' }] });
    expect(
      await run('list_reference_data', { kind: 'plan-types', line: 'Medical' }),
    ).toEqual({
      items: [{ name: 'PPO' }],
    });
    expect(sent().url).toBe(`${BASE}/v1/plan-types?line=Medical&per_page=500`);
  });

  it("list_rfps puts the current user's records first", async () => {
    respond(200, {
      data: [
        { id: 'a', createdBy: 'user:7' },
        { id: 'b', createdBy: 'user:42' },
        { id: 'c', createdBy: null },
        { id: 'd', createdBy: 'user:42' },
      ],
    });
    const result = (await run('list_rfps', { status: 'draft' })) as {
      rfps: { id: string }[];
    };
    expect(result.rfps.map((rfp) => rfp.id)).toEqual(['b', 'd', 'a', 'c']);
    expect(sent().url).toBe(`${BASE}/v1/rfps?status=draft&per_page=100`);
  });

  it("get_rfp makes the record the turn's RFP", async () => {
    const context = contextWith();
    respond(200, { id: RFP_ID, title: 'Orchard' });
    await run('get_rfp', { rfpId: RFP_ID }, context);
    expect(context.get(TURN_RFP_CONTEXT_KEY)).toEqual({ rfpId: RFP_ID });
  });
});

describe('write tools build the request body (api.md 2.16.4)', () => {
  it('create_rfp sends the creator and remembers the new RFP', async () => {
    const context = contextWith();
    respond(201, { id: RFP_ID, status: 'draft' });

    await run(
      'create_rfp',
      { clientOneCode: 'IC100100', planYear: 2027 },
      context,
    );

    expect(sent()).toMatchObject({
      url: `${BASE}/v1/rfps`,
      method: 'POST',
      body: { clientOneCode: 'IC100100', planYear: 2027, createdBy: 'user:42' },
    });
    expect(sent().headers['Content-Type']).toBe('application/json');
    expect(context.get(TURN_RFP_CONTEXT_KEY)).toEqual({ rfpId: RFP_ID });
  });

  it("create_rfp leaves the turn's RFP alone when it fails", async () => {
    const context = contextWith();
    respond(400, { code: 'validation', message: 'Client "X" not found' });
    expect(
      await run('create_rfp', { clientOneCode: 'X', planYear: 2027 }, context),
    ).toEqual({
      error: '400 validation: Client "X" not found',
    });
    expect(context.get(TURN_RFP_CONTEXT_KEY)).toEqual({});
  });

  it('update_rfp sends one section, the stage and the status', async () => {
    respond(200, { id: RFP_ID });
    await run('update_rfp', {
      rfpId: RFP_ID,
      status: 'ready',
      stage: 7,
      sectionName: 'executiveSummary',
      sectionText: 'On behalf of …',
    });
    expect(sent()).toMatchObject({
      url: `${BASE}/v1/rfps/${RFP_ID}`,
      method: 'PATCH',
      body: {
        status: 'ready',
        stage: 7,
        sections: { executiveSummary: 'On behalf of …' },
      },
    });
  });

  it("remembers the RFP's last completed stage for the workflow tracker", async () => {
    const context = contextWith();
    respond(200, { id: RFP_ID, stage: 0 });
    await run(
      'create_rfp',
      { clientOneCode: 'IC100100', planYear: 2027 },
      context,
    );
    expect(context.get(TURN_RFP_CONTEXT_KEY)).toEqual({
      rfpId: RFP_ID,
      stage: 0,
    });

    respond(200, { id: RFP_ID, stage: 3 });
    await run('update_rfp', { rfpId: RFP_ID, stage: 3 }, context);
    expect(context.get(TURN_RFP_CONTEXT_KEY)).toEqual({
      rfpId: RFP_ID,
      stage: 3,
    });

    respond(400, { code: 'validation', message: 'no' });
    await run('update_rfp', { rfpId: RFP_ID, stage: 9 }, context);
    expect(context.get(TURN_RFP_CONTEXT_KEY)).toMatchObject({ stage: 3 });
  });

  it('update_rfp refuses a section name without text, or nothing to change', async () => {
    expect(
      await run('update_rfp', { rfpId: RFP_ID, sectionName: 'notes' }),
    ).toEqual({
      error: 'Pass sectionName and sectionText together',
    });
    expect(await run('update_rfp', { rfpId: RFP_ID })).toHaveProperty('error');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('set_rfp_lines', async () => {
    respond(200, { id: RFP_ID });
    await run('set_rfp_lines', {
      rfpId: RFP_ID,
      lines: [
        '- Medical | alternate | all | Self-Funded | - | Quote a self-funded option',
        '- Dental | as-is | pd1, pd2 | - | - | -',
      ].join('\n'),
    });
    expect(sent()).toMatchObject({
      url: `${BASE}/v1/rfps/${RFP_ID}/lines`,
      method: 'PUT',
      body: [
        {
          line: 'Medical',
          marketBasis: 'alternate',
          planDesignIds: [],
          alternateFunding: 'Self-Funded',
          notes: 'Quote a self-funded option',
        },
        { line: 'Dental', marketBasis: 'as-is', planDesignIds: ['pd1', 'pd2'] },
      ],
    });
    const [first, second] = sent().body as Record<string, unknown>[];
    expect(first).not.toHaveProperty('alternatePlanType');
    expect(second).not.toHaveProperty('notes');
  });

  it('set_rfp_carriers', async () => {
    respond(200, { id: RFP_ID });
    await run('set_rfp_carriers', {
      rfpId: RFP_ID,
      carriers:
        'Delta Dental | Dental, Vision | incumbent yes | rfp@delta.example | -\nMetLife | Dental | incumbent no | - | New',
    });
    expect(sent()).toMatchObject({
      url: `${BASE}/v1/rfps/${RFP_ID}/carriers`,
      method: 'PUT',
      body: [
        {
          insurer: 'Delta Dental',
          lines: ['Dental', 'Vision'],
          incumbent: true,
          contactEmail: 'rfp@delta.example',
        },
        {
          insurer: 'MetLife',
          lines: ['Dental'],
          incumbent: false,
          notes: 'New',
        },
      ],
    });
  });

  it('set_rfp_requirements', async () => {
    respond(200, { id: RFP_ID });
    await run('set_rfp_requirements', {
      rfpId: RFP_ID,
      requirements:
        'Pricing | Provide rates by tier | required yes | table\nNetwork | Attach a disruption report | required no | attachment',
    });
    expect(sent()).toMatchObject({
      method: 'PUT',
      url: `${BASE}/v1/rfps/${RFP_ID}/requirements`,
      body: [
        {
          section: 'Pricing',
          question: 'Provide rates by tier',
          required: true,
          answerType: 'table',
        },
        {
          section: 'Network',
          question: 'Attach a disruption report',
          required: false,
          answerType: 'attachment',
        },
      ],
    });
  });

  it('set_rfp_timeline', async () => {
    respond(200, { id: RFP_ID });
    await run('set_rfp_timeline', {
      rfpId: RFP_ID,
      milestones:
        '1. RFP issued | 2026-11-02 | Mercer consultant | -\n2. Proposals due | 2026-12-01 | Carriers | Firm',
    });
    expect(sent()).toMatchObject({
      method: 'PUT',
      url: `${BASE}/v1/rfps/${RFP_ID}/timeline`,
      body: [
        {
          milestone: 'RFP issued',
          dueDate: '2026-11-02',
          owner: 'Mercer consultant',
        },
        {
          milestone: 'Proposals due',
          dueDate: '2026-12-01',
          owner: 'Carriers',
          notes: 'Firm',
        },
      ],
    });
  });

  it('refuses a malformed row before any HTTP call', async () => {
    expect(
      await run('set_rfp_timeline', {
        rfpId: RFP_ID,
        milestones: 'RFP issued | 2026-11-02 | Mercer | -\nDecision 2027-01-15',
      }),
    ).toEqual({
      error:
        'Row 2 "Decision 2027-01-15": expected 4 fields separated by " | "',
    });
    expect(
      await run('set_rfp_lines', {
        rfpId: RFP_ID,
        lines: 'Medical | maybe | all | - | - | -',
      }),
    ).toEqual({
      error:
        'Row 1 "Medical | maybe | all | - | - | -": the market basis must be as-is or alternate',
    });
    expect(
      await run('set_rfp_requirements', {
        rfpId: RFP_ID,
        requirements: 'A | Q | required yes | essay',
      }),
    ).toHaveProperty('error');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(services.restTarget).not.toHaveBeenCalled();
  });
});

describe('export_rfp_draft (BA-229)', () => {
  it('asks the bridge for a draft export and returns its result', async () => {
    const result = {
      rfpId: RFP_ID,
      title: 'DRAFT — Orchard — 2027 benefits RFP',
      files: [{ name: 'rfp.md', bytes: 10 }],
      exportedAt: '2026-10-14T00:00:00.000Z',
      draft: true as const,
    };
    services.exportRfpPackage.mockResolvedValueOnce(result);
    expect(await run('export_rfp_draft', { rfpId: RFP_ID })).toEqual(result);
    expect(services.exportRfpPackage).toHaveBeenCalledWith(
      's-1',
      'rest-1',
      RFP_ID,
      { draft: true },
    );
  });

  it('returns failures as errors, like the final export', async () => {
    services.exportRfpPackage.mockRejectedValueOnce(new Error('404 not_found'));
    expect(await run('export_rfp_draft', { rfpId: RFP_ID })).toEqual({
      error: '404 not_found',
    });
    const noSession = contextWith();
    noSession.set('session-id', undefined);
    expect(await run('export_rfp_draft', { rfpId: RFP_ID }, noSession)).toEqual(
      { error: 'No session in context' },
    );
  });
});

describe('export_rfp_package', () => {
  it('asks the bridge to export into the session', async () => {
    const result = {
      rfpId: RFP_ID,
      title: 'Orchard — 2027 benefits RFP',
      files: [{ name: 'rfp.md', bytes: 10 }],
      exportedAt: '2026-10-14T00:00:00.000Z',
    };
    services.exportRfpPackage.mockResolvedValueOnce(result);

    expect(await run('export_rfp_package', { rfpId: RFP_ID })).toEqual(result);
    expect(services.exportRfpPackage).toHaveBeenCalledWith(
      's-1',
      'rest-1',
      RFP_ID,
      undefined,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns failures as errors', async () => {
    services.exportRfpPackage.mockRejectedValueOnce(
      new Error('404 not_found: RFP "x" not found'),
    );
    expect(await run('export_rfp_package', { rfpId: RFP_ID })).toEqual({
      error: '404 not_found: RFP "x" not found',
    });
    const noSession = contextWith();
    noSession.set('session-id', undefined);
    expect(
      await run('export_rfp_package', { rfpId: RFP_ID }, noSession),
    ).toEqual({
      error: 'No session in context',
    });
  });
});
