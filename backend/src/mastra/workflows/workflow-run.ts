/**
 * The result of one run of a run workflow (api.md 118; plan 9.3), and the
 * pure mapping from the engine's run result to it. No framework import, so
 * the workflows module and Jest can read it without loading Mastra.
 */

/** One step of a run, in the order the workflow defines them. */
export interface WorkflowRunStepResult {
  id: string;
  title: string;
  status: 'success' | 'failed' | 'skipped';
  output?: Record<string, unknown>;
  error?: string;
}

/** What `POST /workflows/:id/runs` answers (200), success or not. */
export interface WorkflowRunResult {
  workflowId: string;
  status: 'success' | 'failed';
  steps: WorkflowRunStepResult[];
  output?: Record<string, unknown>;
  error?: string;
}

/** The engine's run result, as much of it as the mapping reads. */
export interface EngineRunResult {
  status: string;
  steps?: Record<
    string,
    { status?: string; output?: unknown; error?: unknown }
  >;
  result?: unknown;
  error?: unknown;
}

/** An error's message: an `Error`, a serialized one, or a string. */
export function runErrorMessage(error: unknown): string {
  if (typeof error === 'string') return error;
  if (
    error &&
    typeof error === 'object' &&
    typeof (error as { message?: unknown }).message === 'string'
  ) {
    return (error as { message: string }).message;
  }
  return 'The run failed';
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * A run's result in the API's shape: every step of `steps`, in order, with
 * its status and output, or its error once it failed. A step the engine did
 * not run is `skipped`. Any status but `success` makes the run `failed`,
 * with the failing step's error (else the engine's).
 */
export function workflowRunResult(
  workflowId: string,
  steps: readonly { id: string; title: string }[],
  engine: EngineRunResult,
): WorkflowRunResult {
  const ran = engine.steps ?? {};
  const mapped = steps.map((step): WorkflowRunStepResult => {
    const state = Object.hasOwn(ran, step.id) ? ran[step.id] : undefined;
    if (state?.status === 'success') {
      const output = asRecord(state.output);
      return {
        id: step.id,
        title: step.title,
        status: 'success',
        ...(output ? { output } : {}),
      };
    }
    if (state?.status === 'failed') {
      return {
        id: step.id,
        title: step.title,
        status: 'failed',
        error: runErrorMessage(state.error),
      };
    }
    return { id: step.id, title: step.title, status: 'skipped' };
  });
  if (engine.status === 'success') {
    const output = asRecord(engine.result);
    return {
      workflowId,
      status: 'success',
      steps: mapped,
      ...(output ? { output } : {}),
    };
  }
  const failedStep = mapped.find((step) => step.status === 'failed');
  return {
    workflowId,
    status: 'failed',
    steps: mapped,
    error:
      failedStep?.error ??
      (engine.error === undefined
        ? `The run ended as ${engine.status}`
        : runErrorMessage(engine.error)),
  };
}
