// Tool-result capture and tool-only-turn synthesis, shared by
// `SessionsService.streamMessage` (a real chat turn) and the assistant eval
// harness — extracted so both measure/build the same way rather than
// duplicating the logic.
import type { Logger } from '@nestjs/common';
import type { Agent } from '@mastra/core/agent';
import type { ProviderOptions } from '../../mastra/model-compat';
import { extractUsageDeep, type TokenUsage } from '../agents/eval-telemetry';
import type { ToolDataRecord } from './entities/session.entity';
import type {
  ProviderError,
  SqlRepairKind,
  SqlRepairRecord,
} from './turn-result';

/** Rows kept per captured tool result — enough for the transcript, the visual
 * designer prompt and the tool-only-turn synthesis pass to work from. */
export const STORED_ROWS_CAP = 200;
/** Rows kept per record when feeding a tool-only turn's data to synthesis. */
export const SYNTHESIS_ROWS_CAP = 50;
/** Longest rationale kept per step — a sentence or two, never an essay. */
export const RATIONALE_CHARS = 400;
export const EMPTY_RESPONSE_FALLBACK =
  'I completed the data analysis but could not produce a final response. Please retry your question.';

/**
 * The reason the assistant gave for a call, as stored: flattened, trimmed and
 * clipped. Anything that is not usable prose becomes nothing at all.
 */
export function statedRationale(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const flat = value.replace(/\s+/g, ' ').trim();
  if (!flat) return undefined;
  return flat.length > RATIONALE_CHARS
    ? `${flat.slice(0, RATIONALE_CHARS - 1)}…`
    : flat;
}

/** Turn a data-bearing tool result into a compact, storable record. */
export function toolDataRecord(
  tool: string,
  args: Record<string, unknown>,
  result: unknown,
): ToolDataRecord | null {
  if (tool !== 'run_readonly_sql' && tool !== 'sample_rows') return null;
  const value = (result ?? {}) as {
    columns?: unknown;
    rows?: unknown;
    error?: unknown;
    correctedSql?: unknown;
    truncated?: unknown;
    warnings?: unknown;
    repairs?: unknown;
    precheck?: unknown;
  };
  // Show the statement that actually ran, so the answer and any visual cite
  // the repaired SQL rather than the one that failed.
  const input =
    typeof value.correctedSql === 'string'
      ? value.correctedSql
      : typeof args['sql'] === 'string'
        ? args['sql']
        : typeof args['entity'] === 'string'
          ? args['entity']
          : undefined;
  const rationale = statedRationale(args['rationale']);
  // What the bridge did to the statement on the way (fixer repairs, precheck
  // findings) — SQL runs only, and only when present, so a record from a
  // turn that pulled no lever is exactly what it was before these existed.
  const sqlAudit =
    tool === 'run_readonly_sql'
      ? sqlAuditFields(value.repairs, value.precheck)
      : {};
  if (typeof value.error === 'string') {
    // A step that failed still explained why it was attempted — keep it, the
    // dead end is part of the route the assistant took.
    return {
      tool,
      input,
      error: value.error,
      ...(rationale ? { rationale } : {}),
      ...sqlAudit,
    };
  }
  const rows = Array.isArray(value.rows)
    ? (value.rows as Record<string, unknown>[])
    : [];
  const columns = Array.isArray(value.columns)
    ? value.columns.map((c) => String(c))
    : Object.keys(rows[0] ?? {});
  // Clipped either by the query's own row limit (flagged by the bridge) or by
  // what we keep in the transcript.
  const truncated = value.truncated === true || rows.length > STORED_ROWS_CAP;
  // The guards ran in the tool, against the full result — keep their verdict
  // with the rows it judged.
  const warnings = Array.isArray(value.warnings)
    ? value.warnings.map((w) => String(w)).filter(Boolean)
    : [];
  return {
    tool,
    input,
    columns,
    rows: rows.slice(0, STORED_ROWS_CAP),
    rowCount: rows.length,
    ...(truncated ? { truncated: true } : {}),
    ...(rationale ? { rationale } : {}),
    ...(warnings.length ? { warnings } : {}),
    ...sqlAudit,
  };
}

const REPAIR_KINDS: ReadonlySet<string> = new Set<SqlRepairKind>([
  'identifier',
  'syntax',
  'semantic',
  'unknown',
]);

/**
 * `repairs` / `precheck` off a `run_readonly_sql` result, read defensively:
 * the result crossed a tool boundary (and possibly a JSON round trip), so a
 * malformed entry is dropped rather than persisted as a half-record.
 */
function sqlAuditFields(
  repairs: unknown,
  precheck: unknown,
): Pick<ToolDataRecord, 'repairs' | 'precheck'> {
  const kept: SqlRepairRecord[] = [];
  for (const entry of Array.isArray(repairs) ? repairs : []) {
    const repair = (entry ?? {}) as Record<string, unknown>;
    if (
      typeof repair.original !== 'string' ||
      typeof repair.repaired !== 'string'
    ) {
      continue;
    }
    const kind = typeof repair.kind === 'string' ? repair.kind : 'unknown';
    kept.push({
      original: repair.original,
      repaired: repair.repaired,
      error: typeof repair.error === 'string' ? repair.error : '',
      kind: (REPAIR_KINDS.has(kind) ? kind : 'unknown') as SqlRepairKind,
      ...(typeof repair.warning === 'string' && repair.warning
        ? { warning: repair.warning }
        : {}),
      ...(repair.usage && typeof repair.usage === 'object'
        ? { usage: repair.usage as TokenUsage }
        : {}),
    });
  }
  const findings = Array.isArray(precheck)
    ? precheck.map((line) => String(line)).filter(Boolean)
    : [];
  return {
    ...(kept.length ? { repairs: kept } : {}),
    ...(findings.length ? { precheck: findings } : {}),
  };
}

/**
 * One tool result, read across the shapes the SDK has used. The AI SDK
 * renamed `args`/`result` to `input`/`output` and Mastra wraps each entry in
 * a `{ type, payload }` chunk; reading only one spelling silently finds
 * nothing (the same trap `extractToolCalls` in `assistant.evals.ts`
 * documents), and a record with no rows is indistinguishable from a query
 * that returned none. Both spellings, both nestings and a JSON-encoded
 * result are accepted.
 */
export function toolResultRecord(entry: unknown): ToolDataRecord | null {
  const payload = ((entry as { payload?: unknown })?.payload ?? entry) as {
    toolName?: string;
    name?: string;
    args?: unknown;
    input?: unknown;
    result?: unknown;
    output?: unknown;
  };
  if (!payload || typeof payload !== 'object') return null;
  return toolDataRecord(
    String(payload.toolName ?? payload.name ?? 'tool'),
    asArgs(payload.input) ?? asArgs(payload.args) ?? {},
    unwrapToolOutput(payload.output ?? payload.result),
  );
}

/** Every data-bearing record in one batch of `toolResults` entries. */
export function toolResultRecords(entries: unknown): ToolDataRecord[] {
  if (!Array.isArray(entries)) return [];
  const records: ToolDataRecord[] = [];
  for (const entry of entries) {
    const record = toolResultRecord(entry);
    if (record) records.push(record);
  }
  return records;
}

/** The call's arguments, or `undefined` when this field does not hold them. */
function asArgs(value: unknown): Record<string, unknown> | undefined {
  const parsed = parseJsonObject(value);
  return parsed && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : undefined;
}

/**
 * The tool's own return value: unwrapped from an AI-SDK output part
 * (`{ type: 'json', value }`) and parsed when a transport JSON-encoded it.
 */
function unwrapToolOutput(value: unknown): unknown {
  let current = parseJsonObject(value) ?? value;
  // Bounded: each pass strips exactly one wrapper, and a real SQL result
  // (which carries `rows`) is never treated as one.
  for (let depth = 0; depth < 3; depth++) {
    if (!current || typeof current !== 'object' || Array.isArray(current))
      break;
    const part = current as { type?: unknown; value?: unknown; rows?: unknown };
    if (
      typeof part.type !== 'string' ||
      part.value === undefined ||
      part.rows !== undefined
    ) {
      break;
    }
    current = parseJsonObject(part.value) ?? part.value;
  }
  return current;
}

/** The value as an object, parsing it first when it is JSON text. */
function parseJsonObject(value: unknown): object | undefined {
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (!text.startsWith('{') && !text.startsWith('[')) return undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Records captured from a non-streamed turn. The stream path reads tool
 * chunks one by one as they arrive; `generate` hands them back in a batch,
 * wrapped or flat depending on the provider, so both shapes are accepted.
 */
export function toolRecords(result: unknown): ToolDataRecord[] {
  return toolResultRecords((result as { toolResults?: unknown })?.toolResults);
}

/**
 * Tool names a non-streamed run called, in call order, repeats kept — the
 * `generate` counterpart of reading `tool-call` chunks off a stream. Per-step
 * lists are preferred because they span the whole tool loop; the top-level
 * `toolCalls` is the fallback for results that carry no steps. Both the
 * chunk (`{ payload: { toolName } }`) and the flat spelling are accepted, for
 * the same reason `toolResultRecord` accepts both.
 */
export function toolCallNames(result: unknown): string[] {
  const value = (result ?? {}) as { steps?: unknown; toolCalls?: unknown };
  const steps = Array.isArray(value.steps) ? value.steps : [];
  const fromSteps = steps.flatMap((step) =>
    callNames((step as { toolCalls?: unknown })?.toolCalls),
  );
  return fromSteps.length ? fromSteps : callNames(value.toolCalls);
}

function callNames(calls: unknown): string[] {
  if (!Array.isArray(calls)) return [];
  const names: string[] = [];
  for (const call of calls) {
    const payload = ((call as { payload?: unknown })?.payload ?? call) as {
      toolName?: unknown;
      name?: unknown;
    };
    const name = payload?.toolName ?? payload?.name;
    if (typeof name === 'string' && name) names.push(name);
  }
  return names;
}

/**
 * The system nudge for the zero-SQL-turn grounding guard: a turn that ended
 * with a non-empty answer but never called a tool. The prompt-only grounding
 * rule in `assistant.agent.ts` was not enough on its own (evals caught it
 * answering "Who won the 2022 World Cup?" from parametric memory) — this is
 * the runtime backstop, one corrective pass with tools allowed. The model's
 * own ungrounded answer is included so it has something concrete to accept,
 * correct or retract.
 */
export function groundingNudge(originalAnswer: string): string {
  return [
    'Grounding check: you produced an answer without calling any tool.',
    'If the answer makes factual claims about the data (values, winners, counts, rankings, dates), you MUST re-answer by querying with run_readonly_sql and answer only from the results — or, if the data does not cover the question, say so explicitly and state what the data does cover.',
    'If the reply is purely conversational (greeting, thanks, question about how to use the app) or is fully supported by query results already shown earlier in this conversation, return the same answer unchanged.',
    '',
    `Your answer: ${originalAnswer}`,
  ].join('\n');
}

/**
 * A model can spend every allowed step on tools and finish without a
 * user-facing answer. Give it one tool-disabled pass to turn the data it
 * already collected into prose; never let a completed turn disappear.
 *
 * `onUsage` receives the pass's token counts when the provider reported
 * them — it is a side pass of the turn (`TurnResult.sidePassUsage.synthesis`)
 * and is never called with a made-up zero.
 */
export async function synthesizeToolOnlyTurn(
  agent: Agent,
  question: string,
  data: ToolDataRecord[],
  abortSignal: AbortSignal,
  providerOptions: ProviderOptions,
  logger?: Logger,
  onUsage?: (usage: TokenUsage) => void,
): Promise<string> {
  if (!data.length) return EMPTY_RESPONSE_FALLBACK;

  const compactData = data.map((record) => ({
    ...record,
    rows: record.rows?.slice(0, SYNTHESIS_ROWS_CAP),
  }));
  try {
    const result = await agent.generate(
      [
        'Answer the original user question using only the tool results below.',
        'Give concrete findings, comparisons, a short takeaway, and name the source entities from the SQL where possible.',
        'Do not call tools and do not mention internal step limits.',
        '',
        `Original question: ${question}`,
        '',
        `Tool results: ${JSON.stringify(compactData)}`,
      ].join('\n'),
      {
        instructions:
          'You are a data analyst writing the final answer from completed query results.',
        maxSteps: 1,
        toolChoice: 'none',
        abortSignal,
        providerOptions,
      },
    );
    const usage = extractUsageDeep(result);
    if (usage) onUsage?.(usage);
    return (result.text ?? '').trim() || EMPTY_RESPONSE_FALLBACK;
  } catch (error) {
    if (abortSignal.aborted) return '';
    logger?.warn(
      `Final synthesis failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return EMPTY_RESPONSE_FALLBACK;
  }
}

/* --------------------------------------------------------- provider errors */

/** Longest provider message kept on a `ProviderError`. */
export const PROVIDER_MESSAGE_CHARS = 300;
/** Longest provider message quoted inside the user-facing explanation. */
const QUOTED_MESSAGE_CHARS = 160;
/** Errors followed down a `cause` / `lastError` / `data` chain. */
const MAX_CHAIN = 8;

// Checked in this order, first match wins. Quota before rate limit: OpenAI
// sends an exhausted balance as a 429 too, and "wait and retry" is the wrong
// advice for it. Network before timeout: `ETIMEDOUT` is a socket that never
// connected, not a model that answered too slowly.
const QUOTA =
  /insufficient_quota|credit_balance_exhausted|billing_hard_limit_reached|no credits remaining|exceeded your current quota|credit balance is too low/i;
const RATE_LIMIT = /rate[_\s-]?limit|too many requests/i;
const AUTH =
  /invalid[_\s-]api[_\s-]key|incorrect api key|api key is missing|LoadAPIKeyError/i;
const NETWORK =
  /ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|EPIPE|socket hang up|cannot connect|fetch failed/i;
const TIMEOUT = /time[sd]?[\s-]*out|deadline exceeded/i;

/**
 * Classify an error the model provider (or the stream to it) raised, from
 * whatever shape it arrived in. Mastra hands it over as the `payload.error`
 * of a `{ type: 'error' }` stream chunk — normally the AI SDK's
 * `APICallError` (`statusCode`, `responseBody`, parsed `data`), sometimes
 * wrapped (`cause`, a retry's `lastError`) or a plain object the Responses
 * API streamed (`{ code, message }`) — so the whole chain is read. The
 * request body is never read: it holds the prompt, and a question about
 * "rate limits" must not classify its own failure.
 *
 * Pure; never throws.
 */
export function classifyProviderError(error: unknown): ProviderError {
  const chain = errorChain(error);
  const blob = chain.map(describeNode).join('\n');
  const statusCode = chain
    .map((node) => node.statusCode ?? node.status)
    .find(
      (value): value is number =>
        typeof value === 'number' && value >= 100 && value < 600,
    );
  return {
    message: providerMessage(chain),
    ...(statusCode !== undefined ? { statusCode } : {}),
    kind: providerErrorKind(blob, statusCode),
  };
}

/**
 * Whether a thrown error is recognisably the provider's — a status code, an
 * AI SDK error, or a failure class the classifier knows. Anything else
 * thrown out of a turn is our own bug and must keep surfacing as one.
 */
export function isProviderFailure(error: unknown): boolean {
  const classified = classifyProviderError(error);
  if (classified.kind !== 'unknown' || classified.statusCode !== undefined) {
    return true;
  }
  return errorChain(error).some(
    (node) => typeof node.name === 'string' && /^AI_\w*Error$/.test(node.name),
  );
}

/**
 * What the user reads when the provider failed before the turn produced an
 * answer: what happened, what to do about it, and whether any analysis ran —
 * short, no stack trace, never the "I completed the data analysis" fallback
 * (which would claim work that did not happen).
 */
export function providerErrorMessage(
  error: ProviderError,
  analysisRan: boolean,
): string {
  const tail = analysisRan
    ? 'The analysis stopped before an answer was written.'
    : 'No analysis was run.';
  const status = error.statusCode ? `HTTP ${error.statusCode}` : '';
  const quoted = quoteMessage(error.message);
  switch (error.kind) {
    case 'quota':
      return `The language model provider refused the request (no API credits remaining — add credits in the provider's billing settings, or switch model in Settings → LLM). ${tail}`;
    case 'rate-limit':
      return `The language model provider is rate-limiting requests (too many requests — wait a minute and retry, or switch model in Settings → LLM). ${tail}`;
    case 'auth':
      return `The language model provider rejected the credentials (${status || 'not authorized'} — check the API key in Settings → LLM). ${tail}`;
    case 'network':
      return `Could not reach the language model provider (${quoted || 'network error'} — check the connection and retry). ${tail}`;
    case 'timeout':
      return `The language model provider did not respond in time (${quoted || 'timeout'} — retry, or switch model in Settings → LLM). ${tail}`;
    default:
      return `The language model provider returned an error (${[status, quoted].filter(Boolean).join(': ') || 'no details'} — retry, or check Settings → LLM). ${tail}`;
  }
}

function providerErrorKind(
  blob: string,
  statusCode: number | undefined,
): ProviderError['kind'] {
  if (QUOTA.test(blob)) return 'quota';
  if (statusCode === 429 || RATE_LIMIT.test(blob)) return 'rate-limit';
  if (statusCode === 401 || statusCode === 403 || AUTH.test(blob)) {
    return 'auth';
  }
  if (NETWORK.test(blob)) return 'network';
  if (statusCode === 408 || statusCode === 504 || TIMEOUT.test(blob)) {
    return 'timeout';
  }
  return 'unknown';
}

type ErrorNode = Record<string, unknown>;

/** The error and what it wraps, breadth-first, cycles and depth bounded. */
function errorChain(error: unknown): ErrorNode[] {
  const chain: ErrorNode[] = [];
  const seen = new Set<unknown>();
  const queue: unknown[] = [error];
  while (queue.length && chain.length < MAX_CHAIN) {
    const node = queue.shift();
    if (typeof node === 'string') {
      chain.push({ message: node });
      continue;
    }
    if (!node || typeof node !== 'object' || seen.has(node)) continue;
    seen.add(node);
    const record = node as ErrorNode;
    chain.push(record);
    queue.push(record.lastError, record.cause, record.data, record.error);
    if (Array.isArray(record.errors)) queue.push(record.errors.at(-1));
  }
  return chain;
}

/** The fields of one node worth classifying on — never the request body. */
function describeNode(node: ErrorNode): string {
  return ['name', 'message', 'code', 'type', 'responseBody']
    .map((key) => node[key])
    .filter(
      (value) =>
        (typeof value === 'string' && value) || typeof value === 'number',
    )
    .join(' ');
}

/** The error's own message (the provider's, as the AI SDK relays it), flattened and clipped. */
function providerMessage(chain: ErrorNode[]): string {
  const found = chain
    .map((node) => node.message)
    .find(
      (message): message is string =>
        typeof message === 'string' && message.trim() !== '',
    );
  const flat = (found ?? 'Unknown provider error').replace(/\s+/g, ' ').trim();
  return flat.length > PROVIDER_MESSAGE_CHARS
    ? `${flat.slice(0, PROVIDER_MESSAGE_CHARS - 1)}…`
    : flat;
}

/** A message fit for inlining in a sentence: shorter, no trailing stop. */
function quoteMessage(message: string): string {
  const bare = message.replace(/[\s.]+$/, '');
  return bare.length > QUOTED_MESSAGE_CHARS
    ? `${bare.slice(0, QUOTED_MESSAGE_CHARS - 1)}…`
    : bare;
}
