/**
 * One attempt's memory under a memory arm (agents-evals R238 to R245;
 * agents.md 8.3, *Memory arms*): the attempt's scope, the teach step, the
 * recall before the probe, the usage of the memory's own model calls, the
 * clean-up, and the memory checks every arm scores (R241 to R243).
 * `runAssistantEvalCase` calls it, given the store and the scope by the run
 * service; under the arm `none` there is no store, and only the memory
 * checks run, on an empty record.
 *
 * No Nest, no Mastra, no model: the memory is the `LearningStore` port, and
 * the teach signals and the learned block are rendered by BA-81's own pure
 * helpers, so the eval stores and sends exactly what a chat turn would.
 */
import { learnedBlock } from '../../modules/memory/learned-block';
import type {
  LearningSignal,
  LearningStore,
} from '../../modules/memory/learning-store.port';
import { signalText } from '../../modules/memory/signal-text';
import type { ToolDataRecord } from '../../modules/sessions/entities/session.entity';
// Type-only: erased at compile time, so no runtime edge to the agent stack.
import type {
  AssistantEvalCaseResult,
  EvalCheckResult,
  EvalRawToolCall,
  ScoredCheckResult,
} from './assistant.evals';
import {
  MEMORY_CHECKS,
  noRowValuesRetained,
  notRejectedSql,
  teachNotRecalled,
} from './checks/memory-checks';
import { recordMemoryUsage } from './eval-usage';
import type { ModelUsageEntry } from './eval-usage';
import type {
  EvalMemoryRecord,
  EvalRecalledSignal,
  MemoryArm,
  MemoryCheckSpec,
  TeachSignal,
} from './memory-case';
import type {
  CaseReferenceRunner,
  ResultSetCheckOptions,
} from './result-set-check';

/** A chat turn's recall cut-off (BA-81, knowledge R36), the eval's too. */
export const EVAL_RECALL_CUT_OFF_MS = 2_500;

/** What an attempt under a memory arm runs with (`EvalAttemptOptions`). */
export interface EvalAttemptMemory {
  /** The arm's store: BA-81's "Mastra only" one under `mastra`. */
  store: LearningStore;
  /** `eval-<run id>-<case id>-<attempt>` (R238), from `evalMemoryScope`. */
  scope: string;
  /** Where a failed clean-up is logged; the console when omitted. */
  warn?: (message: string) => void;
  /** The recall's cut-off; a chat turn's 2.5 seconds unless a test sets it. */
  recallCutOffMs?: number;
}

/**
 * The memory scope of one attempt (R238): never a datasource id, so nothing
 * it stores reaches the user's memory, another attempt, question or run.
 * BA-81 deletes the learning threads of `eval-` scopes a stopped backend
 * left behind when it next starts.
 */
export function evalMemoryScope(
  jobId: string,
  caseId: string,
  attempt: number,
): string {
  return `eval-${jobId}-${caseId}-${attempt}`;
}

/**
 * The case's teach signals as the memory stores a user's (R239): each
 * rendered and redacted by `signalText` with its own question, dated by its
 * `at`, its document id `<scope>:teach-<n>` (n from 1, in file order; unique
 * across attempts, since the store keys messages by id across every thread),
 * and the run's datasets as its provenance. The signals name no entities:
 * they are for provenance only, and the eval has none to give.
 */
export function teachSignals(
  teach: readonly TeachSignal[],
  scope: string,
  datasets: readonly string[],
): LearningSignal[] {
  return teach.map((signal, index) => ({
    documentId: `${scope}:teach-${index + 1}`,
    kind: signal.kind,
    content: signalText({
      kind: signal.kind,
      occurredAt: signal.at,
      question: signal.question,
      sql: signal.sql,
      ...(signal.note !== undefined ? { note: signal.note } : {}),
    }),
    occurredAt: signal.at,
    metadata: { datasetIds: [...datasets], entities: [] },
  }));
}

/** A teach step the memory refused; the attempt fails with its message. */
export class TeachFailedError extends Error {
  constructor(cause: unknown) {
    super(`teach failed: ${errorText(cause)}`);
    this.name = 'TeachFailedError';
  }
}

/**
 * The teach step (R239): the signals stored in the attempt's scope in one
 * `retain`, then `settle`, so the summary is rewritten before the probe. No
 * assistant call. Throws `TeachFailedError` when either throws. A case with
 * nothing to teach stores nothing.
 */
export async function teachMemory(
  memory: EvalAttemptMemory,
  teach: readonly TeachSignal[] | undefined,
  datasets: readonly string[],
): Promise<void> {
  if (!teach?.length) return;
  try {
    await memory.store.retain(
      memory.scope,
      teachSignals(teach, memory.scope, datasets),
    );
    await memory.store.settle(memory.scope);
  } catch (error) {
    throw new TeachFailedError(error);
  }
}

/** What the probe's recall found, and the learned block it makes. */
export interface ProbeRecall {
  /** The learned block (BA-81's Block 3b); none when nothing was recalled. */
  block?: string;
  /** The signals the block carries, oldest first. */
  recalled: EvalRecalledSignal[];
  /** The summary the block carries, when it carries one. */
  summary?: string;
  /** From the start of the recall to its result or its cut-off. */
  recallMs: number;
}

/**
 * The probe's recall (R240), exactly as a chat turn recalls (BA-81's
 * `MemoryService.learnedContext`): one `recall` and one `mentalModels` in
 * parallel, cut off after 2.5 seconds, a memory that fails or is late adding
 * nothing; then the learned block of what came back. Never throws.
 */
export async function recallForProbe(
  memory: EvalAttemptMemory,
  question: string,
): Promise<ProbeRecall> {
  const startedAt = Date.now();
  if (!question.trim()) return { recalled: [], recallMs: 0 };
  let timer: NodeJS.Timeout | undefined;
  const cutOff = new Promise<undefined>((resolve) => {
    timer = setTimeout(
      () => resolve(undefined),
      memory.recallCutOffMs ?? EVAL_RECALL_CUT_OFF_MS,
    );
  });
  try {
    const answer = await Promise.race([
      Promise.all([
        memory.store.recall(memory.scope, question),
        memory.store.mentalModels(memory.scope),
      ]).catch(() => undefined),
      cutOff,
    ]);
    const recallMs = Date.now() - startedAt;
    if (!answer) return { recalled: [], recallMs };
    const [signals, summary] = answer;
    const { block, used } = learnedBlock([
      { scope: memory.scope, summary, signals },
    ]);
    const recalled: EvalRecalledSignal[] = [];
    let sent: string | undefined;
    for (const entry of used) {
      if (entry.kind === 'summary') sent = entry.body;
      else if (
        entry.kind === 'verified_query' ||
        entry.kind === 'correction' ||
        entry.kind === 'rejection'
      ) {
        recalled.push({
          documentId: entry.id,
          kind: entry.kind,
          content: entry.body,
        });
      }
    }
    return {
      ...(block ? { block } : {}),
      recalled,
      ...(sent !== undefined ? { summary: sent } : {}),
      recallMs,
    };
  } catch {
    return { recalled: [], recallMs: Date.now() - startedAt };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Record the memory's own model calls for the attempt's scope under the
 * agent `memory` (R245), until the returned function is called. A call of
 * another scope (another attempt, a user's memory) is not this attempt's.
 */
export function listenMemoryUsage(
  memory: EvalAttemptMemory,
  usage: ModelUsageEntry[],
): () => void {
  return memory.store.onUsage((event) => {
    if (event.scope !== memory.scope) return;
    try {
      recordMemoryUsage(usage, event);
    } catch {
      // Recording tokens never fails the attempt it measures.
    }
  });
}

/**
 * The clean-up (R238): the attempt's scope deleted, every copy of its text
 * with it, whatever the attempt's outcome. A failure is logged and changes
 * no verdict; BA-81 deletes the scope at the backend's next start.
 */
export async function forgetScope(memory: EvalAttemptMemory): Promise<void> {
  try {
    await memory.store.forget(memory.scope);
  } catch (error) {
    (memory.warn ?? console.warn)(
      `Memory scope ${memory.scope} not deleted: ${errorText(error)}`,
    );
  }
}

/** What the memory checks of one attempt read. */
export interface MemoryCheckInput {
  checks: readonly MemoryCheckSpec[];
  teach: readonly TeachSignal[];
  /** The attempt's memory record; none under `none`, which reads as empty. */
  record?: EvalMemoryRecord;
  toolCalls: EvalRawToolCall[];
  turnRecords: readonly ToolDataRecord[];
  /**
   * The probe reference's rows, for `noRowValuesRetained`: the result-set
   * check's own, or run once here when it did not run them; read only when
   * the scope held something.
   */
  referenceRows: () => Promise<Record<string, unknown>[]>;
  /** Runs a rejected SQL as a reference runs; none without a datasource. */
  runReference?: CaseReferenceRunner;
  /** The case's result-set options, for comparing a rejected SQL's rows. */
  resultSetOptions?: ResultSetCheckOptions;
}

/**
 * The rows of the last successful, complete `run_readonly_sql` call: rows
 * present and all of them kept (a result clipped only at the query's own row
 * limit counts, R31). Undefined when there is none.
 */
export function lastCompleteSqlRows(
  records: readonly ToolDataRecord[],
): Record<string, unknown>[] | undefined {
  for (let i = records.length - 1; i >= 0; i--) {
    const record = records[i];
    if (record.tool !== 'run_readonly_sql' || record.error || !record.input) {
      continue;
    }
    if (
      Array.isArray(record.rows) &&
      (record.rowCount === undefined || record.rowCount === record.rows.length)
    ) {
      return record.rows;
    }
  }
  return undefined;
}

/**
 * Score a case's memory checks (A3: not Mastra scorers, since they read the
 * attempt's memory record, which no scorer sees), in file order, each with
 * its criterion (M1 to M3 unless the case names another). They are scored
 * under every arm: under `none` nothing is held or recalled, so the first
 * and the last pass, and `notRejectedSql` reads the turn as always.
 */
export async function scoreMemoryChecks(
  input: MemoryCheckInput,
): Promise<EvalCheckResult[]> {
  const held = input.record?.held ?? [];
  const results: EvalCheckResult[] = [];
  for (const spec of input.checks) {
    let check: ScoredCheckResult;
    if (spec.type === 'noRowValuesRetained') {
      const rows = held.length
        ? await input.referenceRows().catch(() => [])
        : [];
      check = noRowValuesRetained(input.teach, held, rows);
    } else if (spec.type === 'notRejectedSql') {
      check = await notRejectedSql(
        input.teach,
        input.toolCalls,
        lastCompleteSqlRows(input.turnRecords),
        input.runReference ?? noDatasource,
        input.resultSetOptions,
      );
    } else {
      check = teachNotRecalled(input.record);
    }
    results.push({
      ...check,
      status: check.passed ? 'passed' : 'failed',
      criterion: spec.criterion ?? MEMORY_CHECKS[spec.type].criterion,
    });
  }
  return results;
}

/** The reference path's answer when the datasets resolve no datasource. */
function noDatasource(): Promise<never> {
  return Promise.reject(
    new Error('could not resolve a datasource for the expectedSql comparison'),
  );
}

/**
 * The run's recall times (R245): the median and 90th percentile over the
 * attempts that recalled, each attempt of a question counted, in whole
 * milliseconds; undefined when no attempt recalled. Percentiles interpolate
 * linearly between the two nearest times.
 */
export function recallPercentiles(
  results: readonly Pick<AssistantEvalCaseResult, 'memory' | 'attempts'>[],
): { p50: number; p90: number } | undefined {
  const times = results
    .flatMap((result) =>
      result.attempts?.length
        ? result.attempts.map((attempt) => attempt.memory?.recallMs)
        : [result.memory?.recallMs],
    )
    .filter((ms): ms is number => typeof ms === 'number')
    .sort((a, b) => a - b);
  if (!times.length) return undefined;
  return { p50: percentile(times, 0.5), p90: percentile(times, 0.9) };
}

function percentile(sorted: readonly number[], p: number): number {
  const at = (sorted.length - 1) * p;
  const low = Math.floor(at);
  const high = Math.ceil(at);
  return Math.round(sorted[low] + (sorted[high] - sorted[low]) * (at - low));
}

/**
 * The run's recall line after the cost line (R245), under a memory arm:
 * `Recall: p50 <ms> ms · p90 <ms> ms`, or `Recall: none` when no attempt
 * recalled (every teach step failed, say). None under `none`.
 */
export function recallLine(
  arm: MemoryArm,
  results: readonly Pick<AssistantEvalCaseResult, 'memory' | 'attempts'>[],
): string | undefined {
  if (arm === 'none') return undefined;
  const recall = recallPercentiles(results);
  return recall
    ? `Recall: p50 ${recall.p50} ms · p90 ${recall.p90} ms`
    : 'Recall: none';
}

/**
 * The tail of the cost line (R245): a memory that calls a model outside the
 * app (a Hindsight server's own fact extraction) is not in the cost.
 */
export function costLineSuffix(arm: MemoryArm): string {
  return arm === 'hindsight-mastra'
    ? " · excludes the memory server's own model calls"
    : '';
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
