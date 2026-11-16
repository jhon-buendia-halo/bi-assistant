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

/** How a sentence about an exit starts, by what ends: a run, or a turn. */
const EXIT_LEAD = {
  run: { fails: 'Fails if', stops: 'Ends if', waits: 'Waits' },
  turn: {
    fails: 'Fails the turn if',
    stops: 'Ends the turn if',
    waits: 'Waits',
  },
} as const;

/**
 * A step's exit as one sentence, the outcome first (ui.md 4.4b, 4.5.6):
 * `Fails if the model returns an error`, `Ends if you stop it`, `Waits if
 * it asks you a question`. An exit's `label` is the rest of
 * the sentence: the condition of a `fails` or `stops` exit, and for a
 * `waits` exit the clause with its own connector (`if …`, `until …`).
 */
export function exitSentence(
  exit: { label: string; outcome: 'fails' | 'stops' | 'waits' },
  ends: 'run' | 'turn' = 'run',
): string {
  return `${EXIT_LEAD[ends][exit.outcome]} ${exit.label}`;
}

/** The cards of a workflow drawing, in run order. A pure function. */
export function workflowCards(workflow: AgentWorkflow): WorkflowCard[] {
  const { steps } = workflow;
  return steps.map((step, i) => ({
    step,
    number: i + 1,
    kindLabel: step.kind === 'agent' ? 'LLM' : 'Code',
    edgeLabel: i < steps.length - 1 ? step.output.join(', ') : null,
    exits: step.exits.map((exit) => ({
      text: exitSentence(exit, 'turn'),
      outcome: exit.outcome,
    })),
  }));
}
