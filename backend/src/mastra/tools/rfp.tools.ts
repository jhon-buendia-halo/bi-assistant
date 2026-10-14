import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getDatasetToolServices, type RestTarget } from '../tool-services';
import { DATASETS_CONTEXT_KEY } from './dataset.tools';
import { SESSION_ID_CONTEXT_KEY } from './visual.tools';
import { askClarificationTool } from './clarification.tool';
import {
  RFP_CREATED_BY_CONTEXT_KEY,
  TURN_RFP_CONTEXT_KEY,
  type TurnRfpHolder,
} from '../rfp-context';
import { listField, optionalField, parseRows, yesNoField } from './rfp-rows';

/**
 * The RFP Builder's tools (agents.md 3.10, ADR-0028). Each one calls the
 * Intellify RFP API (api.md 2.16) over HTTP, at the REST datasource the
 * session's datasets name, resolved per call through the tool-services
 * bridge. None of them runs SQL, and none throws to the model: every failure
 * comes back as `{ error }`.
 */

type Context = { get: (key: string) => unknown; set?: unknown };

/** Per-call timeout of an API request. */
export const RFP_API_TIMEOUT_MS = 20_000;

export const NO_REST_DATASOURCE_ERROR =
  'No Intellify API datasource is bound to this session. Load the "Intellify RFP API" sample in Settings → Testing Data and start the chat from the RFP Builder card.';

type Failure = { error: string };

function isFailure(value: unknown): value is Failure {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { error?: unknown }).error === 'string'
  );
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function contextString(context: Context, key: string): string | undefined {
  const value = context.get(key);
  return typeof value === 'string' && value ? value : undefined;
}

/**
 * The first of the session's datasets (in `datasets` order) bound to a
 * datasource of kind `rest`.
 */
export async function restDatasourceId(
  context: Context,
): Promise<{ datasourceId: string } | Failure> {
  const value = context.get(DATASETS_CONTEXT_KEY);
  const names = Array.isArray(value) ? value.map((v) => String(v)) : [];
  try {
    const snapshots = await getDatasetToolServices().getDatasets(names);
    for (const name of names) {
      const dataset = snapshots.find((snapshot) => snapshot.name === name);
      if (dataset?.datasourceKind === 'rest' && dataset.datasourceId) {
        return { datasourceId: dataset.datasourceId };
      }
    }
  } catch (err) {
    return { error: message(err) };
  }
  return { error: NO_REST_DATASOURCE_ERROR };
}

/** The API's base URL and headers for this call (agents.md 3.10, Target). */
export async function rfpApiTarget(
  context: Context,
): Promise<RestTarget | Failure> {
  const datasource = await restDatasourceId(context);
  if (isFailure(datasource)) return datasource;
  try {
    return await getDatasetToolServices().restTarget(datasource.datasourceId);
  } catch (err) {
    return { error: message(err) };
  }
}

type Query = Record<string, string | number | undefined>;

/** `baseUrl` + `path` + the query's non-empty values. */
export function rfpApiUrl(baseUrl: string, path: string, query?: Query) {
  let base = baseUrl.replace(/\/+$/, '');
  // A datasource saved with the `/v1` base path must not get it twice.
  if (base.endsWith('/v1') && path.startsWith('/v1/')) base = base.slice(0, -3);
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === '') continue;
    params.set(key, String(value));
  }
  const search = params.toString();
  return `${base}${path}${search ? `?${search}` : ''}`;
}

/** `<status> <code>: <message>[; <details>]` from the API's error shape. */
export function apiErrorText(status: number, body: unknown, raw = ''): string {
  const shape = (body ?? {}) as {
    code?: unknown;
    error?: unknown;
    message?: unknown;
    details?: unknown;
  };
  const code =
    typeof shape.code === 'string' && shape.code
      ? shape.code
      : typeof shape.error === 'string' && shape.error
        ? shape.error
        : 'error';
  const text =
    typeof shape.message === 'string' && shape.message
      ? shape.message
      : Array.isArray(shape.message)
        ? shape.message.map(String).join('; ')
        : raw.trim().slice(0, 300) || 'no message';
  const details = Array.isArray(shape.details)
    ? shape.details.map(String).filter(Boolean)
    : [];
  return `${status} ${code}: ${text}${details.length ? `; ${details.join('; ')}` : ''}`;
}

/** Why a request never got an answer. */
function networkCause(err: unknown): string {
  const name = (err as { name?: unknown })?.name;
  if (name === 'TimeoutError' || name === 'AbortError') {
    return `no answer within ${RFP_API_TIMEOUT_MS / 1000} s`;
  }
  const cause = (err as { cause?: unknown })?.cause;
  if (cause instanceof Error && cause.message) return cause.message;
  if (typeof cause === 'object' && cause && 'code' in cause) {
    return String(cause.code);
  }
  return message(err);
}

/**
 * One request to the Intellify RFP API: the JSON body on 2xx, `{ error }`
 * otherwise. Never throws.
 */
export async function callRfpApi(
  target: RestTarget,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  options: { query?: Query; body?: unknown } = {},
): Promise<unknown> {
  const headers: Record<string, string> = {
    ...target.headers,
    Accept: 'application/json',
  };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  let response: Response;
  try {
    response = await fetch(rfpApiUrl(target.baseUrl, path, options.query), {
      method,
      headers,
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(RFP_API_TIMEOUT_MS),
    });
  } catch (err) {
    return {
      error: `Intellify API unreachable at ${target.baseUrl}: ${networkCause(err)}`,
    };
  }
  let raw = '';
  try {
    raw = await response.text();
  } catch (err) {
    return {
      error: `Intellify API unreachable at ${target.baseUrl}: ${networkCause(err)}`,
    };
  }
  let body: unknown;
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    body = undefined;
  }
  if (!response.ok) {
    return { error: apiErrorText(response.status, body, raw) };
  }
  if (body === undefined) {
    return {
      error: `${response.status} invalid_response: the Intellify API did not answer with JSON`,
    };
  }
  return body;
}

/** Resolve the target, then call the API. */
async function request(
  context: Context,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT',
  path: string,
  options: { query?: Query; body?: unknown } = {},
): Promise<unknown> {
  const target = await rfpApiTarget(context);
  if (isFailure(target)) return target;
  return callRfpApi(target, method, path, options);
}

/** A paged collection's rows (`{ data }`), under `key`. */
async function collection(
  context: Context,
  path: string,
  query: Query,
  key: string,
): Promise<unknown> {
  const result = await request(context, 'GET', path, { query });
  if (isFailure(result)) return result;
  const data = (result as { data?: unknown }).data;
  return { [key]: Array.isArray(data) ? data : [] };
}

/** Remember the RFP this turn created or opened (`turn-rfp`, agents.md 4.2). */
function rememberRfp(context: Context, result: unknown): void {
  if (isFailure(result)) return;
  const id = (result as { id?: unknown } | null)?.id;
  const holder = context.get(TURN_RFP_CONTEXT_KEY) as TurnRfpHolder | undefined;
  if (typeof id === 'string' && holder && typeof holder === 'object') {
    holder.rfpId = id;
  }
}

const enc = encodeURIComponent;

const clientOneCode = () =>
  z
    .string()
    .describe(
      'The client\'s code (oneCode, e.g. "IC100100") from list_clients',
    );
const optionalLine = () =>
  z
    .string()
    .optional()
    .describe(
      'A line of coverage by name, e.g. "Medical"; omit for every line',
    );
const rfpId = () =>
  z
    .string()
    .describe('The RFP record id, from create_rfp, list_rfps or get_rfp');

export const listClientsTool = createTool({
  id: 'list_clients',
  description:
    'Find Intellify clients by name or client code. Each client comes with its code (oneCode), headcount, latest census year, lines offered and next renewal date. Pass part of the name the consultant used; omit query to list every client.',
  inputSchema: z.object({
    query: z
      .string()
      .optional()
      .describe('Part of the client name or code, case-insensitive'),
  }),
  execute: async ({ query }, { requestContext }) =>
    collection(
      requestContext,
      '/v1/clients',
      { q: query?.trim(), per_page: 50 },
      'clients',
    ),
});

export const getClientRenewalsTool = createTool({
  id: 'get_client_renewals',
  description:
    "The client's lines of coverage with their carriers, policy numbers, renewal effective dates and kick-off dates. Also the current plan year, each line's annual premium and renewal increase, and upcoming wizards.",
  inputSchema: z.object({ clientOneCode: clientOneCode() }),
  execute: async ({ clientOneCode }, { requestContext }) =>
    request(
      requestContext,
      'GET',
      `/v1/clients/${enc(clientOneCode)}/renewals`,
    ),
});

export const getClientProgramTool = createTool({
  id: 'get_client_program',
  description:
    "The client's current program: every plan design per line with carrier, funding, plan type, eligibility status, census mapping and the latest financials. Pass line to narrow it to one line of coverage.",
  inputSchema: z.object({
    clientOneCode: clientOneCode(),
    line: optionalLine(),
  }),
  execute: async ({ clientOneCode, line }, { requestContext }) =>
    request(
      requestContext,
      'GET',
      `/v1/clients/${enc(clientOneCode)}/program`,
      {
        query: { line },
      },
    ),
});

export const getPlanDesignTool = createTool({
  id: 'get_plan_design',
  description:
    'One plan design in full: the complete financial document, eligibility versions, census plans mapped to it and alternate plans. Use the planDesignId from get_client_program.',
  inputSchema: z.object({
    clientOneCode: clientOneCode(),
    planDesignId: z
      .string()
      .describe('The plan design id, from get_client_program'),
  }),
  execute: async ({ clientOneCode, planDesignId }, { requestContext }) =>
    request(
      requestContext,
      'GET',
      `/v1/clients/${enc(clientOneCode)}/plans/${enc(planDesignId)}`,
    ),
});

/** Column names of `rows`, in first-seen order. */
function columnsOf(rows: unknown[]): string[] {
  const columns: string[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    for (const key of Object.keys(row)) {
      if (!columns.includes(key)) columns.push(key);
    }
  }
  return columns;
}

export const getClientFinancialsTool = createTool({
  id: 'get_client_financials',
  description:
    'Premiums, rates by tier, enrolment, contributions and fees per coverage, with totals. Money is annual premium in USD unless a column says monthly; renewalIncreasePct compares with the prior year.',
  inputSchema: z.object({
    clientOneCode: clientOneCode(),
    line: optionalLine(),
  }),
  execute: async ({ clientOneCode, line }, { requestContext }) => {
    const result = await request(
      requestContext,
      'GET',
      `/v1/clients/${enc(clientOneCode)}/financials`,
      { query: { line } },
    );
    if (isFailure(result)) return result;
    const body = result as {
      planYear?: unknown;
      rows?: unknown;
      totals?: unknown;
    };
    const rows = Array.isArray(body.rows) ? body.rows : [];
    return {
      planYear: body.planYear ?? null,
      columns: columnsOf(rows),
      rows,
      totals: body.totals ?? null,
    };
  },
});

export const getClientCensusTool = createTool({
  id: 'get_client_census',
  description:
    "The client's census for a plan year: headcount, eligibility, enrolment, demographics, states, tiers and the census plans with their mapping. Omit year for the latest census.",
  inputSchema: z.object({
    clientOneCode: clientOneCode(),
    year: z
      .string()
      .optional()
      .describe('Census effective year, e.g. "2026"; omit for the latest'),
  }),
  execute: async ({ clientOneCode, year }, { requestContext }) =>
    request(requestContext, 'GET', `/v1/clients/${enc(clientOneCode)}/census`, {
      query: { year: year?.trim() },
    }),
});

export const getClientCommercialsTool = createTool({
  id: 'get_client_commercials',
  description:
    'Contribution strategy periods, carrier credits, ancillary fees, the national survey answers and point solutions. Carrier credits show their expiration date and whether they are final.',
  inputSchema: z.object({ clientOneCode: clientOneCode() }),
  execute: async ({ clientOneCode }, { requestContext }) =>
    request(
      requestContext,
      'GET',
      `/v1/clients/${enc(clientOneCode)}/commercials`,
    ),
});

export const getMarketingHistoryTool = createTool({
  id: 'get_marketing_history',
  description:
    'Past wizard runs (marketing, renewal, benchmark, new plan) and the alternate plans they produced. Use it to see what was marketed before and which alternates exist.',
  inputSchema: z.object({ clientOneCode: clientOneCode() }),
  execute: async ({ clientOneCode }, { requestContext }) =>
    request(requestContext, 'GET', `/v1/clients/${enc(clientOneCode)}/wizards`),
});

/** The collection behind each reference list. */
const REFERENCE_PATHS = {
  products: '/v1/products',
  'funding-types': '/v1/funding-types',
  'plan-types': '/v1/plan-types',
} as const;

export const listReferenceDataTool = createTool({
  id: 'list_reference_data',
  description:
    'The reference lists: lines of coverage (products), funding types or plan types. Pass line with plan-types to get the plan types of one line of coverage.',
  inputSchema: z.object({
    kind: z
      .enum(['products', 'funding-types', 'plan-types'])
      .describe('Which list: products, funding-types or plan-types'),
    line: z
      .string()
      .optional()
      .describe('For plan-types only: a line of coverage by name'),
  }),
  execute: async ({ kind, line }, { requestContext }) =>
    collection(
      requestContext,
      REFERENCE_PATHS[kind],
      { line: kind === 'plan-types' ? line : undefined, per_page: 500 },
      'items',
    ),
});

export const listCarriersTool = createTool({
  id: 'list_carriers',
  description:
    'Carriers and the lines they write; with a client, which lines they are incumbent on and their final credits. Pass line to keep the carriers writing that line.',
  inputSchema: z.object({
    line: optionalLine(),
    clientOneCode: z
      .string()
      .optional()
      .describe('A client code, to see where each carrier is incumbent'),
  }),
  execute: async ({ line, clientOneCode }, { requestContext }) =>
    collection(
      requestContext,
      '/v1/carriers',
      { line, clientOneCode, per_page: 500 },
      'carriers',
    ),
});

export const createRfpTool = createTool({
  id: 'create_rfp',
  description:
    'Create a draft RFP record for a client and plan year. Only after the consultant confirmed the client and plan year; check list_rfps first for a draft to resume. The title defaults to "<client name> — <plan year> benefits RFP".',
  inputSchema: z.object({
    clientOneCode: clientOneCode(),
    planYear: z
      .number()
      .int()
      .describe('The plan year the RFP is for, e.g. 2027 (2024 to 2035)'),
    title: z.string().optional().describe('A title; omit for the default'),
  }),
  execute: async ({ clientOneCode, planYear, title }, { requestContext }) => {
    const createdBy = contextString(requestContext, RFP_CREATED_BY_CONTEXT_KEY);
    const result = await request(requestContext, 'POST', '/v1/rfps', {
      body: {
        clientOneCode,
        planYear,
        ...(title?.trim() ? { title: title.trim() } : {}),
        ...(createdBy ? { createdBy } : {}),
      },
    });
    rememberRfp(requestContext, result);
    return result;
  },
});

export const listRfpsTool = createTool({
  id: 'list_rfps',
  description:
    "Existing RFP records, newest first. The consultant's own records come first; each shows its client, plan year, status and last completed stage.",
  inputSchema: z.object({
    clientOneCode: z.string().optional().describe("Only this client's RFPs"),
    status: z
      .enum(['draft', 'ready', 'issued', 'closed'])
      .optional()
      .describe('Only RFPs with this status'),
  }),
  execute: async ({ clientOneCode, status }, { requestContext }) => {
    const result = await collection(
      requestContext,
      '/v1/rfps',
      { clientOneCode, status, per_page: 100 },
      'rfps',
    );
    if (isFailure(result)) return result;
    const rfps = (result as { rfps: { createdBy?: unknown }[] }).rfps;
    const me = contextString(requestContext, RFP_CREATED_BY_CONTEXT_KEY);
    if (!me) return { rfps };
    // Own records first, each group newest first as the API sends them.
    return {
      rfps: [
        ...rfps.filter((rfp) => rfp?.createdBy === me),
        ...rfps.filter((rfp) => rfp?.createdBy !== me),
      ],
    };
  },
});

export const getRfpTool = createTool({
  id: 'get_rfp',
  description:
    "One RFP record with its lines, carriers, requirements, timeline and narrative sections. Opening it makes it the session's active RFP.",
  inputSchema: z.object({ rfpId: rfpId() }),
  execute: async ({ rfpId }, { requestContext }) => {
    const result = await request(
      requestContext,
      'GET',
      `/v1/rfps/${enc(rfpId)}`,
    );
    rememberRfp(requestContext, result);
    return result;
  },
});

const SECTION_NAMES = [
  'executiveSummary',
  'clientBackground',
  'scopeStatement',
  'instructionsToBidders',
  'evaluationCriteria',
  'notes',
] as const;

export const updateRfpTool = createTool({
  id: 'update_rfp',
  description:
    "Change an RFP's title, status, effective date, completed stage, or one narrative section. Pass stage to mark a stage completed; pass sectionName with sectionText to save one section (one section per call). Status only moves forward: draft, ready, issued, closed.",
  inputSchema: z.object({
    rfpId: rfpId(),
    title: z.string().optional().describe('A new title'),
    status: z
      .enum(['draft', 'ready', 'issued', 'closed'])
      .optional()
      .describe('A new status; it only moves forward'),
    effectiveDate: z
      .string()
      .optional()
      .describe('A new effective date, YYYY-MM-DD'),
    stage: z
      .number()
      .int()
      .min(0)
      .max(7)
      .optional()
      .describe('The last completed stage, 0 to 7'),
    sectionName: z
      .enum(SECTION_NAMES)
      .optional()
      .describe('The narrative section to save, with sectionText'),
    sectionText: z
      .string()
      .optional()
      .describe('The full text of that section, in Markdown'),
  }),
  execute: async (input, { requestContext }) => {
    const { rfpId, sectionName, sectionText } = input;
    if (!!sectionName !== (sectionText !== undefined)) {
      return { error: 'Pass sectionName and sectionText together' };
    }
    const body: Record<string, unknown> = {};
    if (input.title !== undefined) body['title'] = input.title;
    if (input.status !== undefined) body['status'] = input.status;
    if (input.effectiveDate !== undefined) {
      body['effectiveDate'] = input.effectiveDate;
    }
    if (input.stage !== undefined) body['stage'] = input.stage;
    if (sectionName) body['sections'] = { [sectionName]: sectionText };
    if (Object.keys(body).length === 0) {
      return {
        error:
          'Nothing to change: pass title, status, effectiveDate, stage, or sectionName with sectionText',
      };
    }
    return request(requestContext, 'PATCH', `/v1/rfps/${enc(rfpId)}`, {
      body,
    });
  },
});

/** A row-level problem other than the field count. */
function rowError(index: number, row: string[], problem: string): Failure {
  return { error: `Row ${index + 1} "${row.join(' | ')}": ${problem}` };
}

/** `PUT /v1/rfps/:id/lines` body items from `set_rfp_lines` rows. */
export function linesBody(text: string): unknown[] | Failure {
  const parsed = parseRows(text, 6);
  if ('error' in parsed) return parsed;
  const items: unknown[] = [];
  for (const [index, row] of parsed.rows.entries()) {
    const [line, basis, plans, funding, planType, notes] = row;
    const marketBasis = basis.toLowerCase();
    if (marketBasis !== 'as-is' && marketBasis !== 'alternate') {
      return rowError(
        index,
        row,
        'the market basis must be as-is or alternate',
      );
    }
    // `all` keeps every plan design of the line in scope: an empty list.
    const planDesignIds =
      plans.trim().toLowerCase() === 'all' ? [] : listField(plans);
    items.push({
      line,
      marketBasis,
      planDesignIds,
      alternateFunding: optionalField(funding),
      alternatePlanType: optionalField(planType),
      notes: optionalField(notes),
    });
  }
  return items;
}

/** `PUT /v1/rfps/:id/carriers` body items from `set_rfp_carriers` rows. */
export function carriersBody(text: string): unknown[] | Failure {
  const parsed = parseRows(text, 5);
  if ('error' in parsed) return parsed;
  const items: unknown[] = [];
  for (const [index, row] of parsed.rows.entries()) {
    const [insurer, lines, incumbentText, email, notes] = row;
    const incumbent = yesNoField(incumbentText);
    if (incumbent === undefined) {
      return rowError(index, row, 'the incumbent field must be yes or no');
    }
    items.push({
      insurer,
      lines: listField(lines),
      incumbent,
      contactEmail: optionalField(email),
      notes: optionalField(notes),
    });
  }
  return items;
}

const ANSWER_TYPES = ['text', 'yes_no', 'number', 'table', 'attachment'];

/** `PUT /v1/rfps/:id/requirements` body items from `set_rfp_requirements` rows. */
export function requirementsBody(text: string): unknown[] | Failure {
  const parsed = parseRows(text, 4);
  if ('error' in parsed) return parsed;
  const items: unknown[] = [];
  for (const [index, row] of parsed.rows.entries()) {
    const [section, question, requiredText, typeText] = row;
    const required = yesNoField(requiredText);
    if (required === undefined) {
      return rowError(index, row, 'the required field must be yes or no');
    }
    const answerType = typeText.toLowerCase().replace(/[\s/-]+/g, '_');
    if (!ANSWER_TYPES.includes(answerType)) {
      return rowError(
        index,
        row,
        `the answer type must be one of ${ANSWER_TYPES.join(', ')}`,
      );
    }
    items.push({ section, question, required, answerType });
  }
  return items;
}

/** `PUT /v1/rfps/:id/timeline` body items from `set_rfp_timeline` rows. */
export function timelineBody(text: string): unknown[] | Failure {
  const parsed = parseRows(text, 4);
  if ('error' in parsed) return parsed;
  return parsed.rows.map(([milestone, dueDate, owner, notes]) => ({
    milestone,
    dueDate,
    owner: optionalField(owner),
    notes: optionalField(notes),
  }));
}

/** A `set_rfp_*` tool: parse the rows, then replace the list. */
async function replaceList(
  context: Context,
  rfpIdValue: string,
  path: 'lines' | 'carriers' | 'requirements' | 'timeline',
  body: unknown[] | Failure,
): Promise<unknown> {
  if (isFailure(body)) return body;
  return request(context, 'PUT', `/v1/rfps/${enc(rfpIdValue)}/${path}`, {
    body,
  });
}

export const setRfpLinesTool = createTool({
  id: 'set_rfp_lines',
  description:
    'Replace the lines of coverage in scope, one per line of text. Each row: <line> | as-is or alternate | <plan design ids, comma-separated, or all> | <alternate funding or -> | <alternate plan type or -> | <notes or ->. Send the whole list every time: it replaces the saved one.',
  inputSchema: z.object({
    rfpId: rfpId(),
    lines: z
      .string()
      .describe(
        'One row per line of coverage: <line> | as-is or alternate | <plan design ids, comma-separated, or all> | <alternate funding or -> | <alternate plan type or -> | <notes or ->',
      ),
  }),
  execute: async ({ rfpId, lines }, { requestContext }) =>
    replaceList(requestContext, rfpId, 'lines', linesBody(lines)),
});

export const setRfpCarriersTool = createTool({
  id: 'set_rfp_carriers',
  description:
    'Replace the carriers invited, one per line of text. Each row: <carrier name> | <lines, comma-separated> | incumbent yes or no | <contact email or -> | <notes or ->. Send the whole list every time: it replaces the saved one.',
  inputSchema: z.object({
    rfpId: rfpId(),
    carriers: z
      .string()
      .describe(
        'One row per carrier: <carrier name> | <lines, comma-separated> | incumbent yes or no | <contact email or -> | <notes or ->',
      ),
  }),
  execute: async ({ rfpId, carriers }, { requestContext }) =>
    replaceList(requestContext, rfpId, 'carriers', carriersBody(carriers)),
});

export const setRfpRequirementsTool = createTool({
  id: 'set_rfp_requirements',
  description:
    'Replace the requirements and questionnaire, one per line of text. Each row: <section> | <question> | required yes or no | text, yes_no, number, table or attachment. Send the whole list every time: it replaces the saved one.',
  inputSchema: z.object({
    rfpId: rfpId(),
    requirements: z
      .string()
      .describe(
        'One row per question: <section> | <question> | required yes or no | text, yes_no, number, table or attachment',
      ),
  }),
  execute: async ({ rfpId, requirements }, { requestContext }) =>
    replaceList(
      requestContext,
      rfpId,
      'requirements',
      requirementsBody(requirements),
    ),
});

export const setRfpTimelineTool = createTool({
  id: 'set_rfp_timeline',
  description:
    'Replace the timeline, one milestone per line of text. Each row: <milestone> | <YYYY-MM-DD> | <owner or -> | <notes or ->. Send the whole list every time: it replaces the saved one.',
  inputSchema: z.object({
    rfpId: rfpId(),
    milestones: z
      .string()
      .describe(
        'One row per milestone: <milestone> | <YYYY-MM-DD> | <owner or -> | <notes or ->',
      ),
  }),
  execute: async ({ rfpId, milestones }, { requestContext }) =>
    replaceList(requestContext, rfpId, 'timeline', timelineBody(milestones)),
});

export const exportRfpPackageTool = createTool({
  id: 'export_rfp_package',
  description:
    'Assemble the RFP package (Markdown and PDF document, CSV exhibits) and make it downloadable from this chat. Call it only after the consultant confirmed the stage-7 review; exporting again replaces the earlier package.',
  inputSchema: z.object({ rfpId: rfpId() }),
  execute: async ({ rfpId }, { requestContext }) => {
    const sessionId = contextString(requestContext, SESSION_ID_CONTEXT_KEY);
    if (!sessionId) return { error: 'No session in context' };
    const datasource = await restDatasourceId(requestContext);
    if (isFailure(datasource)) return datasource;
    try {
      return await getDatasetToolServices().exportRfpPackage(
        sessionId,
        datasource.datasourceId,
        rfpId,
      );
    } catch (err) {
      return { error: message(err) };
    }
  },
});

/** Every tool the RFP Builder is given, in the order its prompt lists them (agents.md 3.10). */
export const rfpTools = {
  list_clients: listClientsTool,
  get_client_renewals: getClientRenewalsTool,
  get_client_program: getClientProgramTool,
  get_plan_design: getPlanDesignTool,
  get_client_financials: getClientFinancialsTool,
  get_client_census: getClientCensusTool,
  get_client_commercials: getClientCommercialsTool,
  get_marketing_history: getMarketingHistoryTool,
  list_reference_data: listReferenceDataTool,
  list_carriers: listCarriersTool,
  create_rfp: createRfpTool,
  list_rfps: listRfpsTool,
  get_rfp: getRfpTool,
  update_rfp: updateRfpTool,
  set_rfp_lines: setRfpLinesTool,
  set_rfp_carriers: setRfpCarriersTool,
  set_rfp_requirements: setRfpRequirementsTool,
  set_rfp_timeline: setRfpTimelineTool,
  export_rfp_package: exportRfpPackageTool,
  ask_clarification: askClarificationTool,
};
