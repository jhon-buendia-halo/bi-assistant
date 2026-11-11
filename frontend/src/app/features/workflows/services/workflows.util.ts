import { WorkflowSummary } from '../models/workflow.model';

/** The assistant's one-step workflow (workflows R2). */
export const ASSISTANT_WORKFLOW_ID = 'agent:assistant';

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

/** The kind chip: `<n> steps` for a code-defined workflow, else `One step`. */
export function workflowKindLabel(workflow: WorkflowSummary): string {
  return workflow.kind === 'code' ? `${workflow.stepCount} steps` : 'One step';
}

/** `Uses <agent names>`: the agents the workflow's steps call. */
export function workflowUsesLabel(workflow: WorkflowSummary): string {
  return `Uses ${workflow.agents.map((agent) => agent.name).join(', ')}`;
}

/** What Start chat on a workflow does (workflows R6). */
export type WorkflowStartAction =
  | { kind: 'composer'; agentKey: string | undefined }
  | { kind: 'create' };

/**
 * A workflow that takes the datasets the user picks opens the New
 * conversation screen, preselected through today's agent-key parameter
 * (nothing for the Assistant, `assistant-v2` for Questions to Insights v2);
 * any other workflow creates its session at once.
 */
export function workflowStartAction(
  workflow: WorkflowSummary,
): WorkflowStartAction {
  if (!workflow.picksDatasets) return { kind: 'create' };
  return {
    kind: 'composer',
    agentKey:
      workflow.id === ASSISTANT_WORKFLOW_ID
        ? undefined
        : workflow.agents[0]?.key,
  };
}
