import {
  WorkflowRunResult,
  WorkflowRunStepResult,
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

/** A run's status line (workflows R13): `Run succeeded` or `Run failed: <error>`. */
export function runStatusLine(result: WorkflowRunResult): string {
  if (result.status === 'success') return 'Run succeeded';
  return result.error ? `Run failed: ${result.error}` : 'Run failed';
}

/** A run step's status chip. */
export function runStepStatusLabel(
  status: WorkflowRunStepResult['status'],
): 'Done' | 'Failed' | 'Skipped' {
  if (status === 'success') return 'Done';
  return status === 'failed' ? 'Failed' : 'Skipped';
}

/** One field of a run's final output, as the result shows it. */
export interface RunOutputEntry {
  key: string;
  value: string;
}

/** The run's final output, field by field: a text as it is, anything else as JSON. */
export function runOutputEntries(
  output: Record<string, unknown> | undefined,
): RunOutputEntry[] {
  return Object.entries(output ?? {}).map(([key, value]) => ({
    key,
    value: typeof value === 'string' ? value : JSON.stringify(value),
  }));
}
