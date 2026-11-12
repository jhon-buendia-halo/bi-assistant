import { WorkflowRunStepStatus } from '../../models/workflow.model';
import { WorkflowNodeKind } from '../../models/workflow-node.model';
import { formatDuration } from '../../services/workflow-node-inspection';

/** A duration as the node views show it: `—`, `2 ms`, `13.9 s`, `1 min 4 s`. */
export function formatNodeDuration(ms: number | null | undefined): string {
  return formatDuration(ms ?? null);
}

/** The chip classes (components.css) for a node's status. */
export function nodeStatusChip(status: WorkflowRunStepStatus | null): string {
  switch (status) {
    case 'success':
      return 'chip chip-success';
    case 'failed':
      return 'chip chip-danger';
    case 'stopped':
      return 'chip chip-warning';
    case 'running':
      return 'chip chip-info';
    default:
      return 'chip chip-neutral';
  }
}

/** The background class of a node's status dot. */
export function nodeStatusDot(status: WorkflowRunStepStatus | null): string {
  switch (status) {
    case 'success':
      return 'bg-on-success-soft';
    case 'failed':
      return 'bg-on-danger-soft';
    case 'stopped':
      return 'bg-on-warning-soft';
    case 'running':
      return 'bg-primary animate-pulse';
    default:
      return 'bg-fg-muted/40';
  }
}

const KIND_LABELS: Record<WorkflowNodeKind, string> = {
  trigger: 'Trigger',
  code: 'Code',
  agent: 'LLM',
  output: 'Output',
};

export function nodeKindLabel(kind: WorkflowNodeKind): string {
  return KIND_LABELS[kind];
}
