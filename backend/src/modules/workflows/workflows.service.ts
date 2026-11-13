import { Injectable, NotFoundException } from '@nestjs/common';
import {
  agentWorkflow,
  type AgentWorkflow,
  type AgentWorkflowStep,
} from '../../mastra/workflows/agent-workflows';
import {
  CODE_WORKFLOWS,
  workflowAgentKeys,
  type CodeWorkflowSource,
  type WorkflowBar,
  type WorkflowTrigger,
} from '../../mastra/workflows/workflow-catalog';
import type {
  JsonSchema,
  WorkflowEdge,
} from '../../mastra/workflows/workflow-contract';
import {
  inputFieldsWithUsage,
  type WorkflowInputFieldDetail,
} from '../../mastra/workflows/workflow-input';
import {
  AgentsService,
  type AgentSummary,
  type AgentToolDetail,
} from '../agents/agents.service';
import { runsOnPickedDatasets } from '../agents/builtin-sessions';

/** One workflow of the catalogue, as `GET /workflows` lists it (api.md 116). */
export interface WorkflowSummary {
  /** `qti-v2-turn`, the one catalogue workflow since 1.23.35. */
  id: string;
  name: string;
  description: string;
  /**
   * Defined in code. `agent` is only a draft run's own definition (api.md
   * R12), never listed.
   */
  kind: 'code' | 'agent';
  /** `You` only for a draft run's definition. */
  owner: 'Official' | 'You';
  /** The agents its steps call, in step order, each once. */
  agents: { key: string; name: string }[];
  stepCount: number;
  bar: WorkflowBar;
  /** Every workflow runs once on a typed input (`POST /workflows/:id/runs`). */
  trigger: WorkflowTrigger;
  /**
   * The typed input a run takes, in form order (api.md 118, 119): the Start
   * node, each field with its rules and the steps that read it (`usedBy`).
   */
  input: WorkflowInputFieldDetail[];
  /** The datasets the workflow's agent declares; empty when the run picks them. */
  datasets: string[];
  missingDatasets: string[];
  starterQuestions: string[];
}

/** The longest system prompt a workflow detail carries, in characters. */
export const SYSTEM_PROMPT_CAP = 20_000;

/**
 * An agent a workflow's steps call, in detail (api.md 117): the LLM it runs
 * on and its base prompt (api.md 34 `instructions`).
 */
export interface WorkflowAgentDetail {
  key: string;
  name: string;
  /** `<provider>/<model>` of the agent's LLM; null when no LLM is set. */
  model: string | null;
  /** The agent's base prompt, at most `SYSTEM_PROMPT_CAP` characters. */
  systemPrompt: string;
  /** Set when the prompt was longer than the cap and was shortened. */
  systemPromptTruncated?: true;
  /** The agent's tools, as `GET /agents/:key` lists them (api.md 34). */
  toolDetails: AgentToolDetail[];
}

/**
 * A workflow step as the detail shows it (api.md 117): an agent step names
 * its key; a catalogued step carries its declared input and output schema
 * (agents.md 5.12), from which `input` and `output` are derived.
 */
export type WorkflowDetailStep = Omit<AgentWorkflowStep, 'agent'> & {
  agent?: NonNullable<AgentWorkflowStep['agent']> & { key: string };
  inputSchema?: JsonSchema;
  outputSchema?: JsonSchema;
};

/** One workflow in detail (api.md 117): an `AgentWorkflow` too. */
export interface WorkflowDetail extends Omit<WorkflowSummary, 'agents'> {
  /** The agents its steps call, in step order, each once, in detail. */
  agents: WorkflowAgentDetail[];
  steps: WorkflowDetailStep[];
  /**
   * How the steps connect, from `start` to `end` (api.md 117): the flow the
   * canvas draws, with its branches and loops.
   */
  edges: WorkflowEdge[];
  /** The hash of its data contract (12 hex; agents.md 5.12). */
  contractHash: string;
}

/**
 * A workflow as a run needs it: its summary, its steps and, for a
 * catalogued workflow, its contract hash (a draft run's has none).
 */
export interface WorkflowDefinition extends WorkflowSummary {
  steps: AgentWorkflow['steps'];
  /** How the steps connect (117); absent for a draft run's definition. */
  edges?: WorkflowEdge[];
  contractHash?: string;
}

/** A catalogue entry: its summary, its contract hash, its steps built on request. */
interface CatalogueEntry {
  summary: WorkflowSummary;
  contractHash: string;
  steps(): WorkflowDetailStep[];
  edges(): WorkflowEdge[];
}

/**
 * The read-only workflow catalogue (ADR-0040; workflows R1-R3): the
 * code-defined workflows whose agent is registered, built at read time from
 * the pure catalogue (workflow-catalog.ts) and the agent catalogue. Only
 * Questions to Insights v2 (`qti-v2-turn`) since 1.23.35: agents are a
 * library and get no workflow of their own, so an `agent:` id, like the
 * removed `seq-text-demo` and `deep-analysis`, is not found. Nothing is
 * stored or registered per workflow. Runs are `WorkflowRunsService`'s
 * (R11, R14).
 */
@Injectable()
export class WorkflowsService {
  constructor(private readonly agents: AgentsService) {}

  /** Every workflow, in catalogue order. */
  async list(): Promise<WorkflowSummary[]> {
    return (await this.entries()).map((entry) => entry.summary);
  }

  /**
   * One workflow with its steps and the agents they call in detail; 404 for
   * anything `list` does not hold.
   */
  async get(id: string): Promise<WorkflowDetail> {
    const entry = await this.find(id);
    const agents = await Promise.all(
      entry.summary.agents.map((agent) => this.agentDetail(agent)),
    );
    return {
      ...entry.summary,
      agents,
      steps: entry.steps(),
      edges: entry.edges(),
      contractHash: entry.contractHash,
    };
  }

  /**
   * One workflow as a run needs it (api.md 118, 119): its summary and steps,
   * without the agents' models and prompts; 404 as `get`.
   */
  async definition(id: string): Promise<WorkflowDefinition> {
    const entry = await this.find(id);
    return {
      ...entry.summary,
      steps: entry.steps(),
      edges: entry.edges(),
      contractHash: entry.contractHash,
    };
  }

  /**
   * An agent of a workflow in detail (api.md 34 `AgentDetail`): its LLM as
   * `<provider>/<model>` (null when none is set, never the environment's
   * fallback), its prompt, shortened to `SYSTEM_PROMPT_CAP`, and its tools.
   */
  private async agentDetail(agent: {
    key: string;
    name: string;
  }): Promise<WorkflowAgentDetail> {
    const detail = await this.agents.get(agent.key);
    const llm = detail?.llm;
    const prompt = detail?.instructions ?? '';
    return {
      key: agent.key,
      name: agent.name,
      model: llm?.provider && llm.model ? `${llm.provider}/${llm.model}` : null,
      systemPrompt: prompt.slice(0, SYSTEM_PROMPT_CAP),
      ...(prompt.length > SYSTEM_PROMPT_CAP
        ? { systemPromptTruncated: true as const }
        : {}),
      toolDetails: (detail?.toolDetails ?? []).map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputs: [...tool.inputs],
      })),
    };
  }

  private async find(id: string): Promise<CatalogueEntry> {
    const entry = (await this.entries()).find(
      (candidate) => candidate.summary.id === id,
    );
    if (!entry) throw new NotFoundException(`Workflow "${id}" not found`);
    return entry;
  }

  private async entries(): Promise<CatalogueEntry[]> {
    const builtins = new Map(
      (await this.agents.list())
        .filter((agent) => agent.status === 'builtin')
        .map((agent) => [agent.key, agent]),
    );
    return CODE_WORKFLOWS.flatMap((source) => {
      const agent = builtins.get(source.primaryFor);
      return agent ? [codeEntry(source, agent, builtins)] : [];
    });
  }
}

/** A code-defined workflow, run for its `primaryFor` agent. */
function codeEntry(
  source: CodeWorkflowSource,
  agent: AgentSummary,
  builtins: ReadonlyMap<string, AgentSummary>,
): CatalogueEntry {
  const picksDatasets = runsOnPickedDatasets(source.primaryFor);
  return {
    summary: {
      id: source.id,
      name: source.name,
      description: source.description,
      kind: 'code',
      owner: 'Official',
      // Every agent its steps run, by persona name: Michael, Olivia, Jessica.
      agents: workflowAgentKeys(source).flatMap((key) => {
        const used = builtins.get(key);
        return used ? [{ key, name: used.name }] : [];
      }),
      stepCount: source.steps.length,
      bar: source.bar,
      trigger: source.trigger,
      input: inputFieldsWithUsage(source),
      datasets: picksDatasets ? [] : [...agent.datasets],
      missingDatasets: [...agent.missingDatasets],
      starterQuestions: [...agent.starterQuestions],
    },
    contractHash: source.contractHash,
    edges: () => source.edges.map((edge) => ({ ...edge })),
    steps: () =>
      (agentWorkflow(source.primaryFor)?.steps ?? []).map((step) => {
        const declared = source.steps.find((entry) => entry.id === step.id);
        return declared
          ? {
              ...step,
              inputSchema: structuredClone(declared.inputSchema),
              outputSchema: structuredClone(declared.outputSchema),
            }
          : step;
      }),
  };
}
