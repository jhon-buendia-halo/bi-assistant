/**
 * The recorded turn the deterministic checks read (agents-evals R111): the
 * question, the answer text and each tool call in order with its arguments,
 * its result and its error.
 *
 * Two ways to get one:
 * - `turnFromScorerRun`, from the scorer run Mastra hands a check during an
 *   eval run (`runEvals` → `scorer.run`). Nothing is clipped there.
 * - `turnFromCaseResult`, from a stored case result (a run record, a report
 *   download), whose tool inputs and outputs are JSON clipped at 2,000
 *   characters (R33). A clipped output keeps its raw text in `resultText`, so
 *   a check can still read what the clip left; clipped arguments are marked
 *   unreadable and the checks skip them. Only offline re-scoring needs this.
 *
 * Pure module: no Mastra, no Nest, so the checks unit-test under Jest.
 */

export interface CheckToolCall {
  /** The tool's id, e.g. `run_readonly_sql`. */
  name: string;
  /** The arguments the assistant passed; `{}` when they could not be read. */
  args: Record<string, unknown>;
  /** False only for a stored record whose arguments were clipped past parsing. */
  argsReadable: boolean;
  /** What the tool returned, parsed; undefined when it could not be read. */
  result?: unknown;
  /** The raw text of a stored result clipped past parsing. */
  resultText?: string;
  /** Set when the call failed: the error the tool returned or threw. */
  error?: string;
}

export interface CheckTurn {
  /** The user's message. */
  question: string;
  /** The assistant's answer text. */
  answer: string;
  toolCalls: CheckToolCall[];
}

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/* ------------------------------------------------------- from a scorer run */

/**
 * A message's text the way `@mastra/evals` reads it
 * (`getTextContentFromMastraDBMessage`), so the deterministic checks and the
 * `includes`/`matches` helpers judge the same answer: the `content` string
 * when there is one, else the last text part.
 */
export function messageText(message: unknown): string {
  if (!isObject(message)) return '';
  const content = message.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return lastTextPart(content);
  if (!isObject(content)) return '';
  if (typeof content.content === 'string' && content.content !== '') {
    return content.content;
  }
  if (typeof content.text === 'string' && content.text !== '') {
    return content.text;
  }
  return Array.isArray(content.parts) ? lastTextPart(content.parts) : '';
}

function lastTextPart(parts: unknown[]): string {
  const texts = parts.filter(
    (part): part is { type: 'text'; text?: unknown } =>
      isObject(part) && part.type === 'text',
  );
  const last = texts[texts.length - 1];
  return typeof last?.text === 'string' ? last.text : '';
}

/**
 * A message's tool invocations: the `parts` entries and the legacy
 * `toolInvocations` array merged, parts winning on a shared call id (they
 * hold the terminal state). Mirrors `mergeToolInvocations` in
 * `@mastra/evals/scorers/utils`, which this module cannot import under Jest.
 */
function messageInvocations(message: unknown): Json[] {
  if (!isObject(message) || !isObject(message.content)) return [];
  const content = message.content;
  const fromParts = (Array.isArray(content.parts) ? content.parts : [])
    .filter((part) => isObject(part) && part.type === 'tool-invocation')
    .map((part) => (part as Json).toolInvocation)
    .filter(isObject);
  const legacy = (
    Array.isArray(content.toolInvocations) ? content.toolInvocations : []
  ).filter(isObject);
  const partIds = new Set(
    fromParts.map((invocation) => invocation.toolCallId).filter(Boolean),
  );
  const legacyAt = new Map(
    legacy.map((invocation, index) => [invocation.toolCallId, index]),
  );
  const merged: Json[] = [];
  let next = 0;
  for (const invocation of fromParts) {
    const shared = invocation.toolCallId
      ? legacyAt.get(invocation.toolCallId)
      : undefined;
    if (shared !== undefined && shared >= next) {
      for (; next < shared; next++) {
        if (!partIds.has(legacy[next].toolCallId)) merged.push(legacy[next]);
      }
      next++;
    }
    merged.push(invocation);
  }
  for (; next < legacy.length; next++) {
    if (!partIds.has(legacy[next].toolCallId)) merged.push(legacy[next]);
  }
  return merged;
}

function errorOf(value: unknown): string | undefined {
  if (isObject(value) && typeof value.error === 'string') return value.error;
  return undefined;
}

function stringify(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/** One invocation as a check sees it. */
function invocationCall(invocation: Json): CheckToolCall {
  const args = invocation.args ?? invocation.input;
  const result = invocation.result ?? invocation.output;
  const state = invocation.state;
  let error: string | undefined;
  if (state === 'output-error') {
    error =
      typeof invocation.errorText === 'string'
        ? invocation.errorText
        : 'the tool threw an error';
  } else if (state === 'call' || state === 'partial-call') {
    error = 'the call never returned';
  } else if (invocation.isError === true) {
    error = errorOf(result) ?? stringify(result);
  } else {
    error = errorOf(result);
  }
  return {
    name:
      typeof invocation.toolName === 'string' ? invocation.toolName : 'unknown',
    args: isObject(args) ? args : {},
    argsReadable: true,
    ...(result !== undefined ? { result } : {}),
    ...(error !== undefined ? { error } : {}),
  };
}

/**
 * The turn a scorer run records. `run.output` is the agent's response
 * messages; `run.input.inputMessages` holds the question.
 */
export function turnFromScorerRun(run: {
  input?: unknown;
  output?: unknown;
}): CheckTurn {
  const output = Array.isArray(run.output) ? run.output : [];
  const inputMessages =
    isObject(run.input) && Array.isArray(run.input.inputMessages)
      ? run.input.inputMessages
      : [];
  const question = inputMessages
    .filter((message) => isObject(message) && message.role === 'user')
    .map(messageText)
    .join(' ');
  const answer = output
    .filter((message) => isObject(message) && message.role === 'assistant')
    .map(messageText)
    .join(' ');
  return {
    question,
    answer,
    toolCalls: output.flatMap(messageInvocations).map(invocationCall),
  };
}

/* ------------------------------------------------------ from a stored result */

/** A tool call as a stored case result keeps it (`EvalToolCall`). */
export interface RecordedToolCall {
  name: string;
  input?: string;
  output?: string;
  error?: string;
}

function parseJson(text: string | undefined): unknown {
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** A string field read from clipped JSON text, when the clip left it whole. */
export function jsonStringField(
  text: string | undefined,
  field: string,
): string | undefined {
  if (!text) return undefined;
  const match = new RegExp(`"${field}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(
    text,
  );
  if (!match) return undefined;
  try {
    return JSON.parse(`"${match[1]}"`) as string;
  } catch {
    return match[1];
  }
}

/**
 * The turn a stored case result records: `{ question, answer, toolCalls }`
 * as `AssistantEvalCaseResult` and the run records under `evidence/` hold it.
 */
export function turnFromCaseResult(result: {
  question?: string;
  answer?: string;
  toolCalls?: RecordedToolCall[];
}): CheckTurn {
  return {
    question: result.question ?? '',
    answer: result.answer ?? '',
    toolCalls: (result.toolCalls ?? []).map((call): CheckToolCall => {
      const args = parseJson(call.input);
      const readable = call.input === undefined || isObject(args);
      if (call.error !== undefined) {
        return {
          name: call.name,
          args: isObject(args) ? args : {},
          argsReadable: readable,
          error: call.error,
        };
      }
      const parsed = parseJson(call.output);
      const clipped = call.output !== undefined && parsed === undefined;
      const error = clipped
        ? /^\s*\{\s*"error"\s*:/.test(call.output ?? '')
          ? (jsonStringField(call.output, 'error') ?? 'the tool failed')
          : undefined
        : errorOf(parsed);
      return {
        name: call.name,
        args: isObject(args) ? args : {},
        argsReadable: readable,
        ...(parsed !== undefined ? { result: parsed } : {}),
        ...(clipped ? { resultText: call.output } : {}),
        ...(error !== undefined ? { error } : {}),
      };
    }),
  };
}

/* ---------------------------------------------------------------- helpers */

/** Clip a quote to `max` characters on one line (R111: 120). */
export function quote(text: string, max = 120): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export function callsOf(turn: CheckTurn, tool: string): CheckToolCall[] {
  return turn.toolCalls.filter((call) => call.name === tool);
}

/** A string field of a call's result, read from the clipped text if need be. */
export function resultString(
  call: CheckToolCall,
  field: string,
): string | undefined {
  if (isObject(call.result)) {
    const value = call.result[field];
    return typeof value === 'string' ? value : undefined;
  }
  return jsonStringField(call.resultText, field);
}

/** The `sql` argument of a `run_readonly_sql` call (R111's written SQL). */
export function writtenSql(call: CheckToolCall): string | undefined {
  const sql = call.args.sql;
  return typeof sql === 'string' && sql.trim() ? sql : undefined;
}

/** The SQL fixer's corrected statement, when it repaired the call. */
export function correctedSql(call: CheckToolCall): string | undefined {
  return call.error === undefined
    ? resultString(call, 'correctedSql')
    : undefined;
}

/** The statement a successful call actually ran (R111's executed SQL). */
export function executedSql(call: CheckToolCall): string | undefined {
  if (call.error !== undefined) return undefined;
  return correctedSql(call) ?? writtenSql(call);
}

/** Every `run_readonly_sql` call's written SQL, skipping unreadable ones. */
export function writtenStatements(turn: CheckTurn): string[] {
  return callsOf(turn, 'run_readonly_sql')
    .map(writtenSql)
    .filter((sql): sql is string => sql !== undefined);
}

/** Every successful `run_readonly_sql` call's executed SQL. */
export function executedStatements(turn: CheckTurn): string[] {
  return callsOf(turn, 'run_readonly_sql')
    .map(executedSql)
    .filter((sql): sql is string => sql !== undefined);
}
