import { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import {
  effortLevelsFor,
  nearestEffort,
  type ReasoningEffort,
} from '../../../mastra/effort-levels';
import { buildModel } from '../../../mastra/model-factory';
import { endpointHost } from './config';
import {
  notFoundMessage,
  otherHttpMessage,
  RATE_LIMITED_MESSAGE,
  rejectedKeyMessage,
  TIMEOUT_MESSAGE,
  unreachableMessage,
} from './messages';
import type { CustomProbeOptions, CustomProbeReply } from './probe';

// Anthropic-style connection probe (unit 5, BA-286). Mirrors the Anthropic
// probe in llm.service.ts: a throwaway Mastra agent on the endpoint's model,
// so the same structured-output handling real turns use is proven (R19).

const PROBE_PROMPT =
  'Reply with JSON matching the schema, using the value "ok" for `status`.';
const PROBE_TIMEOUT_MS = 30_000;
const PROBE_MAX_TOKENS = 512;
const PROBE_SCHEMA = z.object({ status: z.string() });

const STRUCTURED_OUTPUT_MESSAGE =
  'Model answered but could not produce structured JSON output, which every agent here requires';

/** Node / undici codes of a failed connection (refused, DNS, reset, …). */
const NETWORK_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ETIMEDOUT',
  'EPIPE',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
]);

interface ProviderFailure {
  statusCode?: number;
  url?: string;
  responseBody?: string;
  network: boolean;
}

/** Errors linked from `err`: its `cause` and an AI SDK RetryError's `lastError`. */
function errorChain(err: unknown): unknown[] {
  const chain: unknown[] = [];
  let current: unknown = err;
  for (let depth = 0; current && depth < 8; depth++) {
    chain.push(current);
    const next = current as { cause?: unknown; lastError?: unknown };
    current = next.cause ?? next.lastError;
  }
  return chain;
}

/** What a failure carries through its cause chain (status, URL, body). */
function providerFailure(err: unknown): ProviderFailure {
  const failure: ProviderFailure = { network: false };
  for (const link of errorChain(err)) {
    if (typeof link !== 'object' || link === null) continue;
    const fields = link as {
      statusCode?: unknown;
      url?: unknown;
      responseBody?: unknown;
      code?: unknown;
      message?: unknown;
    };
    if (failure.statusCode === undefined) {
      if (typeof fields.statusCode === 'number') {
        failure.statusCode = fields.statusCode;
        if (typeof fields.url === 'string') failure.url = fields.url;
        if (typeof fields.responseBody === 'string') {
          failure.responseBody = fields.responseBody;
        }
      }
    }
    if (typeof fields.code === 'string' && NETWORK_CODES.has(fields.code)) {
      failure.network = true;
    }
    if (
      typeof fields.message === 'string' &&
      /fetch failed|Cannot connect to API|socket hang up|getaddrinfo/i.test(
        fields.message,
      )
    ) {
      failure.network = true;
    }
  }
  return failure;
}

/** The R50 text for a failed probe request. */
function failureMessage(err: unknown, baseUrl: string): string {
  const failure = providerFailure(err);
  const status = failure.statusCode;
  if (status === 404) {
    return notFoundMessage(failure.url ?? `${baseUrl}/messages`);
  }
  if (status === 401 || status === 403) return rejectedKeyMessage(status);
  if (status === 429) return RATE_LIMITED_MESSAGE;
  if (status !== undefined) {
    const msg = err instanceof Error ? err.message : String(err);
    return otherHttpMessage(status, failure.responseBody ?? msg);
  }
  if (failure.network) return unreachableMessage(endpointHost(baseUrl));
  const msg = err instanceof Error ? err.message : String(err);
  if (/structured|schema|json|parse|validat/i.test(msg)) {
    return STRUCTURED_OUTPUT_MESSAGE;
  }
  // No HTTP answer at all: the request never reached a server.
  return unreachableMessage(endpointHost(baseUrl));
}

/**
 * The effort the probe sends: the requested one (default the model's lowest
 * level, R40) mapped onto the model's levels; none for a model without
 * levels (R29, R52). Claude levels never include `none` or `minimal`.
 */
function probeEffort(
  model: string,
  requested?: ReasoningEffort,
): Exclude<ReasoningEffort, 'none' | 'minimal'> | undefined {
  const levels = effortLevelsFor(model).filter(
    (level) => level !== 'none' && level !== 'minimal',
  );
  if (!levels.length) return undefined;
  return nearestEffort(levels, requested ?? levels[0]) as Exclude<
    ReasoningEffort,
    'none' | 'minimal'
  >;
}

/**
 * Probes an Anthropic-compatible endpoint. Success returns the reply and
 * latency; every failure throws Error with the user-facing text (R50, R18).
 */
export async function probeAnthropicStyle(
  options: CustomProbeOptions,
): Promise<CustomProbeReply> {
  const { baseUrl, apiKey, model } = options;
  const effort = probeEffort(model, options.effort);
  const built = await buildModel({
    kind: 'custom-anthropic',
    id: `anthropic/${model}`,
    baseUrl,
    ...(apiKey ? { apiKey } : {}),
  });
  const probe = new Agent({
    id: 'llm-connection-probe',
    name: 'LLM connection probe',
    instructions: 'You answer connection probes exactly as asked.',
    model: built,
  });

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  let status: unknown;
  try {
    const result = await probe.generate(PROBE_PROMPT, {
      structuredOutput: { schema: PROBE_SCHEMA },
      modelSettings: { maxOutputTokens: PROBE_MAX_TOKENS },
      ...(effort ? { providerOptions: { anthropic: { effort } } } : {}),
      abortSignal: controller.signal,
    });
    status = (result.object as { status?: unknown } | undefined)?.status;
  } catch (err) {
    if (controller.signal.aborted) throw new Error(TIMEOUT_MESSAGE);
    throw new Error(failureMessage(err, baseUrl));
  } finally {
    clearTimeout(timer);
  }

  if (typeof status !== 'string' || !status.trim()) {
    throw new Error(STRUCTURED_OUTPUT_MESSAGE);
  }
  return { reply: status.trim(), latencyMs: Date.now() - started };
}
