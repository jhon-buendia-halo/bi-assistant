// The workflow a session's turn runs (agents.md 5.11, 5.12; ADR-0034,
// ADR-0040), as pure functions of the session.
import type { AnalyseOutcome } from '../../../mastra/workflows/qti-v2-turn.steps';
import {
  AGENT_TURN_STEPS,
  AGENT_TURN_WORKFLOW_ID,
} from '../../../mastra/workflows/agent-turn.steps';
import {
  parseWorkflowId,
  sessionWorkflowId,
  type WorkflowBar,
} from '../../../mastra/workflows/workflow-catalog';
import type { SessionDoc, ToolDataRecord } from '../entities/session.entity';

/** A session's workflow as its turn runs it (agents.md 5.12, ADR-0040). */
export interface TurnWorkflow {
  /** The catalogue id: `qti-v2-turn`, `agent:<key>` or `agent:<user-agent id>`. */
  id: string;
  /** The registered Mastra workflow the turn runs. */
  engineId: string;
  /** What drives the bar: the run's step events, or the agent's own phases. */
  bar: WorkflowBar;
  stepIds: string[];
}

/**
 * The workflow a session's turn runs: its code-defined workflow, else its
 * one-step workflow on the `agent-turn` engine.
 */
export function turnWorkflowOf(session: SessionDoc): TurnWorkflow {
  const id = sessionWorkflowId(session);
  const parsed = parseWorkflowId(id);
  if (parsed?.kind === 'code') {
    return {
      id,
      engineId: parsed.source.id,
      bar: parsed.source.bar,
      stepIds: parsed.source.steps.map((step) => step.id),
    };
  }
  return {
    id,
    engineId: AGENT_TURN_WORKFLOW_ID,
    bar: 'agent',
    stepIds: AGENT_TURN_STEPS.map((step) => step.id),
  };
}

/**
 * Where a session's fixed workflow steps come from (agents.md 5.11, 5.12):
 * a workflow whose steps drive the bar, else the agent's prompt.
 */
export function workflowSourceOf(session: SessionDoc): 'prompt' | 'workflow' {
  return turnWorkflowOf(session).bar === 'steps' ? 'workflow' : 'prompt';
}

/** The Analyse step's outcome from the turn's data records (agents.md 5.11). */
export function analyseOutcomeOf(
  data: readonly ToolDataRecord[],
  stopped: boolean,
): AnalyseOutcome {
  return {
    calls: data.map((record) => ({
      tool: record.tool,
      ...(record.rowCount !== undefined ? { rowCount: record.rowCount } : {}),
      failed: !!record.error,
    })),
    stopped,
  };
}

/** A Wrap up summary, as the v2 turn workflow returns it. */
export function isTurnSummary(value: unknown): value is Record<string, number> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'sqlQueries' in value &&
    'rows' in value
  );
}
