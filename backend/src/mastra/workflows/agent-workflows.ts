/**
 * The code-defined workflow of each workflow-backed agent, as the agent
 * detail returns it (`workflow`, api.md 34; agents-evals R108). Built from
 * the workflow's step catalogue and the agent's catalogue, never written
 * twice. Plain data, no framework import, so the agents service and Jest
 * can read it without loading Mastra.
 */
import {
  ASSISTANT_V2_AGENT_KEY,
  ASSISTANT_V2_MAX_STEPS,
  ASSISTANT_V2_NAME,
  ASSISTANT_V2_TOOL_NAMES,
} from '../agents/assistant-v2-catalog';
import {
  QTI_V2_TURN_STEPS,
  QTI_V2_TURN_WORKFLOW_ID,
  type WorkflowStepEntry,
  type WorkflowStepExit,
} from './qti-v2-turn.steps';

export interface AgentWorkflowStep {
  id: string;
  title: string;
  kind: 'code' | 'agent';
  summary: string;
  input: string[];
  output: string[];
  /** The agent step only: the agent it runs. */
  agent?: { name: string; tools: string[]; maxSteps: number };
  exits: WorkflowStepExit[];
}

export interface AgentWorkflow {
  id: string;
  steps: AgentWorkflowStep[];
}

interface WorkflowSource {
  id: string;
  steps: readonly WorkflowStepEntry[];
  agent: { name: string; tools: readonly string[]; maxSteps: number };
}

/** The workflow-backed agents, by registry key (today only v2, ADR-0034). */
const WORKFLOWS: Record<string, WorkflowSource> = {
  [ASSISTANT_V2_AGENT_KEY]: {
    id: QTI_V2_TURN_WORKFLOW_ID,
    steps: QTI_V2_TURN_STEPS,
    agent: {
      name: ASSISTANT_V2_NAME,
      tools: ASSISTANT_V2_TOOL_NAMES,
      maxSteps: ASSISTANT_V2_MAX_STEPS,
    },
  },
};

/** The agent's workflow, or undefined when it is not workflow-backed. */
export function agentWorkflow(agentKey: string): AgentWorkflow | undefined {
  const source = Object.prototype.hasOwnProperty.call(WORKFLOWS, agentKey)
    ? WORKFLOWS[agentKey]
    : undefined;
  if (!source) return undefined;
  return {
    id: source.id,
    steps: source.steps.map((step) => ({
      id: step.id,
      title: step.title,
      kind: step.kind,
      summary: step.summary,
      input: [...step.input],
      output: [...step.output],
      ...(step.kind === 'agent'
        ? {
            agent: {
              name: source.agent.name,
              tools: [...source.agent.tools],
              maxSteps: source.agent.maxSteps,
            },
          }
        : {}),
      exits: step.exits.map((exit) => ({ ...exit })),
    })),
  };
}
