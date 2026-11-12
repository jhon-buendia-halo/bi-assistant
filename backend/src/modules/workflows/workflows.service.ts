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
  ONE_STEP_WORKFLOW_TRIGGER,
  oneStepWorkflowInput,
  oneStepWorkflowSteps,
  wrappedAgentMaxSteps,
  WRAPPED_AGENT_KEYS,
  type CodeWorkflowSource,
  type WorkflowBar,
  type WorkflowInputField,
  type WorkflowTrigger,
} from '../../mastra/workflows/workflow-catalog';
import { AgentsService, type AgentSummary } from '../agents/agents.service';
import { runsOnPickedDatasets } from '../agents/builtin-sessions';

/** One workflow of the catalogue, as `GET /workflows` lists it (api.md 116). */
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
  /** Every workflow runs once on a typed input (`POST /workflows/:id/runs`). */
  trigger: WorkflowTrigger;
  /**
   * The typed input a run takes, in form order (api.md 118, 119). The agent
   * workflows have one while they are still chat workflows (plan 5.2).
   */
  input: WorkflowInputField[];
  /** The datasets the workflow's agent declares; empty when the run picks them. */
  datasets: string[];
  missingDatasets: string[];
  starterQuestions: string[];
  /** Why a run can't start now; absent when it can (plan 4.2). */
  runRequirement?: string;
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
 * registered per workflow. Runs are `WorkflowRunsService`'s (R11, R14).
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
    const entry = await this.find(id);
    return { ...entry.summary, steps: entry.steps() };
  }

  private async find(id: string): Promise<CatalogueEntry> {
    const entry = (await this.entries()).find(
      (candidate) => candidate.summary.id === id,
    );
    if (!entry) throw new NotFoundException(`Workflow "${id}" not found`);
    return entry;
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
        if (source.calls) {
          const agent = builtins.get(source.calls);
          return agent ? [callingRunEntry(source, agent)] : [];
        }
        if (!source.primaryFor) return [runEntry(source)];
        const agent = builtins.get(source.primaryFor);
        return agent ? [codeEntry(source, source.primaryFor, agent)] : [];
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
      trigger: ONE_STEP_WORKFLOW_TRIGGER,
      input: oneStepWorkflowInput(agent.key),
      datasets: [],
      missingDatasets: [...agent.missingDatasets],
      starterQuestions: [...agent.starterQuestions],
    },
    steps: oneStepOf(agent),
  };
}

/** Why a run can't start now (plan 4.2), absent when it can. */
function requirements(
  text: string | undefined,
): Pick<WorkflowSummary, 'runRequirement'> {
  return text ? { runRequirement: text } : {};
}

/** The fields of a code workflow's input, copied. */
function inputOf(source: CodeWorkflowSource): WorkflowInputField[] {
  return (source.input ?? []).map((field) => ({ ...field }));
}

/** A code-defined workflow, run for its `primaryFor` agent. */
function codeEntry(
  source: CodeWorkflowSource,
  primaryFor: string,
  agent: AgentSummary,
): CatalogueEntry {
  const picksDatasets = runsOnPickedDatasets(primaryFor);
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
      trigger: source.trigger,
      input: inputOf(source),
      datasets: picksDatasets ? [] : [...agent.datasets],
      missingDatasets: [...agent.missingDatasets],
      starterQuestions: [...agent.starterQuestions],
      ...requirements(agent.chatRequirement),
    },
    steps: () => agentWorkflow(primaryFor)?.steps ?? [],
  };
}

/**
 * A code-defined workflow that calls no agent (a run workflow such as
 * `seq-text-demo`): its code steps, no datasets and no requirement.
 */
function runEntry(source: CodeWorkflowSource): CatalogueEntry {
  return {
    summary: {
      id: source.id,
      name: source.name,
      description: source.description,
      kind: 'code',
      owner: 'Official',
      agents: [],
      stepCount: source.steps.length,
      bar: source.bar,
      trigger: source.trigger,
      input: inputOf(source),
      datasets: [],
      missingDatasets: [],
      starterQuestions: [],
    },
    steps: () =>
      source.steps.map((step) => ({
        id: step.id,
        title: step.title,
        kind: step.kind,
        summary: step.summary,
        input: [...step.input],
        output: [...step.output],
        exits: step.exits.map((exit) => ({ ...exit })),
      })),
  };
}

/**
 * A run workflow whose agent steps call a built-in agent that keeps its own
 * workflow (deep analysis calls the assistant, plan 1.25.3): over the
 * datasets the run picks, with the agent's requirement; each agent step runs
 * the agent with its tools, or none for a tool-free call, and its budget.
 */
function callingRunEntry(
  source: CodeWorkflowSource,
  agent: AgentSummary,
): CatalogueEntry {
  const base = runEntry(source);
  return {
    summary: {
      ...base.summary,
      agents: [{ key: agent.key, name: agent.name }],
      missingDatasets: [...agent.missingDatasets],
      ...requirements(agent.chatRequirement),
    },
    steps: () =>
      base.steps().map((step, index) => {
        const call = source.steps[index]?.agentCall;
        return step.kind === 'agent' && call
          ? {
              ...step,
              agent: {
                name: agent.name,
                tools: call.tools ? [...agent.tools] : [],
                maxSteps: call.maxSteps,
              },
            }
          : step;
      }),
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
      trigger: ONE_STEP_WORKFLOW_TRIGGER,
      input: oneStepWorkflowInput(agent.key),
      datasets,
      missingDatasets: [...agent.missingDatasets],
      starterQuestions: [...agent.starterQuestions],
      ...requirements(chatRequirement),
    },
    steps: oneStepOf(agent),
  };
}
