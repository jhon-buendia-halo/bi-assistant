/**
 * The code-defined workflow of each workflow-backed agent, as the agent
 * detail returns it (`workflow`, api.md 34; agents-evals R108). Built from
 * the workflow's step catalogue and the agent's catalogue, never written
 * twice. Plain data, no framework import, so the agents service and Jest
 * can read it without loading Mastra.
 */
import {
  INSIGHTS_LEAD_AGENT_KEY,
  INSIGHTS_LEAD_MAX_STEPS,
  INSIGHTS_LEAD_TOOL_NAMES,
} from '../agents/insights-lead-catalog';
import {
  INSIGHTS_ANALYST_AGENT_KEY,
  INSIGHTS_ANALYST_MAX_STEPS,
  INSIGHTS_ANALYST_NAME,
  INSIGHTS_ANALYST_TOOL_NAMES,
} from '../agents/insights-analyst-catalog';
import { builtinAgentPersona } from '../agent-personas';
import { CHIEF_OF_STAFF_AGENT_KEY } from '../agent-constants';
import {
  AVERY_TEAM,
  ORCHESTRATOR_MAX_STEPS,
} from './orchestrated-answer-michael.steps';
import type { WorkflowStepExit } from './workflow-contract';
import { CODE_WORKFLOWS, stepAgentKey } from './workflow-catalog';

export interface AgentWorkflowStep {
  id: string;
  title: string;
  kind: 'code' | 'agent';
  summary: string;
  input: string[];
  output: string[];
  /**
   * The agent step only: the agent it runs, by its registry key and its
   * persona's name and job title (agents.md 1.1), its tools and its step
   * limit.
   */
  agent?: {
    key: string;
    name: string;
    role: string;
    tools: string[];
    maxSteps: number;
    /**
     * An orchestrator's team (Avery, agents.md 2.21): each of its tools that
     * calls another agent, with that agent's key, persona name and job title.
     */
    team?: AgentWorkflowTeamMember[];
  };
  exits: WorkflowStepExit[];
}

/** One tool of an orchestrator and the agent behind it (api.md 117). */
export interface AgentWorkflowTeamMember {
  tool: string;
  key: string;
  name: string;
  role: string;
}

export interface AgentWorkflow {
  id: string;
  steps: AgentWorkflowStep[];
}

/** The agent each code workflow's agent step runs, by its registry key. */
const STEP_AGENTS: Record<
  string,
  {
    name: string;
    tools: readonly string[];
    maxSteps: number;
    team?: readonly { tool: string; agent: string }[];
  }
> = {
  // Avery's Orchestrate step (agents.md 2.21, 5.23): her own tools, the
  // team's each calling an agent of her team.
  [CHIEF_OF_STAFF_AGENT_KEY]: {
    name: 'Avery',
    tools: AVERY_TEAM.tools,
    maxSteps: ORCHESTRATOR_MAX_STEPS,
    team: AVERY_TEAM.team,
  },
  // Elena's Answer step (plan Elena 2.3): her own tools, alone.
  [INSIGHTS_LEAD_AGENT_KEY]: {
    name: 'Elena',
    tools: INSIGHTS_LEAD_TOOL_NAMES,
    maxSteps: INSIGHTS_LEAD_MAX_STEPS,
  },
  [INSIGHTS_ANALYST_AGENT_KEY]: {
    name: INSIGHTS_ANALYST_NAME,
    tools: INSIGHTS_ANALYST_TOOL_NAMES,
    maxSteps: INSIGHTS_ANALYST_MAX_STEPS,
  },
};

/**
 * The agent's workflow, or undefined when it is not workflow-backed: the
 * code workflow whose `primaryFor` it is (workflow-catalog.ts, ADR-0040).
 */
export function agentWorkflow(agentKey: string): AgentWorkflow | undefined {
  const workflow = CODE_WORKFLOWS.find((w) => w.primaryFor === agentKey);
  return workflow ? codeWorkflowView(workflow) : undefined;
}

/**
 * One code workflow's steps as api.md 34 and 117 show them, whichever
 * agent it is primary for; undefined when its agent has no step catalogue.
 */
export function codeWorkflowView(
  workflow: (typeof CODE_WORKFLOWS)[number],
): AgentWorkflow | undefined {
  const agent = Object.hasOwn(STEP_AGENTS, workflow.primaryFor)
    ? STEP_AGENTS[workflow.primaryFor]
    : undefined;
  if (!agent) return undefined;
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
            agent: stepAgent(stepAgentKey(workflow, step.id), source.agent),
          }
        : {}),
      exits: step.exits.map((exit) => ({ ...exit })),
    })),
  };
}

/**
 * An agent step's agent: its key, its persona, its tools and step limit.
 * A step agent with a catalogue entry of its own (Avery) shows its own tools;
 * any other shows the workflow's primary agent's.
 */
function stepAgent(
  key: string,
  primary: { name: string; tools: readonly string[]; maxSteps: number },
): NonNullable<AgentWorkflowStep['agent']> {
  const persona = builtinAgentPersona(key);
  const own: (typeof STEP_AGENTS)[string] = Object.hasOwn(STEP_AGENTS, key)
    ? STEP_AGENTS[key]
    : primary;
  return {
    key,
    name: persona?.name ?? own.name,
    role: persona?.role ?? '',
    tools: [...own.tools],
    maxSteps: own.maxSteps,
    ...(own.team
      ? {
          team: own.team.map((member) => {
            const teammate = builtinAgentPersona(member.agent);
            return {
              tool: member.tool,
              key: member.agent,
              name: teammate?.name ?? member.agent,
              role: teammate?.role ?? '',
            };
          }),
        }
      : {}),
  };
}
