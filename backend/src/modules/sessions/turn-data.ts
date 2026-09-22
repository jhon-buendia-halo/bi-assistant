// Tool-result capture and tool-only-turn synthesis, shared by
// `SessionsService.streamMessage` (a real chat turn) and the assistant eval
// harness — extracted so both measure/build the same way rather than
// duplicating the logic.
import type { Logger } from '@nestjs/common';
import type { Agent } from '@mastra/core/agent';
import type { ProviderOptions } from '../../mastra/model-compat';
import type { ToolDataRecord } from './entities/session.entity';

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
  if (typeof value.error === 'string') {
    // A step that failed still explained why it was attempted — keep it, the
    // dead end is part of the route the assistant took.
    return {
      tool,
      input,
      error: value.error,
      ...(rationale ? { rationale } : {}),
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
 */
export async function synthesizeToolOnlyTurn(
  agent: Agent,
  question: string,
  data: ToolDataRecord[],
  abortSignal: AbortSignal,
  providerOptions: ProviderOptions,
  logger?: Logger,
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
    return (result.text ?? '').trim() || EMPTY_RESPONSE_FALLBACK;
  } catch (error) {
    if (abortSignal.aborted) return '';
    logger?.warn(
      `Final synthesis failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return EMPTY_RESPONSE_FALLBACK;
  }
}
