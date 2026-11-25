import {
  WorkflowInputField,
  WorkflowInputValue,
  WorkflowRun,
  WorkflowRunRequest,
  WorkflowRunStepStatus,
  WorkflowSummary,
} from '../models/workflow.model';
import { WorkflowNodeStatus } from '../models/workflow-node.model';

/** One Workflows section: a category and its workflows. */
export interface WorkflowSection {
  /** The category id (`data-analytics`). */
  id: string;
  /** The category name (`Data Analytics`). */
  label: string;
  workflows: WorkflowSummary[];
}

/** Whether the workflow's name or description holds `query` (any case). */
function matches(workflow: WorkflowSummary, query: string): boolean {
  if (!query) return true;
  return (
    workflow.name.toLowerCase().includes(query) ||
    workflow.description.toLowerCase().includes(query)
  );
}

/** The filter pills' value: every category (`all`) or one category id. */
export type WorkflowFilter = 'all' | string;

/**
 * The workflows grouped by category: one section per category, in the order
 * its first workflow comes in the catalogue, each with its workflows in the
 * catalogue's own order (workflows R1).
 */
function groupByCategory(
  workflows: readonly WorkflowSummary[],
): WorkflowSection[] {
  const sections = new Map<string, WorkflowSection>();
  for (const workflow of workflows) {
    const { id, name } = workflow.category;
    const section = sections.get(id) ?? { id, label: name, workflows: [] };
    section.workflows.push(workflow);
    sections.set(id, section);
  }
  return [...sections.values()];
}

/**
 * The filter pills (workflows R5, ui.md 4.4a): All, then one per category,
 * in section order. Built from every workflow, so the pills do not move as
 * the user types a search.
 */
export function workflowFilters(
  workflows: readonly WorkflowSummary[],
): { id: WorkflowFilter; label: string }[] {
  return [
    { id: 'all', label: 'All' },
    ...groupByCategory(workflows).map(({ id, label }) => ({ id, label })),
  ];
}

/**
 * The Workflows page's sections (workflows R5, ui.md 4.4a): one per category,
 * or only the picked one, holding the workflows that match the search. A
 * category with nothing to show gets no section.
 */
export function buildWorkflowSections(
  workflows: readonly WorkflowSummary[],
  filter: WorkflowFilter,
  query: string,
): WorkflowSection[] {
  const needle = query.trim().toLowerCase();
  return groupByCategory(
    workflows.filter(
      (workflow) =>
        (filter === 'all' || workflow.category.id === filter) &&
        matches(workflow, needle),
    ),
  );
}

/** The text shown instead of the sections, or null while one shows. */
export function workflowsEmptyMessage(
  query: string,
  sections: readonly WorkflowSection[],
): string | null {
  if (sections.length > 0) return null;
  const trimmed = query.trim();
  return trimmed ? `No workflows match "${trimmed}"` : null;
}

/** The kind chip: `<n> steps`, `1 step` (workflows R5). */
export function workflowKindLabel(
  workflow: Pick<WorkflowSummary, 'stepCount'>,
): string {
  return `${workflow.stepCount} ${workflow.stepCount === 1 ? 'step' : 'steps'}`;
}

/**
 * `Uses <agent names>`: the agents the workflow's steps call; empty for a
 * workflow that calls none.
 */
export function workflowUsesLabel(workflow: WorkflowSummary): string {
  if (workflow.agents.length === 0) return '';
  return `Uses ${workflow.agents.map((agent) => personaInList(agent)).join(', ')}`;
}

/**
 * An agent persona with its role, wherever the app names one (workflows
 * R39): `Michael, Insights Analyst`; the name alone without a role.
 */
export function personaLabel(agent: {
  name: string;
  role?: string | null;
}): string {
  const role = agent.role?.trim();
  return role ? `${agent.name}, ${role}` : agent.name;
}

/** The same inside a comma-separated list: `Michael (Insights Analyst)`. */
export function personaInList(agent: {
  name: string;
  role?: string | null;
}): string {
  const role = agent.role?.trim();
  return role ? `${agent.name} (${role})` : agent.name;
}

/**
 * A run's status line (workflows R13, R21): `Run succeeded`,
 * `Run failed: <error>`, `Run stopped`, or `Running…` while it streams.
 */
export function runStatusLine(run: {
  status: WorkflowRun['status'];
  error?: string;
}): string {
  switch (run.status) {
    case 'success':
      return 'Run succeeded';
    case 'stopped':
      return 'Run stopped';
    case 'queued':
      return 'Queued…';
    case 'running':
      return 'Running…';
    case 'suspended':
      return 'Waiting for you';
    default:
      return run.error ? `Run failed: ${run.error}` : 'Run failed';
  }
}

const STEP_STATUS_LABELS: Record<WorkflowRunStepStatus, string> = {
  running: 'Running',
  success: 'Done',
  failed: 'Failed',
  skipped: 'Skipped',
  stopped: 'Stopped',
  suspended: 'Waiting for you',
};

/** A run step's status chip (plan 5.6). */
export function runStepStatusLabel(status: WorkflowRunStepStatus): string {
  return STEP_STATUS_LABELS[status];
}

/** A canvas node's status: a run step's, or `Invalid input` for a refused Start (ui.md 4.4b). */
export function nodeStatusLabel(status: WorkflowNodeStatus): string {
  return status === 'invalid' ? 'Invalid input' : STEP_STATUS_LABELS[status];
}

/** One field of a run's or a step's output, as the result shows it. */
export interface RunOutputEntry {
  key: string;
  /** A text as it is (quotes unescaped); a list or an object as pretty JSON. */
  value: string;
  /** A list or an object: shown monospaced, keeping its line breaks. */
  structured: boolean;
}

/**
 * An output, field by field: a text as it is, a number, boolean or null as it
 * reads, a list or an object as pretty JSON.
 */
export function runOutputEntries(
  output: Record<string, unknown> | undefined,
): RunOutputEntry[] {
  return Object.entries(output ?? {}).map(([key, value]) => {
    if (typeof value === 'string') return { key, value, structured: false };
    if (value !== null && typeof value === 'object') {
      return { key, value: JSON.stringify(value, null, 2), structured: true };
    }
    return { key, value: String(value), structured: false };
  });
}

/**
 * Whether the workflow's page offers Execute and the Run tab (workflows R12,
 * R21): every workflow that declares an input.
 */
export function canRunFromPage(
  workflow: Pick<WorkflowSummary, 'input'>,
): boolean {
  return workflow.input.length > 0;
}

/** The values a run form holds, by field name. */
export type RunFormValues = Record<string, WorkflowInputValue>;

/**
 * The form's first values: a boolean is its default (unchecked without one);
 * any other field with a default shows it as text.
 */
export function initialInputValues(
  fields: WorkflowInputField[],
): RunFormValues {
  const values: RunFormValues = {};
  for (const field of fields) {
    if (field.hidden) continue;
    if (field.type === 'boolean') {
      values[field.name] = field.default === true;
    } else if (
      field.default !== undefined &&
      typeof field.default !== 'boolean'
    ) {
      values[field.name] = String(field.default);
    }
  }
  return values;
}

/**
 * The `input` a run sends (api.md 118): each visible field in form order, as
 * its type takes it (a boolean always, a list of datasets or a text); an
 * untouched field is left out, so the server applies its default
 * or refuses a required one.
 */
export function runInput(
  fields: WorkflowInputField[],
  values: RunFormValues,
): Record<string, WorkflowInputValue> {
  const input: Record<string, WorkflowInputValue> = {};
  for (const field of fields) {
    if (field.hidden) continue;
    const value = Object.hasOwn(values, field.name)
      ? values[field.name]
      : undefined;
    if (field.type === 'boolean') {
      input[field.name] = value === true;
    } else if (field.type === 'datasets') {
      if (Array.isArray(value)) input[field.name] = [...value];
    } else if (field.type === 'images') {
      // No image attached sends nothing.
      if (Array.isArray(value) && value.length > 0) {
        input[field.name] = [...value];
      }
    } else if (field.type === 'artifact' || field.type === 'image') {
      // Picking one of the pair clears the other: an empty one sends nothing.
      if (typeof value === 'string' && value !== '') input[field.name] = value;
    } else if (value !== undefined && !Array.isArray(value)) {
      input[field.name] = typeof value === 'string' ? value : String(value);
    }
  }
  return input;
}

/** The input field that holds a run's reference images (api.md 116). */
export const IMAGES_FIELD = 'images';

/** The field a follow-up's question goes into: the first visible text area. */
export function questionFieldName(fields: WorkflowInputField[]): string | null {
  const field = fields.find((f) => !f.hidden && f.type === 'textarea');
  return field ? field.name : null;
}

/**
 * A follow-up (plan 5.4; workflows R17, R21): the earlier run's input with
 * the new question, and the earlier run as the context.
 */
export function followUpRequest(
  run: Pick<WorkflowRun, 'id' | 'input'>,
  questionField: string,
  question: string,
  images?: readonly string[],
): WorkflowRunRequest {
  const input = { ...run.input, [questionField]: question.trim() };
  // The composer's attachments (the run's kept paths and the new `data:`
  // URLs) replace the earlier run's; without them the stored ones carry over.
  if (images !== undefined) {
    if (images.length > 0) input[IMAGES_FIELD] = [...images];
    else delete input[IMAGES_FIELD];
  }
  return {
    input,
    context: { fromRunId: run.id },
  };
}

/**
 * The form values that run a stored run's input again (plan 1.24.11): its
 * visible fields as the form holds them, a number as text.
 */
export function runAgainValues(
  fields: WorkflowInputField[],
  input: Record<string, WorkflowInputValue>,
): RunFormValues {
  const values = initialInputValues(fields);
  for (const field of fields) {
    if (field.hidden || !Object.hasOwn(input, field.name)) continue;
    // A stored run holds the image's path, not the image: it is picked again.
    if (field.type === 'image' || field.type === 'images') continue;
    const value = input[field.name];
    values[field.name] = Array.isArray(value)
      ? [...value]
      : typeof value === 'boolean'
        ? value
        : String(value);
  }
  return values;
}

/** One page of the Runs list (ten, as past-chats R63). */
export const RUNS_PAGE_SIZE = 10;

/** The runs whose title, workflow name or id contains the query. */
export function filterRuns<
  T extends { title: string; workflowName: string; id: string },
>(runs: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return runs;
  return runs.filter(
    (run) =>
      run.title.toLowerCase().includes(q) ||
      run.workflowName.toLowerCase().includes(q) ||
      run.id.toLowerCase().includes(q),
  );
}

/** A run that holds the conversation: queued, running or suspended (not finished). */
export function isActiveRun(status: WorkflowRun['status']): boolean {
  return status === 'queued' || status === 'running' || status === 'suspended';
}

/** A run that has not finished and is not waiting on the user: queued or running. */
export function isLiveRun(status: WorkflowRun['status']): boolean {
  return status === 'queued' || status === 'running';
}

/** A run row's status chip text. */
export function runRowStatus(status: WorkflowRun['status']): string {
  return {
    success: 'Done',
    failed: 'Failed',
    stopped: 'Stopped',
    queued: 'Queued',
    running: 'Running',
    suspended: 'Waiting for you',
  }[status];
}
