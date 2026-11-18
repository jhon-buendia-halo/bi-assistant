/**
 * What an eval target hands its case's checks beyond the answer text and
 * the tool calls (agents.md 8.1, "Run details"). Framework-free, so every
 * check module and its spec can import it.
 *
 * A target's `generate` returns the details on its result under
 * `EVAL_DETAILS_KEY`; `runAssistantEvalCase` reads them there and gives
 * them to every custom check as `details` (`{}` when the target sets none).
 */

/** One tool call as the checks read it (the shape of `EvalRawToolCall`). */
export interface EvalDetailsToolCall {
  name: string;
  input: unknown;
  output: unknown;
  failed: boolean;
}

/** Structured facts of one case's run, for the checks. */
export interface EvalRunDetails {
  /**
   * Isolated-call targets (`isolatedCallTarget`): the call's whole output,
   * as the call returned it (the scored answer is `answerOf` of it, as
   * JSON text).
   */
  output?: unknown;
  /**
   * Whole-workflow targets: each step's output by step id, as the engine
   * handed it on (`workflow-step-result` with `success` or `bailed`). The
   * key is the step's own id without its nested workflow's prefix
   * (`plan`, `validate`, `write-answer`, `build-visual`,
   * `save-report`, `explain-report`); a step that ran several times
   * (Analyse and Validate on a retry) holds its last output. A step that
   * did not run has no key.
   */
  steps?: Record<string, unknown>;
  /**
   * Assess Data Readiness target: the summary of the report the run saved
   * (`overallScore`, `maturity`, `dimensionScores` with each dimension's
   * `score`, `assessed` and `findingCount`, `findingCount`, `topFindings`).
   */
  report?: Record<string, unknown>;
  /**
   * Assess Data Readiness target: Rows behind findings' sources, one
   * `run_readonly_sql` call per top finding (`input` `{ sql, rationale }`,
   * `output` the rows or `{ error }`). They are the run's records, not
   * Sarah's tool calls, so they are not in `toolCalls`.
   */
  findingSources?: EvalDetailsToolCall[];
  /**
   * The context the agent was given before its tool calls, as text (the
   * Insights Analyst target: the catalogue block of Analyse's first request).
   * The judge's prompt holds it in a section of its own, before the tool
   * calls, so it can see the schema the agent worked from (agents.md 8.1).
   */
  judgeContext?: string;
  /**
   * The Insights Analyst shared-context target only (the shared-context
   * experiment): what the run's board held and what its agents read from it.
   * The runner copies it onto the case's result (`AssistantEvalCaseResult`),
   * so a results file can count the reads.
   */
  runContext?: EvalRunContextUse;
}

/** One case's use of the run context board (the shared-context experiment). */
export interface EvalRunContextUse {
  /**
   * Every `read_run_context` call, in order: the entry key, where the page
   * started, how many characters it returned, and the step whose agent read
   * it (`plan`, `analyse`, `write-answer`).
   */
  reads: { key: string; offset: number; chars: number; step: string }[];
  /** Each entry the board held at the end of the run, with its size. */
  entries: { key: string; title: string; chars: number }[];
}

/** The key of a target result's details (`runAssistantEvalCase` reads it). */
export const EVAL_DETAILS_KEY = 'evalDetails';

/**
 * The requestContext key under which `runAssistantEvalCase` puts the case
 * being run, so a target's `generate` can read the case's frozen `input`.
 */
export const EVAL_CASE_CONTEXT_KEY = 'eval-case';

/** The details on a target result, or `{}`. */
export function evalDetailsOf(targetResult: unknown): EvalRunDetails {
  const details = (targetResult as Record<string, unknown> | undefined)?.[
    EVAL_DETAILS_KEY
  ];
  return details && typeof details === 'object' ? details : {};
}

/**
 * A step's id without the nested workflows' prefixes
 * (`question-path.plan` → `plan`).
 */
export function stepKeyOf(id: string): string {
  return id.slice(id.lastIndexOf('.') + 1);
}

/**
 * Adds one workflow stream event to `steps`: the output of a step that
 * ended in `success` or `bailed`; every other event is ignored.
 */
export function recordStepOutput(
  event: unknown,
  steps: Record<string, unknown>,
): void {
  const read = event as {
    type?: unknown;
    payload?: { id?: unknown; status?: unknown; output?: unknown };
  };
  if (read?.type !== 'workflow-step-result') return;
  const id = read.payload?.id;
  const status = read.payload?.status;
  if (typeof id !== 'string' || (status !== 'success' && status !== 'bailed'))
    return;
  steps[stepKeyOf(id)] = read.payload?.output;
}
