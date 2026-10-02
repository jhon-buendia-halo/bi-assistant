// Tool-result capture and tool-only-turn synthesis, shared by
// `SessionsService.streamMessage` (a real chat turn) and the assistant eval
// harness — extracted so both measure/build the same way rather than
// duplicating the logic.
import type { Logger } from '@nestjs/common';
import type { Agent } from '@mastra/core/agent';
import type { ProviderOptions } from '../../mastra/model-compat';
import { queryEntitiesProvenance } from '../../mastra/tool-services';
import type { ToolDataRecord } from './entities/session.entity';

/** Tools whose model-visible result has `sql`/`correctedSql` stripped
 * (ADR-0007 §4) — the full result (with SQL, for this record's `input`) is
 * recovered from `queryEntitiesProvenance` instead. */
const SQL_STRIPPED_TOOLS = new Set(['query_entities', 'sample_records']);

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

/** Tools whose result is a `{columns, rows}`-shaped (or `{error}`) record
 * worth capturing on the turn. `run_readonly_sql`/`sample_rows` are the
 * legacy (`assistant-legacy`, dataset.tools.ts) names; `query_entities`/
 * `sample_records`/`run_raw_sql` are the logical-query-layer names
 * (ADR-0007) — both sets are accepted so the eval harness's `legacy` path
 * and a real chat turn's `model` path capture the same way. */
const DATA_TOOLS = new Set([
  'run_readonly_sql',
  'sample_rows',
  'query_entities',
  'sample_records',
  'run_raw_sql',
]);

/** SQL-bearing tool names on either path — `run_readonly_sql` (legacy) and
 * `query_entities`/`run_raw_sql` (ADR-0007) all leave a compiled/raw
 * statement in `record.input`, re-runnable against a datasource directly
 * (`SessionsService.crossCheckAnswer`/`matchesVerifiedQuery`,
 * `VisualizationService.refreshData`). `sample_records`/`sample_rows` are
 * excluded — a sample is not "the SQL behind the answer". */
export const SQL_RUN_TOOLS = new Set([
  'run_readonly_sql',
  'query_entities',
  'run_raw_sql',
]);

/** Turn a data-bearing tool result into a compact, storable record. */
export function toolDataRecord(
  tool: string,
  args: Record<string, unknown>,
  result: unknown,
): ToolDataRecord | null {
  if (!DATA_TOOLS.has(tool)) return null;
  // `query_entities`/`sample_records` hand the model a sql-stripped result
  // (`mastra/tools/model.tools.ts`) — the full result, `sql` included, was
  // registered there under the SAME object just a moment earlier, in the
  // same process.
  const enriched =
    SQL_STRIPPED_TOOLS.has(tool) && result && typeof result === 'object'
      ? (queryEntitiesProvenance.get(result) ?? result)
      : result;
  const value = (enriched ?? {}) as {
    columns?: unknown;
    rows?: unknown;
    error?: unknown;
    correctedSql?: unknown;
    sql?: unknown;
    entities?: unknown;
    truncated?: unknown;
    warnings?: unknown;
    outsideModel?: unknown;
  };
  // Show the statement that actually ran, so the answer and any visual cite
  // the repaired SQL rather than the one that failed. `query_entities`'s
  // result carries the *compiled* SQL under `sql`; `run_raw_sql` and the
  // legacy `run_readonly_sql` take it from their own `sql` argument instead.
  const input =
    typeof value.correctedSql === 'string'
      ? value.correctedSql
      : typeof value.sql === 'string'
        ? value.sql
        : typeof args['sql'] === 'string'
          ? args['sql']
          : typeof args['entity'] === 'string'
            ? args['entity']
            : undefined;
  const rationale = statedRationale(args['rationale']);
  // `query_entities`'s own input, kept as provenance alongside the SQL it
  // compiled to — only present for that tool.
  const logicalQuery =
    tool === 'query_entities' && args['query'] !== undefined
      ? safeJson(args['query'])
      : undefined;
  // `run_raw_sql` always flags its contribution as outside the model,
  // whether or not the statement itself succeeded (ADR-0007 §4).
  const outsideModel = value.outsideModel === true ? true : undefined;
  if (typeof value.error === 'string') {
    // A step that failed still explained why it was attempted — keep it, the
    // dead end is part of the route the assistant took.
    return {
      tool,
      input,
      error: value.error,
      ...(rationale ? { rationale } : {}),
      ...(logicalQuery ? { logicalQuery } : {}),
      ...(outsideModel ? { outsideModel } : {}),
    };
  }
  if (value.error && typeof value.error === 'object') {
    // `query_entities`/`run_raw_sql` (ADR-0007) reject with a structured
    // `{code, message, ...}`, not a string — without this branch a rejected
    // call fell through to the success path below (`rows`/`columns` both
    // default to `[]`), storing a validation failure as a successful
    // zero-row step. `message` already folds in every resolver issue (see
    // `queryEntitiesTool` in `mastra/tools/model.tools.ts`), not just the
    // first one it found.
    const errorObj = value.error as { code?: unknown; message?: unknown };
    const code = typeof errorObj.code === 'string' ? errorObj.code : 'error';
    const message =
      typeof errorObj.message === 'string'
        ? errorObj.message
        : (safeJson(errorObj) ?? 'unknown error');
    return {
      tool,
      input,
      error: `${code}: ${message}`,
      ...(rationale ? { rationale } : {}),
      ...(logicalQuery ? { logicalQuery } : {}),
      ...(outsideModel ? { outsideModel } : {}),
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
    ...(logicalQuery ? { logicalQuery } : {}),
    ...(outsideModel ? { outsideModel } : {}),
  };
}

/** `JSON.stringify` that degrades to `undefined` instead of throwing on a
 * circular/unserialisable tool argument — provenance is best-effort. */
function safeJson(value: unknown): string | undefined {
  try {
    return JSON.stringify(value);
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
  const entries = (result as { toolResults?: unknown })?.toolResults;
  if (!Array.isArray(entries)) return [];
  const records: ToolDataRecord[] = [];
  for (const entry of entries) {
    const payload = ((entry as { payload?: unknown })?.payload ?? entry) as {
      toolName?: string;
      name?: string;
      args?: Record<string, unknown>;
      result?: unknown;
    };
    const record = toolDataRecord(
      payload.toolName ?? payload.name ?? 'tool',
      payload.args ?? {},
      payload.result,
    );
    if (record) records.push(record);
  }
  return records;
}

/** The two assistants the grounding guard (and the eval harness) can run
 * against: `model` is the current logical-query-layer assistant
 * (`query_entities`, ADR-0007); `legacy` is the frozen pre-ADR-0007
 * SQL-writing assistant (`run_readonly_sql`), kept only for eval comparison.
 * Re-exported here (not just from `assistant.evals.ts`) because the
 * grounding nudge's wording is a property of the prompt, not the eval
 * harness. */
export type AssistantPath = 'model' | 'legacy';

/**
 * The system nudge for the zero-SQL-turn grounding guard: a turn that ended
 * with a non-empty answer but never called a tool. The prompt-only grounding
 * rule in `assistant.agent.ts` was not enough on its own (evals caught it
 * answering "Who won the 2022 World Cup?" from parametric memory) — this is
 * the runtime backstop, one corrective pass with tools allowed. The model's
 * own ungrounded answer is included so it has something concrete to accept,
 * correct or retract. `path` picks the tool name that actually exists on the
 * agent being nudged — `assistant-legacy.agent.ts` never learned
 * `query_entities`, and the model-path assistant does not carry
 * `run_readonly_sql` (ADR-0007 §4).
 */
export function groundingNudge(
  originalAnswer: string,
  path: AssistantPath = 'model',
): string {
  const tool = path === 'legacy' ? 'run_readonly_sql' : 'query_entities';
  return [
    'Grounding check: you produced an answer without calling any tool.',
    `If the answer makes factual claims about the data (values, winners, counts, rankings, dates), you MUST re-answer by querying with ${tool} and answer only from the results — or, if the data does not cover the question, say so explicitly and state what the data does cover.`,
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
