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
import type { WorkflowStepExit } from './qti-v2-turn.steps';
import { CODE_WORKFLOWS } from './workflow-catalog';

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

/** The agent each code workflow's agent step runs, by its registry key. */
const STEP_AGENTS: Record<
  string,
  { name: string; tools: readonly string[]; maxSteps: number }
> = {
  [ASSISTANT_V2_AGENT_KEY]: {
    name: ASSISTANT_V2_NAME,
    tools: ASSISTANT_V2_TOOL_NAMES,
    maxSteps: ASSISTANT_V2_MAX_STEPS,
  },
};

/**
 * The agent's workflow, or undefined when it is not workflow-backed: the
 * code workflow whose `primaryFor` it is (workflow-catalog.ts, ADR-0040).
 */
export function agentWorkflow(agentKey: string): AgentWorkflow | undefined {
  const workflow = CODE_WORKFLOWS.find((w) => w.primaryFor === agentKey);
  const agent =
    workflow && Object.hasOwn(STEP_AGENTS, agentKey)
      ? STEP_AGENTS[agentKey]
      : undefined;
  if (!workflow || !agent) return undefined;
  const source = { id: workflow.id, steps: workflow.steps, agent };
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
