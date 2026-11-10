import type { WorkflowPhase, WorkflowState } from './entities/session.entity';

/**
 * One step event of a workflow run, stack-neutral: a step started, or ended
 * with a status (`success`, `failed`, or anything else, such as a step that
 * ended the run early).
 */
export type WorkflowStepEvent =
  | { kind: 'start'; stepId: string }
  | { kind: 'end'; stepId: string; status: string };

/**
 * A workflow run's step event as the engine streams it (`workflow-step-start`,
 * `workflow-step-result`), or undefined for any other event.
 */
export function stepEventOf(event: {
  type: string;
  payload?: { id?: string; status?: string };
}): WorkflowStepEvent | undefined {
  const stepId = event.payload?.id;
  if (!stepId) return undefined;
  if (event.type === 'workflow-step-start') return { kind: 'start', stepId };
  if (event.type === 'workflow-step-result') {
    return { kind: 'end', stepId, status: event.payload?.status ?? '' };
  }
  return undefined;
}

/** A workflow's steps as the bar's phases, numbered from 1 (agents.md 5.11). */
export function workflowStepPhases(
  steps: readonly { title: string }[],
): WorkflowPhase[] {
  return steps.map((step, i) => ({ number: i + 1, title: step.title }));
}

/**
 * The session's workflow state after one step event of a workflow-backed
 * agent's turn (agents.md 5.11, agent-panel R8a), or undefined when the event
 * changes nothing (a step this workflow doesn't have, or an end that is
 * neither a success nor a failure). The first step starting starts the turn
 * over: nothing done, nothing failed.
 */
export function workflowRunState(
  previous: WorkflowState | undefined,
  event: WorkflowStepEvent,
  stepIds: readonly string[],
  now: Date = new Date(),
): WorkflowState | undefined {
  const index = stepIds.indexOf(event.stepId);
  if (index < 0) return undefined;
  const step = index + 1;
  const updatedAt = now.toISOString();
  if (event.kind === 'start') {
    const fresh = step === 1;
    const done = fresh ? [] : [...(previous?.done ?? [])];
    const failed = fresh ? undefined : previous?.failed;
    return {
      current: step,
      done,
      ...(failed !== undefined ? { failed } : {}),
      updatedAt,
    };
  }
  if (event.status === 'success') {
    const done = [...new Set([...(previous?.done ?? []), step])].sort(
      (a, b) => a - b,
    );
    return {
      current: previous?.current ?? step,
      done,
      ...(previous?.failed !== undefined ? { failed: previous.failed } : {}),
      updatedAt,
    };
  }
  if (event.status === 'failed') {
    return {
      current: step,
      done: (previous?.done ?? []).filter((n) => n !== step),
      failed: step,
      updatedAt,
    };
  }
  return undefined;
}
