/**
 * Tokens and cost of eval runs (agents-evals R219 to R221; data-model 3.8 and
 * 4.11). Every model call an attempt makes is recorded under one of four
 * agents (the assistant, the SQL fixer, the visual designer and the judge) and
 * the model it ran on, so a question's cost can be read per agent.
 *
 * Two rules, as on `feat/engine-eval-loop`:
 *
 * 1. Tokens are measured, cost is estimated. Counts come off the result's
 *    usage and are exact; money is counts times a rate from the bundled price
 *    table (`pricing.json`), and a model with no rate makes the cost "not
 *    priced" rather than a confident wrong number.
 * 2. Missing usage is not zero usage. A call whose result carries no token
 *    numbers counts in `unreportedCalls`, never as a free call.
 *
 * Token subsets follow the AI SDK: cached input tokens are part of the input
 * tokens, and reasoning tokens part of the output tokens, so neither is added
 * on top.
 *
 * Pure module: no Nest, no Mastra, no model. The price table is imported
 * (`resolveJsonModule`), so `nest build` emits it next to this module.
 */
import pricingFile from './pricing.json';

export { modelIdOf } from '../model-compat';

/** The agents whose calls an eval attempt records, in report order. */
export const USAGE_AGENTS = [
  'assistant',
  'sql-fixer',
  'designer',
  'judge',
] as const;
export type UsageAgent = (typeof USAGE_AGENTS)[number];

/** The model name recorded when the producer of a call could not tell it. */
export const UNKNOWN_MODEL = 'unknown';

/** Token counts summed over one or more calls. */
export interface TokenUsage {
  inputTokens: number;
  /** Input tokens served from the provider's cache; part of `inputTokens`. */
  cachedInputTokens: number;
  outputTokens: number;
  /** Reasoning tokens; part of `outputTokens`. */
  reasoningTokens: number;
  /** Calls whose result reported token numbers. */
  calls: number;
  /** Calls whose result reported none: their tokens are unknown, not 0. */
  unreportedCalls: number;
}

/** The usage of one agent on one model. */
export interface ModelUsageEntry extends TokenUsage {
  agent: UsageAgent;
  /** The model id without its provider prefix (`normalizeModelId`). */
  model: string;
}

/** A model's rates, in US dollars per million tokens (data-model 4.11). */
export interface ModelRate {
  inputPerMillionUsd: number;
  /** Absent: cached input tokens are billed at the input rate. */
  cachedInputPerMillionUsd?: number;
  outputPerMillionUsd: number;
  /** Where the rate was read, and on which day. */
  source?: string;
  readOn?: string;
}

/** Rates keyed by normalised model id. */
export type PriceTable = Readonly<Record<string, ModelRate>>;

/** A cost in dollars, or the models that ran with no rate. */
export type UsageCost = { usd: number } | { notPriced: string[] };

const RATE_NUMBERS = [
  'inputPerMillionUsd',
  'cachedInputPerMillionUsd',
  'outputPerMillionUsd',
] as const;
const RATE_KEYS: readonly string[] = [...RATE_NUMBERS, 'source', 'readOn'];

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validate a price file (`{ _comment?, models: { <id>: ModelRate } }`) and
 * return its rates. Throws naming the model at fault, so a broken bundled
 * file fails the backend's start, as a broken set file does.
 */
export function parsePriceTable(
  content: unknown,
  file = 'pricing.json',
): PriceTable {
  const fail = (where: string, problem: string): never => {
    throw new Error(
      `Price file ${file}${where ? `, ${where}` : ''}: ${problem}`,
    );
  };
  if (!isObject(content) || !isObject(content.models)) {
    return fail('', 'must be an object with a "models" object');
  }
  const unknownTop = Object.keys(content).filter(
    (key) => key !== 'models' && key !== '_comment',
  );
  if (unknownTop.length > 0) {
    fail(
      '',
      `unknown field(s) ${unknownTop.map((key) => `"${key}"`).join(', ')}`,
    );
  }
  const table: Record<string, ModelRate> = {};
  for (const [id, raw] of Object.entries(content.models)) {
    const where = `model "${id}"`;
    if (id !== normalizeModelId(id) || id.length === 0) {
      fail(
        where,
        'the key must be a lower-case model id with no provider prefix',
      );
    }
    if (!isObject(raw)) return fail(where, 'must be an object');
    const unknown = Object.keys(raw).filter((key) => !RATE_KEYS.includes(key));
    if (unknown.length > 0) {
      fail(
        where,
        `unknown field(s) ${unknown.map((key) => `"${key}"`).join(', ')}; known fields: ${RATE_KEYS.join(', ')}`,
      );
    }
    for (const key of RATE_NUMBERS) {
      const value = raw[key];
      const required = key !== 'cachedInputPerMillionUsd';
      if (value === undefined && !required) continue;
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        fail(where, `"${key}" must be a number of dollars, 0 or more`);
      }
    }
    for (const key of ['source', 'readOn']) {
      if (raw[key] !== undefined && typeof raw[key] !== 'string') {
        fail(where, `"${key}" must be a string`);
      }
    }
    table[id] = raw as unknown as ModelRate;
  }
  return Object.freeze(table);
}

/** The bundled price table (`pricing.json`). */
export const PRICE_TABLE: PriceTable = parsePriceTable(pricingFile);

/**
 * `openai/gpt-4o-mini`, `azure/gpt-4o-mini` and `GPT-4o-mini` all read as
 * `gpt-4o-mini`: trimmed, lower case, without everything up to the last `/`.
 */
export function normalizeModelId(model: string): string {
  const trimmed = (model ?? '').trim().toLowerCase();
  const slash = trimmed.lastIndexOf('/');
  return slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
}

/** A dated snapshot id (`gpt-4o-mini-2024-07-18`) without its date. */
const DATE_SUFFIX = /-\d{4}-\d{2}-\d{2}$/;

/**
 * The rate of `model`: its normalised id, else that id without a date
 * suffix, so a dated snapshot takes its model's rate. Undefined when neither
 * is in the table.
 */
export function rateFor(
  model: string,
  table: PriceTable = PRICE_TABLE,
): ModelRate | undefined {
  const id = normalizeModelId(model);
  return table[id] ?? table[id.replace(DATE_SUFFIX, '')];
}

function count(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  return Math.round(value);
}

/** A count, or the `total` of an AI SDK v6 provider `{ total }` object. */
function tokens(value: unknown): number | undefined {
  return isObject(value) ? count(value.total) : count(value);
}

function first(...values: unknown[]): number | undefined {
  for (const value of values) {
    const found = count(value);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** Read one usage object; undefined when it holds no input or output count. */
function readUsage(raw: unknown): TokenUsage | undefined {
  if (!isObject(raw)) return undefined;
  const input =
    tokens(raw.inputTokens) ??
    first(raw.promptTokens, raw.prompt_tokens, raw.input_tokens);
  const output =
    tokens(raw.outputTokens) ??
    first(raw.completionTokens, raw.completion_tokens, raw.output_tokens);
  // `totalTokens` alone is not a report: Mastra fills it with 0 when the
  // provider sent nothing, and it cannot be split into input and output.
  if (input === undefined && output === undefined) return undefined;
  const nested = (value: unknown, key: string): unknown =>
    isObject(value) ? value[key] : undefined;
  const cached =
    first(
      raw.cachedInputTokens,
      nested(raw.inputTokenDetails, 'cacheReadTokens'),
      nested(raw.inputTokens, 'cacheRead'),
      raw.cachedPromptTokens,
      nested(raw.prompt_tokens_details, 'cached_tokens'),
      nested(raw.input_tokens_details, 'cached_tokens'),
    ) ?? 0;
  const reasoning =
    first(
      raw.reasoningTokens,
      nested(raw.outputTokenDetails, 'reasoningTokens'),
      nested(raw.outputTokens, 'reasoning'),
      nested(raw.completion_tokens_details, 'reasoning_tokens'),
      nested(raw.output_tokens_details, 'reasoning_tokens'),
    ) ?? 0;
  const inputTokens = input ?? 0;
  const outputTokens = output ?? 0;
  return {
    inputTokens,
    cachedInputTokens: Math.min(cached, inputTokens),
    outputTokens,
    reasoningTokens: Math.min(reasoning, outputTokens),
    calls: 1,
    unreportedCalls: 0,
  };
}

/**
 * The tokens one model call's result reports, as one call: `totalUsage`
 * (every step of an agent's generate), else `usage`, else `response.usage`,
 * the first that holds numbers. Reads the names of Mastra and the AI SDK v5
 * (`inputTokens`, `outputTokens`, `cachedInputTokens`, `reasoningTokens`),
 * of the AI SDK v6 (`inputTokenDetails.cacheReadTokens`,
 * `outputTokenDetails.reasoningTokens`, or `{ total, cacheRead }` objects),
 * of the AI SDK v4 (`promptTokens`, `completionTokens`) and OpenAI's own.
 * Undefined when the result reports no number.
 */
export function usageFromResult(result: unknown): TokenUsage | undefined {
  if (!isObject(result)) return undefined;
  const response = isObject(result.response) ? result.response : {};
  return (
    readUsage(result.totalUsage) ??
    readUsage(result.usage) ??
    readUsage(response.usage)
  );
}

function emptyUsage(): TokenUsage {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    calls: 0,
    unreportedCalls: 0,
  };
}

function addInto(target: TokenUsage, usage: TokenUsage): void {
  target.inputTokens += usage.inputTokens;
  target.cachedInputTokens += usage.cachedInputTokens;
  target.outputTokens += usage.outputTokens;
  target.reasoningTokens += usage.reasoningTokens;
  target.calls += usage.calls;
  target.unreportedCalls += usage.unreportedCalls;
}

function agentOrder(entry: { agent: UsageAgent }): number {
  const index = USAGE_AGENTS.indexOf(entry.agent);
  return index < 0 ? USAGE_AGENTS.length : index;
}

/**
 * Add one call of `agent` on `model` to `entries`, in place: its tokens, or
 * one unreported call when its result reports none. The entry for that agent
 * and model is created when missing; entries stay in `USAGE_AGENTS` order,
 * then in order of first call. A blank model is recorded as `unknown`.
 */
export function recordUsage(
  entries: ModelUsageEntry[],
  agent: UsageAgent,
  model: string | undefined,
  result: unknown,
): void {
  const id = normalizeModelId(model ?? '') || UNKNOWN_MODEL;
  let entry = entries.find((e) => e.agent === agent && e.model === id);
  if (!entry) {
    entry = { agent, model: id, ...emptyUsage() };
    entries.push(entry);
    entries.sort((a, b) => agentOrder(a) - agentOrder(b));
  }
  const usage = usageFromResult(result);
  if (usage) addInto(entry, usage);
  else entry.unreportedCalls += 1;
}

/**
 * The sum of two usage lists by agent and model, as a new list in
 * `USAGE_AGENTS` order: an attempt's into its question's, a question's into
 * its run's. A missing list (a result saved before usage) adds nothing.
 */
export function mergeUsage(
  a: readonly ModelUsageEntry[] | undefined,
  b: readonly ModelUsageEntry[] | undefined,
): ModelUsageEntry[] {
  const merged: ModelUsageEntry[] = [];
  for (const entry of [...(a ?? []), ...(b ?? [])]) {
    const found = merged.find(
      (e) => e.agent === entry.agent && e.model === entry.model,
    );
    if (found) addInto(found, entry);
    else merged.push({ ...entry });
  }
  return merged.sort((x, y) => agentOrder(x) - agentOrder(y));
}

/** Every entry's tokens and calls added up. */
export function sumUsage(entries: readonly TokenUsage[]): TokenUsage {
  const total = emptyUsage();
  for (const entry of entries) addInto(total, entry);
  return total;
}

/**
 * The cost of `entries` (agents-evals R221): per entry, (input − cached) ×
 * the input rate + cached × the cached rate (the input rate when the model
 * has none) + output × the output rate, per million tokens, rounded to six
 * decimals. Reasoning tokens are part of the output and are not added again.
 * When any model that ran has no rate, the cost is not priced and lists those
 * models, in order of first appearance; the tokens stay counted.
 */
export function costOf(
  entries: readonly ModelUsageEntry[],
  table: PriceTable = PRICE_TABLE,
): UsageCost {
  const notPriced: string[] = [];
  let dollars = 0;
  for (const entry of entries) {
    if (entry.calls + entry.unreportedCalls === 0) continue;
    const rate = rateFor(entry.model, table);
    if (!rate) {
      if (!notPriced.includes(entry.model)) notPriced.push(entry.model);
      continue;
    }
    const cached = Math.min(entry.cachedInputTokens, entry.inputTokens);
    const cachedRate = rate.cachedInputPerMillionUsd ?? rate.inputPerMillionUsd;
    dollars +=
      ((entry.inputTokens - cached) * rate.inputPerMillionUsd +
        cached * cachedRate +
        entry.outputTokens * rate.outputPerMillionUsd) /
      1_000_000;
  }
  if (notPriced.length > 0) return { notPriced };
  return { usd: Math.round(dollars * 1_000_000) / 1_000_000 };
}

/**
 * The rates of the models in `entries` that have one, keyed by the entries'
 * model ids: the snapshot a run stores (`rates`), so its cost can be read
 * again after the price table changes.
 */
export function ratesUsed(
  entries: readonly ModelUsageEntry[],
  table: PriceTable = PRICE_TABLE,
): Record<string, ModelRate> {
  const rates: Record<string, ModelRate> = {};
  for (const entry of entries) {
    const rate = rateFor(entry.model, table);
    if (rate) rates[entry.model] = { ...rate };
  }
  return rates;
}
