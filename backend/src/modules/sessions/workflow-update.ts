import type {
  WorkflowPhase,
  WorkflowState,
  WorkflowView,
} from './entities/session.entity';

/**
 * The steps of a session's workflow: the prompt's `## Workflow` phases when it
 * has them, else the ones the agent defined (titles only).
 */
export function workflowPhasesOf(
  promptPhases: readonly WorkflowPhase[],
  state: WorkflowState | undefined,
): { phases: WorkflowPhase[]; source: 'prompt' | 'agent' } {
  if (promptPhases.length) {
    return { phases: [...promptPhases], source: 'prompt' };
  }
  return {
    phases: (state?.steps ?? []).map((title, i) => ({
      number: i + 1,
      title,
    })),
    source: 'agent',
  };
}

/**
 * The steps with the saved progress, or undefined when there are none. A saved
 * step number past the list is dropped. `fixedSource` names where fixed steps
 * come from: a prompt's `## Workflow` (the default) or a workflow-backed
 * agent's code-defined workflow (agents.md 5.11).
 */
export function workflowViewOf(
  promptPhases: readonly WorkflowPhase[],
  state: WorkflowState | undefined,
  fixedSource: 'prompt' | 'workflow' = 'prompt',
): WorkflowView | undefined {
  const found = workflowPhasesOf(promptPhases, state);
  const source = found.source === 'prompt' ? fixedSource : found.source;
  if (!found.phases.length) return undefined;
  const count = found.phases.length;
  // The agent's todo replaces the prompt's default action of a step.
  const phases = found.phases.map((phase) => {
    const action = state?.todos?.[String(phase.number)] ?? phase.action;
    const rest: WorkflowPhase = { ...phase };
    delete rest.action;
    return action ? { ...rest, action } : rest;
  });
  const current = state && state.current <= count ? state.current : null;
  const failed =
    state?.failed !== undefined && state.failed <= count
      ? state.failed
      : undefined;
  return {
    phases,
    source,
    current,
    done: (state?.done ?? []).filter((n) => n <= count),
    skipped: (state?.skipped ?? []).filter((n) => n <= count),
    ...(current !== null && state?.waiting ? { waiting: true } : {}),
    ...(state?.note ? { note: state.note } : {}),
    ...(failed !== undefined ? { failed } : {}),
  };
}
