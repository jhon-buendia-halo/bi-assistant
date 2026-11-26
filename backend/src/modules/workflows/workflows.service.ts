import { Injectable, NotFoundException } from '@nestjs/common';
import {
  codeWorkflowView,
  type AgentWorkflow,
  type AgentWorkflowStep,
} from '../../mastra/workflows/agent-workflows';
import {
  CODE_WORKFLOWS,
  CONVERSATION_WORKFLOWS,
  workflowAgentKeys,
  workflowCategory,
  type CodeWorkflowSource,
  type WorkflowBar,
  type WorkflowCategory,
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
import { resolveAgentModelConfig } from '../../mastra/model-resolver';
import {
  servesClaude,
  TEAM_STEP_MODEL,
  type StepModel,
} from '../../mastra/step-model';
import {
  ORCHESTRATED_MICHAEL_WORKFLOW_ID,
  ORCHESTRATOR_MODEL,
} from '../../mastra/workflows/orchestrated-answer-michael.steps';
import { conversationalBindingOf } from '../../mastra/conversational-agents';

/** One workflow of the catalogue, as `GET /workflows` lists it (api.md 116). */
export interface WorkflowSummary {
  /** The catalogue id (`orchestrated-answer-michael`, `consumption-gap-analysis`, …). */
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
  /** The Workflows section it is listed under (workflows R5). */
  category: WorkflowCategory;
  /** The agents its steps call, in step order, each once, with their role (job title; `''` without one). */
  agents: { key: string; name: string; role: string }[];
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
  /**
   * Set on a conversational binding's workflow (plan Elena 1.2): its runs are
   * the messages of one conversation.
   */
  conversational?: true;
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
  /** The persona's role (job title), as the agents list gives it; `''` without one. */
  role: string;
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
 * the pure catalogue (workflow-catalog.ts) and the agent catalogue. Agents
 * are a library and get no workflow of their own, so an `agent:` id, like a
 * removed workflow's (`seq-text-demo`, `answer-business-question`), is not
 * found. Nothing is
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
    const steps = entry.steps();
    // An agent this workflow only calls without tools (a model-only step:
    // Plan, Write answer, Check data quality) shows none of its tools here.
    const toolless = (key: string) =>
      steps
        .filter((step) => step.agent?.key === key)
        .every((step) => step.agent?.tools.length === 0);
    // Avery + Michael's agents run on the team's model when the saved one
    // is a Claude model (agents.md 1.3): the canvas shows that one.
    const stepModel = await this.stepModelOf(entry.summary.id);
    const agents = await Promise.all(
      entry.summary.agents.map((agent) =>
        this.agentDetail(agent, toolless(agent.key), stepModel),
      ),
    );
    return {
      ...entry.summary,
      agents,
      steps,
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
   * The model a workflow runs its step agents on (agents.md 1.3): the
   * team's (`TEAM_STEP_MODEL`) for Answer a Business Question (Avery +
   * Michael) and Opus 5.5 high for Elena's conversation (plan Elena 2.5)
   * when the saved model is served as a Claude model; otherwise none (every
   * agent on the saved model). Never throws.
   */
  private async stepModelOf(id: string): Promise<StepModel | undefined> {
    const binding = conversationalBindingOf(id);
    if (!binding) return undefined;
    try {
      if (!servesClaude(await resolveAgentModelConfig())) return undefined;
      return binding.workflowId === ORCHESTRATED_MICHAEL_WORKFLOW_ID
        ? TEAM_STEP_MODEL
        : { ...ORCHESTRATOR_MODEL };
    } catch {
      return undefined;
    }
  }

  /**
   * An agent of a workflow in detail (api.md 34 `AgentDetail`): its LLM as
   * `<provider>/<model>` (null when none is set, never the environment's
   * fallback), its prompt, shortened to `SYSTEM_PROMPT_CAP`, and its tools.
   */
  private async agentDetail(
    agent: {
      key: string;
      name: string;
      role: string;
    },
    toolless = false,
    stepModel?: StepModel,
  ): Promise<WorkflowAgentDetail> {
    const detail = await this.agents.get(agent.key);
    const llm = detail?.llm;
    const prompt = detail?.instructions ?? '';
    // The workflow's own model replaces the saved name on the same provider.
    const model = stepModel?.model ?? llm?.model;
    return {
      key: agent.key,
      name: agent.name,
      role: agent.role,
      model: llm?.provider && model ? `${llm.provider}/${model}` : null,
      systemPrompt: prompt.slice(0, SYSTEM_PROMPT_CAP),
      ...(prompt.length > SYSTEM_PROMPT_CAP
        ? { systemPromptTruncated: true as const }
        : {}),
      toolDetails: (toolless ? [] : (detail?.toolDetails ?? [])).map(
        (tool) => ({
          name: tool.name,
          description: tool.description,
          inputs: [...tool.inputs],
        }),
      ),
    };
  }

  /**
   * A catalogue workflow, or a built-in agent's conversation (plan Elena
   * 1.1: `agent:insights-lead`, never listed); 404 for anything else.
   */
  private async find(id: string): Promise<CatalogueEntry> {
    const entry = (await this.entries(CONVERSATION_WORKFLOWS)).find(
      (candidate) => candidate.summary.id === id,
    );
    if (!entry) throw new NotFoundException(`Workflow "${id}" not found`);
    return entry;
  }

  /** The catalogue's entries, then `extra` (conversations) when given. */
  private async entries(
    extra: readonly CodeWorkflowSource[] = [],
  ): Promise<CatalogueEntry[]> {
    const builtins = new Map(
      (await this.agents.list())
        .filter((agent) => agent.status === 'builtin')
        .map((agent) => [agent.key, agent]),
    );
    return [...CODE_WORKFLOWS, ...extra].flatMap((source) => {
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
  // A conversation runs over the datasets its first message picks.
  const picksDatasets =
    runsOnPickedDatasets(source.primaryFor) ||
    conversationalBindingOf(source.id) !== undefined;
  return {
    summary: {
      id: source.id,
      name: source.name,
      description: source.description,
      kind: 'code',
      owner: 'Official',
      category: workflowCategory(source.category),
      // Every agent its steps run, by persona name: Michael, Olivia, Jessica.
      agents: workflowAgentKeys(source).flatMap((key) => {
        const used = builtins.get(key);
        return used ? [{ key, name: used.name, role: used.role }] : [];
      }),
      stepCount: source.steps.length,
      bar: source.bar,
      trigger: source.trigger,
      input: inputFieldsWithUsage(source),
      datasets: picksDatasets ? [] : [...agent.datasets],
      missingDatasets: [...agent.missingDatasets],
      starterQuestions: [...agent.starterQuestions],
      // Its runs are the messages of one conversation (plan Elena 1.2).
      ...(conversationalBindingOf(source.id)
        ? { conversational: true as const }
        : {}),
    },
    contractHash: source.contractHash,
    edges: () => source.edges.map((edge) => ({ ...edge })),
    steps: () =>
      (codeWorkflowView(source)?.steps ?? []).map((step) => {
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
