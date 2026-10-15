import type {
  WorkflowToolInput,
  WorkflowToolResult,
} from '../../mastra/tool-services';
import type {
  WorkflowPhase,
  WorkflowState,
  WorkflowView,
} from './entities/session.entity';

/** Limits of `update_workflow` (agents.md 3.11). */
const MIN_STEPS = 2;
const MAX_STEPS = 12;
const STEP_TITLE_CHARS = 80;
const NOTE_CHARS = 2000;
const ACTION_CHARS = 120;

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
 * step number past the list is dropped.
 */
export function workflowViewOf(
  promptPhases: readonly WorkflowPhase[],
  state: WorkflowState | undefined,
): WorkflowView | undefined {
  const found = workflowPhasesOf(promptPhases, state);
  const source = found.source;
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
  return {
    phases,
    source,
    current,
    done: (state?.done ?? []).filter((n) => n <= count),
    skipped: (state?.skipped ?? []).filter((n) => n <= count),
    ...(current !== null && state?.waiting ? { waiting: true } : {}),
    ...(state?.note ? { note: state.note } : {}),
  };
}

function numberList(text: string | undefined): number[] {
  return (text ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map(Number);
}

/**
 * The `todo` input: `"<step>: <action>"` items separated by `" | "`. An item
 * with no action after the colon restores the step's default (value `''`).
 */
function parseTodo(text: string, count: number): Map<number, string> {
  const format = 'todo must list "<step>: <action>" items separated by " | "';
  const items = text
    .split('|')
    .map((item) => item.trim())
    .filter(Boolean);
  if (!items.length) throw new Error(format);
  const result = new Map<number, string>();
  for (const item of items) {
    const match = /^(\d+)\s*:\s*(.*)$/s.exec(item);
    if (!match) throw new Error(format);
    const step = Number(match[1]);
    if (step < 1 || step > count) {
      throw new Error(
        `todo step ${step} is not a step number from 1 to ${count}`,
      );
    }
    const action = match[2].trim();
    if (action.length > ACTION_CHARS) {
      throw new Error('A step action is at most 120 characters');
    }
    result.set(step, action);
  }
  return result;
}

const unique = (numbers: number[]) =>
  [...new Set(numbers)].sort((a, b) => a - b);

/**
 * Apply an `update_workflow` call: the state to save and the result the model
 * sees. `promptSteps` is how many steps the effective prompt's `## Workflow`
 * lists (0 for none). Throws an `Error` whose message is the one the tool
 * returns to the model.
 */
export function applyWorkflowUpdate(
  input: WorkflowToolInput,
  context: {
    promptSteps: number;
    state: WorkflowState | undefined;
    now?: Date;
  },
): { state: WorkflowState; result: WorkflowToolResult } {
  const updatedAt = (context.now ?? new Date()).toISOString();
  const hasSection = context.promptSteps > 0;
  if (input.steps !== undefined && hasSection) {
    throw new Error(
      'Your ## Workflow section defines the steps; set their status instead',
    );
  }
  let titles: string[] | undefined;
  if (input.steps !== undefined) {
    titles = input.steps
      .split('|')
      .map((title) => title.trim())
      .filter(Boolean);
    if (
      titles.length < MIN_STEPS ||
      titles.length > MAX_STEPS ||
      titles.some((title) => title.length > STEP_TITLE_CHARS)
    ) {
      throw new Error(
        'steps takes 2 to 12 titles of at most 80 characters each',
      );
    }
  }
  const steps = hasSection ? undefined : (titles ?? context.state?.steps);
  const count = hasSection ? context.promptSteps : (steps?.length ?? 0);
  if (count < 1) {
    throw new Error('There is no workflow yet: pass steps to create one');
  }
  // New steps start over; otherwise the call builds on the stored state.
  const previous = titles ? undefined : context.state;
  const valid = (n: number) => Number.isInteger(n) && n >= 1 && n <= count;
  if (input.current !== undefined && !valid(input.current)) {
    throw new Error(`current must be a step number from 1 to ${count}`);
  }
  const given = (
    text: string | undefined,
    name: string,
  ): number[] | undefined => {
    if (text === undefined) return undefined;
    const list = numberList(text);
    if (!list.every(valid)) {
      throw new Error(`${name} must list step numbers from 1 to ${count}`);
    }
    return unique(list);
  };
  const doneGiven = given(input.done, 'done');
  const skippedGiven = given(input.skipped, 'skipped');
  const note = input.note?.trim();
  if (note && note.length > NOTE_CHARS) {
    throw new Error('The note is at most 2,000 characters');
  }

  const todoGiven =
    input.todo === undefined ? undefined : parseTodo(input.todo, count);

  const done = doneGiven ?? (previous?.done ?? []).filter((n) => n <= count);
  const skipped =
    skippedGiven ?? (previous?.skipped ?? []).filter((n) => n <= count);
  const stored =
    previous && previous.current <= count ? previous.current : undefined;
  const current =
    input.current ??
    stored ??
    Array.from({ length: count }, (_, i) => i + 1).find(
      (n) => !done.includes(n) && !skipped.includes(n),
    ) ??
    count;
  // The card (note, waiting) belongs to the current step: it is
  // kept while the step stays and cleared when it changes.
  const sameStep = previous !== undefined && current === stored;
  const keptNote = sameStep ? previous?.note : undefined;
  const cardNote = note === undefined ? keptNote : note || undefined;
  const waiting =
    input.waiting === undefined
      ? sameStep && previous?.waiting === true
      : input.waiting;

  // The todos stay across calls; a step named with no action goes back to
  // its default. New steps (`previous` undefined) start with none.
  const todoMap = new Map<number, string>(
    Object.entries(previous?.todos ?? {})
      .map(([n, action]): [number, string] => [Number(n), action])
      .filter(([n]) => n <= count),
  );
  for (const [n, action] of todoGiven ?? []) {
    if (action) todoMap.set(n, action);
    else todoMap.delete(n);
  }
  const todos = Object.fromEntries(
    [...todoMap].sort((a, b) => a[0] - b[0]).map(([n, a]) => [String(n), a]),
  );

  const state: WorkflowState = {
    current,
    done,
    ...(skipped.length ? { skipped } : {}),
    ...(waiting ? { waiting: true } : {}),
    ...(cardNote ? { note: cardNote } : {}),
    ...(steps ? { steps } : {}),
    ...(todoMap.size ? { todos } : {}),
    updatedAt,
  };
  return {
    state,
    result: { updated: true, steps: count, current, done, skipped },
  };
}
