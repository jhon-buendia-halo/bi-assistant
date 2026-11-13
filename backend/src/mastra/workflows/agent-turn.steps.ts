/**
 * The one-step workflow of an agent with no workflow of its own (ADR-0040;
 * agents.md 5.12): its engine id, its single `answer` step and the contract
 * between that step and the session code. Plain data, no framework import,
 * so the catalogue, the session code and the tests can read it without
 * loading Mastra. The Mastra workflow itself is built by story 1.23.4.
 */
import type { TurnCallsOutcome, WorkflowStepEntry } from './qti-v2-turn.steps';

/** The engine every one-step workflow runs on (registered once, 1.23.4). */
export const AGENT_TURN_WORKFLOW_ID = 'agent-turn';

/** The run's RequestContext key holding the per-run `AgentTurnRuntime`. */
export const AGENT_TURN_RUNTIME_KEY = 'agent-turn-runtime';

/** The one step: the agent answers the turn. */
export const AGENT_TURN_STEPS = [
  {
    id: 'answer',
    title: 'Answer',
    kind: 'agent',
    summary: 'The agent answers with its tools, streamed to the chat.',
    input: ['question', 'datasets'],
    output: ['calls', 'stopped'],
    exits: [
      { label: 'Model error', outcome: 'fails' },
      { label: 'Stop', outcome: 'stops' },
    ],
  },
] as const satisfies readonly WorkflowStepEntry[];

/** What the session code hands the run (on its RequestContext). */
export interface AgentTurnRuntime {
  /** Runs the session's agent turn (agents.md 5.1 steps 2-3); never throws for a stream error that 5.1 swallows. */
  answer(): Promise<TurnCallsOutcome>;
}
