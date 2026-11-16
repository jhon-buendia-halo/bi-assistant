import { WorkflowRunSummary } from '../../workflows/models/workflow.model';
import { Agent } from './agents-api.service';

/**
 * What an agent is doing now (ui.md 4.4, 4.5), read from the run history
 * (api.md 120): busy while a run of a workflow whose steps call it is in
 * progress, waiting while such a run waits for the user's answer, else
 * available. An agent no workflow calls (the assistant, a user agent) is
 * always available.
 */
export type AgentActivity =
  | { state: 'available'; label: string }
  | { state: 'working' | 'waiting'; label: string; runId: string };

export function agentActivity(
  agent: Pick<Agent, 'usedInWorkflows'>,
  runs: readonly WorkflowRunSummary[],
): AgentActivity {
  const workflows = new Set((agent.usedInWorkflows ?? []).map((w) => w.id));
  // The history is newest first, so the first match is the latest run.
  const run = runs.find(
    (r) =>
      workflows.has(r.workflowId) &&
      (r.status === 'running' || r.status === 'suspended'),
  );
  if (!run) return { state: 'available', label: 'Available' };
  return run.status === 'running'
    ? { state: 'working', label: `Working on “${run.title}”`, runId: run.id }
    : {
        state: 'waiting',
        label: `Waiting for your answer on “${run.title}”`,
        runId: run.id,
      };
}
