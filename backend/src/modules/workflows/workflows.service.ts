import { Injectable, NotFoundException } from '@nestjs/common';
import {
  agentWorkflow,
  type AgentWorkflow,
} from '../../mastra/workflows/agent-workflows';
import {
  agentWorkflowId,
  ASSISTANT_WORKFLOW_DESCRIPTION,
  ASSISTANT_WORKFLOW_ID,
  ASSISTANT_WORKFLOW_NAME,
  CODE_WORKFLOWS,
  oneStepWorkflowSteps,
  wrappedAgentMaxSteps,
  WRAPPED_AGENT_KEYS,
  type CodeWorkflowSource,
  type WorkflowBar,
} from '../../mastra/workflows/workflow-catalog';
import { AgentsService, type AgentSummary } from '../agents/agents.service';
import { runsOnPickedDatasets } from '../agents/builtin-sessions';

/** One workflow a chat can run, as `GET /workflows` lists it (api.md 116). */
export interface WorkflowSummary {
  /** `qti-v2-turn` | `agent:<registry key>` | `agent:<user-agent id>`. */
  id: string;
  name: string;
  description: string;
  /** Defined in code, or the one-step workflow of an agent. */
  kind: 'code' | 'agent';
  /** `You` for a user agent's workflow. */
  owner: 'Official' | 'You';
  /** The agents its steps call, in step order, each once. */
  agents: { key: string; name: string }[];
  stepCount: number;
  bar: WorkflowBar;
  /** The session takes the datasets the user picks. */
  picksDatasets: boolean;
  /** The datasets a session would take; empty when `picksDatasets`. */
  datasets: string[];
  missingDatasets: string[];
  starterQuestions: string[];
  /** Why a chat can't start now; absent when it can. */
  chatRequirement?: string;
}

/** One workflow in detail (api.md 117): an `AgentWorkflow` too. */
export interface WorkflowDetail extends WorkflowSummary {
  steps: AgentWorkflow['steps'];
}

/** A catalogue entry: its summary, and its steps built on request. */
interface CatalogueEntry {
  summary: WorkflowSummary;
  steps(): AgentWorkflow['steps'];
}

/** Why a Live user agent's workflow can't start (sessions-chat R52). */
const NO_DATASETS_REQUIREMENT = "None of this agent's datasets exist";

/**
 * The read-only workflow catalogue (ADR-0040; workflows R1-R3): the
 * code-defined workflows and the one-step workflow of every agent a chat can
 * run that has none of its own, built at read time from the pure catalogue
 * (workflow-catalog.ts) and the agent catalogue. Nothing is stored or
 * registered per workflow.
 */
@Injectable()
export class WorkflowsService {
  constructor(private readonly agents: AgentsService) {}

  /**
   * Every workflow, in catalogue order: the assistant's, the code-defined
   * ones, the other Official agents' by name, then the Live user agents'
   * by name. System agents and draft-only user agents are never listed.
   */
  async list(): Promise<WorkflowSummary[]> {
    return (await this.entries()).map((entry) => entry.summary);
  }

  /** One workflow with its steps; 404 for anything `list` does not hold. */
  async get(id: string): Promise<WorkflowDetail> {
    const entry = (await this.entries()).find(
      (candidate) => candidate.summary.id === id,
    );
    if (!entry) throw new NotFoundException(`Workflow "${id}" not found`);
    return { ...entry.summary, steps: entry.steps() };
  }

  private async entries(): Promise<CatalogueEntry[]> {
    const agents = await this.agents.list();
    const builtins = new Map(
      agents
        .filter((agent) => agent.status === 'builtin')
        .map((agent) => [agent.key, agent]),
    );
    const assistant = builtins.get(WRAPPED_AGENT_KEYS[0]);
    const official = WRAPPED_AGENT_KEYS.slice(1)
      .map((key) => builtins.get(key))
      .filter((agent): agent is AgentSummary => !!agent)
      .map((agent) => oneStepEntry(agent, 'Official'));
    const users = agents
      .filter((agent) => agent.kind === 'user' && agent.status === 'live')
      .map((agent) => oneStepEntry(agent, 'You'));
    return [
      ...(assistant ? [assistantEntry(assistant)] : []),
      ...CODE_WORKFLOWS.flatMap((source) => {
        const agent = builtins.get(source.primaryFor);
        return agent ? [codeEntry(source, agent)] : [];
      }),
      ...byName(official),
      ...byName(users),
    ];
  }
}

function byName(entries: CatalogueEntry[]): CatalogueEntry[] {
  return [...entries].sort((a, b) =>
    a.summary.name.localeCompare(b.summary.name),
  );
}

/** The one step of an agent's one-step workflow. */
function oneStepOf(agent: AgentSummary): () => AgentWorkflow['steps'] {
  return () =>
    oneStepWorkflowSteps({
      name: agent.name,
      tools: agent.tools,
      maxSteps: wrappedAgentMaxSteps(agent.key),
    });
}

/** The assistant's one-step workflow: the picker's name and description. */
function assistantEntry(agent: AgentSummary): CatalogueEntry {
  return {
    summary: {
      id: ASSISTANT_WORKFLOW_ID,
      name: ASSISTANT_WORKFLOW_NAME,
      description: ASSISTANT_WORKFLOW_DESCRIPTION,
      kind: 'agent',
      owner: 'Official',
      agents: [{ key: agent.key, name: agent.name }],
      stepCount: 1,
      bar: 'agent',
      picksDatasets: true,
      datasets: [],
      missingDatasets: [...agent.missingDatasets],
      starterQuestions: [...agent.starterQuestions],
    },
    steps: oneStepOf(agent),
  };
}

/** A code-defined workflow, run for its `primaryFor` agent. */
function codeEntry(
  source: CodeWorkflowSource,
  agent: AgentSummary,
): CatalogueEntry {
  const picksDatasets = runsOnPickedDatasets(source.primaryFor);
  return {
    summary: {
      id: source.id,
      name: source.name,
      description: source.description,
      kind: 'code',
      owner: 'Official',
      agents: [{ key: agent.key, name: agent.name }],
      stepCount: source.steps.length,
      bar: source.bar,
      picksDatasets,
      datasets: picksDatasets ? [] : [...agent.datasets],
      missingDatasets: [...agent.missingDatasets],
      starterQuestions: [...agent.starterQuestions],
      ...(agent.chatRequirement
        ? { chatRequirement: agent.chatRequirement }
        : {}),
    },
    steps: () => agentWorkflow(source.primaryFor)?.steps ?? [],
  };
}

/**
 * The one-step workflow of a built-in agent (its datasets and requirement as
 * its catalogue entry has them) or of a Live user agent (its Live datasets
 * that exist; a requirement when none does).
 */
function oneStepEntry(
  agent: AgentSummary,
  owner: 'Official' | 'You',
): CatalogueEntry {
  const datasets =
    owner === 'You'
      ? agent.datasets.filter((name) => !agent.missingDatasets.includes(name))
      : [...agent.datasets];
  const chatRequirement =
    owner === 'You'
      ? datasets.length
        ? undefined
        : NO_DATASETS_REQUIREMENT
      : agent.chatRequirement;
  return {
    summary: {
      id: agentWorkflowId(agent.key),
      name: agent.name,
      description: agent.description,
      kind: 'agent',
      owner,
      agents: [{ key: agent.key, name: agent.name }],
      stepCount: 1,
      bar: 'agent',
      picksDatasets: false,
      datasets,
      missingDatasets: [...agent.missingDatasets],
      starterQuestions: [...agent.starterQuestions],
      ...(chatRequirement ? { chatRequirement } : {}),
    },
    steps: oneStepOf(agent),
  };
}
