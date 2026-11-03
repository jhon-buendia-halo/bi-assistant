import {
  effortLevelsFor,
  type ReasoningEffort,
} from '../../../mastra/effort-levels';
import { rejectsMaxTokens } from '../../../mastra/model-compat';
import { endpointHost } from './config';
import {
  notFoundMessage,
  otherHttpMessage,
  RATE_LIMITED_MESSAGE,
  rejectedKeyMessage,
  TIMEOUT_MESSAGE,
  unreachableMessage,
} from './messages';

// Connection probes per API style (units 4 and 5: BA-285, BA-286).

export interface CustomProbeOptions {
  /** Already normalised (`normalizeBaseUrl`). */
  baseUrl: string;
  apiKey?: string;
  model: string;
  effort?: ReasoningEffort;
}

/** Success; failures throw Error with the user-facing text (messages.ts). */
export interface CustomProbeReply {
  reply: string;
  latencyMs: number;
}

const PROBE_PROMPT =
  'Reply with JSON matching the schema, using the value "ok" for `status`.';
/** Asked of the no-schema fallbacks, which carry no schema to follow. */
const FALLBACK_PROMPT =
  'Reply with only this JSON object and nothing else: {"status": "ok"}';
const PROBE_TIMEOUT_MS = 30_000;
const PROBE_MAX_TOKENS = 512;
/** Reasoning families count hidden thinking against the cap (R17). */
const PROBE_REASONING_MAX_TOKENS = 4096;

/** Same strict schema the built-in OpenAI/LenAI probe asks for (R14). */
const STRICT_SCHEMA_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'connection_probe',
    strict: true,
    schema: {
      type: 'object',
      properties: { status: { type: 'string' } },
      required: ['status'],
      additionalProperties: false,
    },
  },
} as const;

/**
 * R49: strict schema first; on a 400/422 rejection a JSON object without a
 * schema; then no response format at all.
 */
const FORMAT_STEPS: ReadonlyArray<{
  responseFormat?: Record<string, unknown>;
  prompt: string;
}> = [
  { responseFormat: STRICT_SCHEMA_FORMAT, prompt: PROBE_PROMPT },
  { responseFormat: { type: 'json_object' }, prompt: FALLBACK_PROMPT },
  { prompt: FALLBACK_PROMPT },
];

/** HTTP statuses that mean "this server does not take that response format". */
const FORMAT_REJECTED = new Set([400, 422]);

/**
 * The probe's `status` value, or null when the reply is not
 * `{ "status": "<non-empty string>" }`. A surrounding code fence is tolerated.
 */
export function probeStatus(content: string): string | null {
  let text = content.trim();
  const fenced = /^```[a-z0-9_-]*[ \t]*\r?\n?([\s\S]*?)\r?\n?```$/i.exec(text);
  if (fenced) text = fenced[1].trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }
  const status = (parsed as { status?: unknown }).status;
  if (typeof status !== 'string' || !status.trim()) return null;
  return status.trim();
}

/**
 * The effort to send: the model's lowest level (R16), and none at all for a
 * model without levels (R52). `requested` is honoured only when it is one of
 * the model's levels, so a caller passing the probe effort of
 * `GET /llm/effort-levels` gets exactly that.
 */
function probeEffort(
  model: string,
  requested?: ReasoningEffort,
): ReasoningEffort | undefined {
  const levels = effortLevelsFor(model);
  if (!levels.length) return undefined;
  return requested && levels.includes(requested) ? requested : levels[0];
}

class FormatRejected extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(otherHttpMessage(status, body));
  }
}

/** The R50 text for a non-2xx answer. Never echoes the request headers. */
function httpFailure(status: number, body: string, url: string): Error {
  if (status === 404) return new Error(notFoundMessage(url));
  if (status === 401 || status === 403) {
    return new Error(rejectedKeyMessage(status));
  }
  if (status === 429) return new Error(RATE_LIMITED_MESSAGE);
  return new Error(otherHttpMessage(status, body));
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

/**
 * R54: a server that echoes the request (some proxies put the Authorization
 * header in an error body) must not get the key into an error text.
 */
function redactKey(text: string, apiKey: string | undefined): string {
  return apiKey ? text.split(apiKey).join('***') : text;
}

/**
 * Probes an OpenAI-compatible endpoint with the submitted (unsaved) settings:
 * `POST <base>/chat/completions` with the strict JSON-schema request every
 * agent makes, falling back per R49 when the server rejects the format.
 * Resolves with the reply's `status`; rejects with an R18/R50 text.
 */
export async function probeOpenAiStyle(
  options: CustomProbeOptions,
): Promise<CustomProbeReply> {
  const base = options.baseUrl.replace(/\/+$/, '');
  const url = `${base}/chat/completions`;
  const model = options.model.trim();
  const apiKey = options.apiKey?.trim();
  const reasoning = rejectsMaxTokens(model);
  const capKey = reasoning ? 'max_completion_tokens' : 'max_tokens';
  const cap = reasoning ? PROBE_REASONING_MAX_TOKENS : PROBE_MAX_TOKENS;
  const effort = probeEffort(model, options.effort);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  };

  const host = endpointHost(base);
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  const send = (step: (typeof FORMAT_STEPS)[number]): Promise<string> =>
    attempt({
      url,
      headers,
      signal: controller.signal,
      body: {
        model,
        messages: [{ role: 'user', content: step.prompt }],
        ...(step.responseFormat
          ? { response_format: step.responseFormat }
          : {}),
        [capKey]: cap,
        ...(effort ? { reasoning_effort: effort } : {}),
      },
      cap,
      host,
      apiKey,
    });
  try {
    for (const step of FORMAT_STEPS.slice(0, -1)) {
      try {
        return { reply: await send(step), latencyMs: Date.now() - started };
      } catch (err) {
        // R49: only a 400/422 rejection of the format moves to the next step.
        if (!(err instanceof FormatRejected)) throw err;
      }
    }
    // The last step reports a 400/422 like any other HTTP failure.
    const reply = await send(FORMAT_STEPS[FORMAT_STEPS.length - 1]);
    return { reply, latencyMs: Date.now() - started };
  } catch (err) {
    if (controller.signal.aborted) throw new Error(TIMEOUT_MESSAGE);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

interface ChatCompletion {
  choices?: Array<{
    finish_reason?: string;
    message?: {
      content?: string | Array<{ type?: string; text?: unknown }> | null;
      refusal?: string | null;
    };
  }>;
}

async function attempt(request: {
  url: string;
  headers: Record<string, string>;
  signal: AbortSignal;
  body: Record<string, unknown>;
  cap: number;
  host: string;
  apiKey?: string;
}): Promise<string> {
  let res: Response;
  try {
    res = await fetch(request.url, {
      method: 'POST',
      signal: request.signal,
      headers: request.headers,
      body: JSON.stringify(request.body),
    });
  } catch (err) {
    if (request.signal.aborted) throw new Error(TIMEOUT_MESSAGE);
    // Connection refused, DNS failure, reset, "fetch failed": the cause's
    // detail is left out so nothing of the request is echoed.
    void err;
    throw new Error(unreachableMessage(request.host));
  }

  if (!res.ok) {
    const body = redactKey(await safeText(res), request.apiKey);
    if (request.signal.aborted) throw new Error(TIMEOUT_MESSAGE);
    if (FORMAT_REJECTED.has(res.status)) {
      throw new FormatRejected(res.status, body);
    }
    throw httpFailure(res.status, body, request.url);
  }

  const raw = redactKey(await safeText(res), request.apiKey);
  if (request.signal.aborted) throw new Error(TIMEOUT_MESSAGE);
  let json: ChatCompletion | null = null;
  try {
    json = JSON.parse(raw) as ChatCompletion | null;
  } catch {
    json = null;
  }
  if (!json || typeof json !== 'object') {
    throw new Error(structuredOutputMessage(raw.trim()));
  }
  const choice = json.choices?.[0];
  const content = messageText(choice?.message?.content);
  if (!content && choice?.finish_reason === 'length') {
    throw new Error(
      `Model hit the ${request.cap}-token limit before replying — reasoning models spend that budget thinking first; try a lower reasoning effort or a non-reasoning model`,
    );
  }
  const refusal = choice?.message?.refusal;
  if (!content && typeof refusal === 'string' && refusal) {
    throw new Error(
      `Model refused the connection probe — ${refusal.slice(0, 200)}`,
    );
  }
  const status = probeStatus(content);
  if (status === null) throw new Error(structuredOutputMessage(content));
  return status;
}

/** The reply text: a string, or the text parts of a content-parts array. */
function messageText(content: unknown): string {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content
    .map((part: unknown) => {
      const text = (part as { text?: unknown } | null)?.text;
      return typeof text === 'string' ? text : '';
    })
    .join('')
    .trim();
}

function structuredOutputMessage(content: string): string {
  return `Model answered but could not produce structured JSON output, which every agent here requires — reply="${content.slice(0, 200)}"`;
}
