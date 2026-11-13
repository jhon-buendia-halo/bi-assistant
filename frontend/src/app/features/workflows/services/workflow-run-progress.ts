import { END_NODE_ID, START_NODE_ID } from '../models/workflow-node.model';
import {
  LiveToolCall,
  RunStepView,
  RunView,
  WorkflowDetail,
} from '../models/workflow.model';
import { mainPath, workflowEdges } from './workflow-graph';

/** How a step reads in the run progress (ui.md 4.4b). */
export type ProgressState =
  | 'pending'
  | 'done'
  | 'current'
  | 'waiting'
  | 'failed'
  | 'skipped'
  | 'stopped';

/** One step of the run progress: each step once, as its last attempt. */
export interface ProgressStep {
  id: string;
  title: string;
  state: ProgressState;
  /** How many times it ran in the run shown; 1 for a step that ran once. */
  attempts: number;
  /** ISO time the current attempt started (a `current` step only). */
  startedAt?: string;
}

/**
 * The workflow's steps in path order (the main path of its `edges`, else the
 * list order), each with its state in the run shown. A step off the main
 * path (Clarify) appears, right after the step it branches from, only once
 * it ran. A step that has not run is `pending`.
 */
export function progressSteps(
  workflow: Pick<WorkflowDetail, 'steps' | 'edges'>,
  run: Pick<RunView, 'status' | 'steps'> | null,
): ProgressStep[] {
  const edges = workflowEdges(workflow);
  const ids = new Set(workflow.steps.map((s) => s.id));
  const order = mainPath(edges).filter(
    (id) => id !== START_NODE_ID && id !== END_NODE_ID && ids.has(id),
  );
  const runEntries = new Map<string, RunStepView[]>();
  for (const step of run?.steps ?? []) {
    if (step.status === null) continue;
    runEntries.set(step.id, [...(runEntries.get(step.id) ?? []), step]);
  }
  // Side steps that ran, after the step they branch from.
  for (const step of workflow.steps) {
    if (order.includes(step.id) || !runEntries.has(step.id)) continue;
    const source = edges.find(
      (e) => e.kind !== 'loop' && e.to === step.id && order.includes(e.from),
    );
    const at = source ? order.indexOf(source.from) + 1 : order.length;
    order.splice(at, 0, step.id);
  }
  const titles = new Map(workflow.steps.map((s) => [s.id, s.title]));
  return order.map((id): ProgressStep => {
    const entries = runEntries.get(id) ?? [];
    const last = entries.at(-1);
    const state: ProgressState =
      last === undefined
        ? 'pending'
        : last.status === 'success'
          ? 'done'
          : last.status === 'running'
            ? 'current'
            : last.status === 'suspended'
              ? 'waiting'
              : (last.status as ProgressState);
    return {
      id,
      title: last?.title ?? titles.get(id) ?? id,
      state,
      attempts: entries.length || 1,
      ...(state === 'current' && last?.startedAt !== undefined
        ? { startedAt: last.startedAt }
        : {}),
    };
  });
}

/** `12 s`, `1 min 4 s`: whole elapsed seconds since `startedAt`. */
export function elapsedLabel(startedAt: string, now: number): string {
  const seconds = Math.max(
    0,
    Math.floor((now - new Date(startedAt).getTime()) / 1000),
  );
  return seconds < 60
    ? `${seconds} s`
    : `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

/**
 * The live activity line under the progress: what the run is doing now;
 * null when it neither runs nor waits. `Analyse · <the latest tool call's
 * rationale>`, else `Analysing…`.
 */
export function activityLine(
  steps: ProgressStep[],
  status: RunView['status'],
  toolCalls: LiveToolCall[],
): string | null {
  if (status === 'suspended') return 'Waiting for your answer';
  if (status !== 'running') return null;
  const current = steps.find((s) => s.state === 'current');
  if (current === undefined) return 'Starting…';
  switch (current.id) {
    case 'plan':
      return 'Planning the analysis…';
    case 'analyse': {
      const rationale = [...toolCalls]
        .reverse()
        .find((call) => call.rationale?.trim())?.rationale;
      return rationale ? `Analyse · ${rationale.trim()}` : 'Analysing…';
    }
    case 'validate':
      return 'Checking the results…';
    case 'write-answer':
      return 'Writing the answer…';
    default:
      return `${current.title}…`;
  }
}
