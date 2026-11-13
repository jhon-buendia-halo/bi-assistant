import { AgentWorkflow, AgentWorkflowStep } from './agents-api.service';

/** One card of the workflow drawing (agents-evals R108, ui.md 4.5.6). */
export interface WorkflowCard {
  step: AgentWorkflowStep;
  /** 1-based, as in the workflow bar. */
  number: number;
  kindLabel: 'Code' | 'LLM';
  /** The fields passed to the next step; null for the last step. */
  edgeLabel: string | null;
  exits: { text: string; outcome: 'fails' | 'stops' | 'waits' }[];
}

const OUTCOME_TEXT = {
  fails: 'fails the turn',
  stops: 'ends the turn here',
  waits: "waits for the user's answer",
} as const;

/** The cards of a workflow drawing, in run order. A pure function. */
export function workflowCards(workflow: AgentWorkflow): WorkflowCard[] {
  const { steps } = workflow;
  return steps.map((step, i) => ({
    step,
    number: i + 1,
    kindLabel: step.kind === 'agent' ? 'LLM' : 'Code',
    edgeLabel: i < steps.length - 1 ? step.output.join(', ') : null,
    exits: step.exits.map((exit) => ({
      text: `${exit.label} → ${OUTCOME_TEXT[exit.outcome]}`,
      outcome: exit.outcome,
    })),
  }));
}
