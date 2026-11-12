import {
  WorkflowInputField,
  WorkflowInputValue,
  WorkflowRun,
  WorkflowRunRequest,
  WorkflowRunStepStatus,
  WorkflowSummary,
} from '../models/workflow.model';

/** The assistant's one-step workflow (workflows R2). */
export const ASSISTANT_WORKFLOW_ID = 'agent:assistant';
/** Its catalogue name and description (plan 5.2), shown before the list loads. */
export const ASSISTANT_WORKFLOW_NAME = 'Assistant';
export const ASSISTANT_WORKFLOW_DESCRIPTION =
  'Answers questions over the datasets you pick.';

export type WorkflowSectionId = 'official' | 'mine';

export interface WorkflowSection {
  id: WorkflowSectionId;
  label: 'Official' | 'Mine';
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

/**
 * The Workflows page's sections (workflows R5, ui.md 4.4a): Official, then
 * Mine (the user agents' workflows), each in the catalogue's own order
 * (workflows R1). A section with nothing to show, after the search, is left
 * out.
 */
export function buildWorkflowSections(
  workflows: readonly WorkflowSummary[],
  query: string,
): WorkflowSection[] {
  const needle = query.trim().toLowerCase();
  const shown = workflows.filter((workflow) => matches(workflow, needle));
  const sections: WorkflowSection[] = [
    {
      id: 'official',
      label: 'Official',
      workflows: shown.filter((workflow) => workflow.owner === 'Official'),
    },
    {
      id: 'mine',
      label: 'Mine',
      workflows: shown.filter((workflow) => workflow.owner === 'You'),
    },
  ];
  return sections.filter((section) => section.workflows.length > 0);
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

/**
 * The kind chip: `Runs on an input` for a run workflow, `<n> steps` for a
 * code-defined chat workflow, else `One step`.
 */
export function workflowKindLabel(workflow: WorkflowSummary): string {
  if (workflow.trigger === 'run') return 'Runs on an input';
  return workflow.kind === 'code' ? `${workflow.stepCount} steps` : 'One step';
}

/**
 * `Uses <agent names>`: the agents the workflow's steps call; empty for a
 * workflow that calls none.
 */
export function workflowUsesLabel(workflow: WorkflowSummary): string {
  if (workflow.agents.length === 0) return '';
  return `Uses ${workflow.agents.map((agent) => agent.name).join(', ')}`;
}

/**
 * The workflows a chat can run, in catalogue order: the New conversation
 * screen's Workflow field never offers a run workflow (sessions-chat R64).
 */
export function chatWorkflows(
  workflows: readonly WorkflowSummary[],
): WorkflowSummary[] {
  return workflows.filter((workflow) => workflow.trigger === 'chat');
}

/** What Start chat on a workflow does (workflows R6). */
export type WorkflowStartAction =
  | { kind: 'composer'; workflowId: string }
  | { kind: 'create' };

/**
 * A workflow that takes the datasets the user picks opens the New
 * conversation screen with that workflow preselected; any other workflow
 * creates its session at once.
 */
export function workflowStartAction(
  workflow: WorkflowSummary,
): WorkflowStartAction {
  if (!workflow.picksDatasets) return { kind: 'create' };
  return { kind: 'composer', workflowId: workflow.id };
}

/**
 * The workflow the New conversation screen's Workflow field shows
 * (sessions-chat R64): the preselected one when it is listed and can start a
 * chat, else Assistant.
 */
export function composerWorkflowId(
  workflows: readonly WorkflowSummary[],
  preselect: string | undefined,
): string {
  if (!preselect) return ASSISTANT_WORKFLOW_ID;
  const workflow = chatWorkflows(workflows).find((w) => w.id === preselect);
  return workflow && !workflow.chatRequirement
    ? workflow.id
    : ASSISTANT_WORKFLOW_ID;
}

/** `POST /sessions` from the New conversation screen (api.md 3). */
export interface ComposerCreateBody {
  workflowId: string;
  name?: string;
  datasets?: string[];
}

/**
 * The body **Create** sends (sessions-chat R64): a workflow that picks
 * datasets (Assistant when the catalogue did not load) sends the name and the
 * picked datasets; any other workflow sends the name only when one is typed.
 */
export function composerCreateBody(
  workflow: Pick<WorkflowSummary, 'id' | 'picksDatasets'> | null,
  name: string,
  datasets: string[],
): ComposerCreateBody {
  if (!workflow || workflow.picksDatasets) {
    return {
      workflowId: workflow?.id ?? ASSISTANT_WORKFLOW_ID,
      name,
      datasets,
    };
  }
  return { workflowId: workflow.id, ...(name ? { name } : {}) };
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
    case 'running':
      return 'Running…';
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
};

/** A run step's status chip (plan 5.6). */
export function runStepStatusLabel(status: WorkflowRunStepStatus): string {
  return STEP_STATUS_LABELS[status];
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
 * Agent workflows whose page run lands in a later story: the RFP Builder
 * (1.23.17). The Data Readiness Agent runs from its page since 1.23.16.
 */
const PAGE_RUN_LATER = new Set(['agent:rfp']);

/**
 * Whether the workflow's page offers Execute and the Run tab (workflows R12,
 * R21): every run workflow, and the agent workflows with an input (the
 * Assistant, Questions to Insights v2 and each user agent's).
 */
export function canRunFromPage(
  workflow: Pick<WorkflowSummary, 'id' | 'trigger' | 'input'>,
): boolean {
  if (workflow.trigger === 'run') return true;
  return workflow.input.length > 0 && !PAGE_RUN_LATER.has(workflow.id);
}

/** The values a run form holds, by field name. */
export type RunFormValues = Record<string, WorkflowInputValue>;

/**
 * The form's first values: a boolean is its default (unchecked without one);
 * any other field with a default shows it as text.
 */
export function initialInputValues(fields: WorkflowInputField[]): RunFormValues {
  const values: RunFormValues = {};
  for (const field of fields) {
    if (field.hidden) continue;
    if (field.type === 'boolean') {
      values[field.name] = field.default === true;
    } else if (field.default !== undefined && typeof field.default !== 'boolean') {
      values[field.name] = String(field.default);
    }
  }
  return values;
}

/**
 * The `input` a run sends (api.md 118): each visible field in form order, as
 * its type takes it (a boolean always, a list of datasets, one dataset or a
 * text); an untouched field is left out, so the server applies its default
 * or refuses a required one.
 */
export function runInput(
  fields: WorkflowInputField[],
  values: RunFormValues,
): Record<string, WorkflowInputValue> {
  const input: Record<string, WorkflowInputValue> = {};
  for (const field of fields) {
    if (field.hidden) continue;
    const value = Object.hasOwn(values, field.name) ? values[field.name] : undefined;
    if (field.type === 'boolean') {
      input[field.name] = value === true;
    } else if (field.type === 'datasets') {
      if (Array.isArray(value)) input[field.name] = [...value];
    } else if (value !== undefined && !Array.isArray(value)) {
      input[field.name] = typeof value === 'string' ? value : String(value);
    }
  }
  return input;
}

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
): WorkflowRunRequest {
  return {
    input: { ...run.input, [questionField]: question.trim() },
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
    const value = input[field.name];
    values[field.name] = Array.isArray(value)
      ? [...value]
      : typeof value === 'boolean'
        ? value
        : String(value);
  }
  return values;
}

/** One page of the Runs list (ten, as sessions-chat R63). */
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

/** A run row's status chip text. */
export function runRowStatus(status: WorkflowRun['status']): string {
  return { success: 'Done', failed: 'Failed', stopped: 'Stopped', running: 'Running' }[
    status
  ];
}
