import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  agentSkillFile,
  agentSkillsView,
  type AgentSkillsView,
} from '../../mastra/app-skills';
import { RequestContext } from '@mastra/core/request-context';
import {
  renderSkillDocument,
  type AgentSkill,
} from '../../mastra/agent-skills';
import { toSkillCopy, type SkillDoc } from '../skills/entities/skill.entity';
import { MastraService } from '../../mastra/mastra.service';
import {
  AGENT_TOOLS_CONTEXT_KEY,
  isFullSelection,
} from '../../mastra/agent-tools';
import {
  ALWAYS_ON_TOOLS,
  effectiveOptionalTools,
  LIBRARY_TOOLS,
  optionalToolOf,
  parseLinks,
} from '../../mastra/agent-links';
import {
  effortLevelsForProvider,
  nearestEffort,
} from '../../mastra/effort-levels';
import { LlmService } from '../llm/llm.service';
import { AgentPromptsService } from './agent-prompts.service';
import type { AgentPromptView } from './entities/agent-prompt-override.entity';
import { evalSetsFor } from '../../mastra/evals/eval-sets';
import {
  effectiveConfig,
  hasUnpublishedChanges,
  missingDatasets,
  UserAgentsService,
  type AgentConfigInput,
} from '../user-agents/user-agents.service';
import type {
  AgentConfig,
  AgentKind,
  AgentOwner,
  AgentStatus,
  UserAgentDoc,
} from '../user-agents/entities/user-agent.entity';

import { OFFICIAL_AGENT_KEYS } from '../../mastra/agent-constants';
import { INSIGHTS_LEAD_AGENT_KEY } from '../../mastra/agents/insights-lead-catalog';
import { CONVERSATION_GATES_CONTEXT_KEY } from '../../mastra/workflows/conversation-turn.steps';
import { CONVERSATIONAL_BINDINGS } from '../../mastra/conversational-agents';
import {
  DEFAULT_AGENT_DOMAIN,
  builtinAgentPersona,
  type AgentDomain,
} from '../../mastra/agent-personas';
import {
  agentWorkflow,
  type AgentWorkflow,
} from '../../mastra/workflows/agent-workflows';
import { workflowsUsingAgent } from '../../mastra/workflows/workflow-catalog';

/**
 * The conversation a built-in agent is talked to in on her own (plan Elena
 * 1.2): its solo binding's id (`agent:insights-lead`); undefined for every
 * other agent, Avery included (her conversation is her workflow's).
 */
function conversationOf(key: string): { workflowId: string } | undefined {
  const binding = CONVERSATIONAL_BINDINGS.find(
    (entry) => entry.kind === 'solo' && entry.agentKey === key,
  );
  return binding ? { workflowId: binding.workflowId } : undefined;
}

/** The built-in agent every user agent runs on: Elena (ADR-0059). */
const USER_AGENT_HOST_KEY = INSIGHTS_LEAD_AGENT_KEY;

export interface AgentSummary {
  /** Registry key the agent is registered under in the Mastra instance. */
  key: string;
  /** The agent's own id, which may differ from the registry key. */
  id: string;
  /** The persona's human name: a built-in's from its persona, a user
   * agent's as its owner typed it (api.md 33). */
  name: string;
  /** The persona's job title; empty when a user agent has none. */
  role: string;
  /** A built-in persona's first-person intro (agents.md 1.1); '' for a
   * user agent, whose card shows its description instead. */
  intro: string;
  /** The specialty the hub groups the agent under (agents.md 1.2): a
   * built-in's from its persona, a user agent's as chosen, else `general`. */
  domain: AgentDomain;
  description: string;
  /** Tool names the agent can call, sorted alphabetically. A user agent
   * runs on Elena, so it lists her tools its effective configuration
   * selects (ADR-0022, ADR-0059). */
  tools: string[];
  kind: AgentKind;
  status: AgentStatus;
  pinned: boolean;
  owner: AgentOwner;
  /** A Live user agent whose draft differs from its Live version. */
  hasUnpublishedChanges: boolean;
  /** Dataset names in the effective configuration that no longer exist. */
  missingDatasets: string[];
  /** Effective configuration (Live, else draft); empty for built-ins. */
  datasets: string[];
  starterQuestions: string[];
  /**
   * The catalogue workflows whose steps call this agent (api.md 33-34):
   * Avery + Michael for `insights-analyst` and `chief-of-staff`, none for a user agent.
   * The hub reads it to say when an agent is busy in a run.
   */
  usedInWorkflows: { id: string; name: string }[];
}

export interface AgentToolDetail {
  name: string;
  description: string;
  /** Top-level input parameter names, when the tool declares an object schema. */
  inputs: string[];
}

export interface AgentMemoryDetail {
  /** Storage adapter backing the agent's memory threads. */
  storage: string | null;
  /** Recent messages replayed into each turn; false when disabled. */
  lastMessages: number | false | null;
  semanticRecall: boolean;
  workingMemory: boolean;
  generateTitle: boolean;
}

export interface AgentEvalCheck {
  /** Scorer id, e.g. "check-includes". */
  id: string;
  name: string;
  /** What the scorer asserts, e.g. 'Checks if output includes "Argentina"'. */
  description: string;
}

export interface AgentEvalCase {
  id: string;
  question: string;
  /** What the question probes for. */
  intent: string;
  checks: AgentEvalCheck[];
}

/** A named group of eval questions sharing one fixture. */
export interface AgentEvalSet {
  id: string;
  name: string;
  /** What the set covers and what it needs to run. */
  description: string;
  cases: AgentEvalCase[];
}

/** One library tool of a user agent and how it reaches the agent (api.md 34). */
export interface AgentToolLink {
  name: string;
  status: 'always-on' | 'linked' | 'not-linked';
  linkedVia: { instructions: boolean; skills: string[] };
}

/** The LLM an agent runs on; never carries the key (api.md 34). */
export interface AgentLlmDetail {
  provider: string | null;
  providerName: string | null;
  model: string | null;
  apiKeyConfigured: boolean;
  maxOutputTokens: number | null;
  reasoningEffort: string | null;
}

const PROVIDER_NAMES: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  lenai: 'LenAI',
  custom: 'Custom endpoint',
  copilot: 'GitHub Copilot',
};

export interface AgentDetail extends AgentSummary {
  /** User agents only. */
  draft?: AgentConfig;
  live?: AgentConfig;
  /** The agent's prompt template, flattened to text. */
  instructions: string;
  toolDetails: AgentToolDetail[];
  /** Null when the agent has no memory configured. */
  memory: AgentMemoryDetail | null;
  /** Null when no LLM settings are saved, since the model resolves lazily. */
  model: { id: string; provider: string } | null;
  /** User agents only: every library tool and how it is linked. */
  toolLinks?: AgentToolLink[];
  /** The LLM settings the agent runs on, an agent's overrides applied. */
  llm: AgentLlmDetail;
  /** Built-in agents only: the editable system prompt (api.md 34, ADR-0026). */
  prompt?: AgentPromptView;
  /** Workflow-backed built-in agents only: their turn's steps (api.md 34). */
  workflow?: AgentWorkflow;
  /**
   * Built-in conversational agents only (`insights-lead`): the binding id a
   * conversation with them runs on (plan Elena 1.2).
   */
  conversation?: { workflowId: string };
}

@Injectable()
export class AgentsService {
  constructor(
    private readonly mastra: MastraService,
    private readonly userAgents: UserAgentsService,
    private readonly llm?: LlmService,
    private readonly prompts?: AgentPromptsService,
  ) {}

  /** Built-in and user agents together, alphabetical by name (R48). */
  async list(): Promise<AgentSummary[]> {
    const registry = this.mastra.listAgents();
    const [pins, docs, datasetNames] = await Promise.all([
      this.userAgents.builtinPins(),
      this.userAgents.list(),
      this.userAgents.datasetNames(),
    ]);
    const builtins = await Promise.all(
      Object.entries(registry).map(([key, agent]) =>
        this.summarize(key, agent, pins),
      ),
    );
    const skillsById = await this.userAgents.skillsById();
    const users = await Promise.all(
      docs.map(async (doc) =>
        summarizeUserAgent(
          doc,
          await this.hostToolNames(doc),
          datasetNames,
          skillsById,
        ),
      ),
    );
    return [...builtins, ...users].sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Full detail for one agent: a registry key first, then a user-agent id
   * (R49). Null when neither matches.
   */
  async get(key: string): Promise<AgentDetail | null> {
    if (this.isBuiltin(key)) {
      const detail = await this.builtinDetail(key);
      if (!detail) return null;
      const prompt = await this.prompts?.view(key);
      // A workflow-backed agent's turn, for its Graph tab (R108).
      const workflow = agentWorkflow(key);
      const conversation = conversationOf(key);
      return {
        ...detail,
        llm: await this.llmDetail(),
        ...(prompt ? { prompt } : {}),
        ...(workflow ? { workflow } : {}),
        ...(conversation ? { conversation } : {}),
      };
    }
    const doc = await this.userAgents.get(key);
    if (!doc) return null;

    // Elena as this agent's tool selection gives her (R49, ADR-0059).
    const skills = await this.callSkills(doc);
    const host = await this.builtinDetail(
      USER_AGENT_HOST_KEY,
      toolSelectionContext(doc, skills),
    );
    const summary = summarizeUserAgent(
      doc,
      await this.hostToolNames(doc),
      await this.userAgents.datasetNames(),
      await this.userAgents.skillsById(),
    );
    return {
      ...summary,
      draft: doc.draft,
      ...(doc.live ? { live: doc.live } : {}),
      instructions: host?.instructions ?? '',
      toolDetails: host?.toolDetails ?? [],
      memory: host?.memory ?? null,
      model: host?.model ?? null,
      toolLinks: toolLinks(doc, skills),
      llm: await this.llmDetail(effectiveConfig(doc)),
    };
  }

  /**
   * The settings an agent's turns run on (api.md 34): the saved provider,
   * model and key state, with the agent's model and effort overrides; the
   * effort is moved onto the model's own levels as a call does. The
   * conversation's agent sets no output cap, so `maxOutputTokens` is null.
   */
  private async llmDetail(config?: AgentConfig): Promise<AgentLlmDetail> {
    const view = await safe(() => this.llm?.getView());
    if (!view?.provider || !view.model) {
      return {
        provider: null,
        providerName: null,
        model: null,
        apiKeyConfigured: false,
        maxOutputTokens: null,
        reasoningEffort: null,
      };
    }
    const model = config?.model || view.model;
    const wanted = config?.reasoningEffort ?? view.reasoningEffort;
    const levels = effortLevelsForProvider(view.provider, model);
    return {
      provider: view.provider,
      providerName: PROVIDER_NAMES[view.provider] ?? view.provider,
      model,
      apiKeyConfigured: view.configured,
      maxOutputTokens: null,
      reasoningEffort: levels.length ? nearestEffort(levels, wanted) : null,
    };
  }

  /**
   * The in-app skills a user agent's calls carry: its Live copies, else the
   * current skills its draft names (agents.md 4.2).
   */
  private callSkills(doc: UserAgentDoc): Promise<AgentSkill[]> {
    return this.inAppSkillsOf(doc);
  }

  /**
   * The skills an agent gets, resolved at startup (agents.md 7.3, api.md
   * 34a). A user agent runs on Elena, so it shows hers (ADR-0059).
   */
  async skills(key: string): Promise<AgentSkillsView> {
    const view = agentSkillsView(await this.skillsAgent(key));
    if (this.isBuiltin(key)) return view;
    // A user agent's own skills follow Elena's (api.md 34a).
    const own = await this.inAppSkills(key);
    return {
      ...view,
      skills: [
        ...view.skills,
        ...own.map((skill) => ({
          name: skill.name,
          description: skill.description,
          level: 'in-app' as const,
          loading: 'on-demand' as const,
          files: inAppFiles(skill).map(({ path, content }) => ({
            path,
            size: Buffer.byteLength(content),
          })),
        })),
      ],
    };
  }

  /**
   * A user agent's in-app skills as its sessions see them: the copies its
   * Live version runs on, else the current skills its draft names, sorted by
   * name (api.md 34a). Empty for a built-in agent or an unknown id.
   */
  private async inAppSkills(key: string): Promise<AgentSkill[]> {
    const doc = await this.userAgents.get(key);
    return doc ? this.inAppSkillsOf(doc) : [];
  }

  private async inAppSkillsOf(doc: UserAgentDoc): Promise<AgentSkill[]> {
    const skills = doc.live
      ? (doc.liveSkills ?? [])
      : (await this.userAgents.skillsFor(doc.draft.skills)).map(toSkillCopy);
    return [...skills].sort((a, b) => (a.name < b.name ? -1 : 1));
  }

  /** One file of one of an agent's skills (api.md 34b). */
  async skillFile(
    key: string,
    name: string,
    path: string,
  ): Promise<{ path: string; size: number; content: string | null }> {
    const agent = await this.skillsAgent(key);
    const own = this.isBuiltin(key)
      ? undefined
      : (await this.inAppSkills(key)).find((skill) => skill.name === name);
    if (own) {
      const file = inAppFiles(own).find((entry) => entry.path === path);
      if (!file) {
        throw new NotFoundException(`Skill "${name}" has no file "${path}"`);
      }
      return {
        path: file.path,
        size: Buffer.byteLength(file.content),
        content: file.content,
      };
    }
    const result = agentSkillFile(agent, name, path ?? '');
    if (!('error' in result)) return result;
    if (result.error === 'no-skill') {
      throw new NotFoundException(`Agent "${key}" has no skill "${name}"`);
    }
    if (result.error === 'invalid-path') {
      throw new BadRequestException(`Invalid skill file path "${path ?? ''}"`);
    }
    throw new NotFoundException(`Skill "${name}" has no file "${path}"`);
  }

  /** The registry key whose skills `key` shows; 404 when it names no agent. */
  private async skillsAgent(key: string): Promise<string> {
    if (this.isBuiltin(key)) return key;
    if (await this.userAgents.get(key)) return USER_AGENT_HOST_KEY;
    throw new NotFoundException(`Agent "${key}" not found`);
  }

  async create(input: AgentConfigInput): Promise<AgentSummary> {
    return this.userSummary(await this.userAgents.create(input));
  }

  async saveDraft(id: string, input: AgentConfigInput): Promise<AgentSummary> {
    this.refuseBuiltin(id, "Built-in agents can't be edited");
    return this.userSummary(await this.userAgents.saveDraft(id, input));
  }

  async publish(id: string): Promise<AgentSummary> {
    this.refuseBuiltin(id, "Built-in agents can't be edited");
    return this.userSummary(await this.userAgents.publish(id));
  }

  async delete(id: string): Promise<AgentSummary> {
    this.refuseBuiltin(id, "Built-in agents can't be deleted");
    return this.userSummary(await this.userAgents.delete(id));
  }

  /** Pin any agent: built-ins in the settings document, user agents on theirs. */
  async setPinned(key: string, pinned: boolean): Promise<AgentSummary> {
    if (this.isBuiltin(key)) {
      const pins = await this.userAgents.setBuiltinPin(key, pinned);
      return this.summarize(key, this.mastra.listAgents()[key], pins);
    }
    return this.userSummary(await this.userAgents.setPinned(key, pinned));
  }

  private isBuiltin(key: string): boolean {
    return Object.hasOwn(this.mastra.listAgents(), key);
  }

  private refuseBuiltin(key: string, message: string): void {
    if (this.isBuiltin(key)) throw new BadRequestException(message);
  }

  private async userSummary(doc: UserAgentDoc): Promise<AgentSummary> {
    const [tools, datasetNames, skillsById] = await Promise.all([
      this.hostToolNames(doc),
      this.userAgents.datasetNames(),
      this.userAgents.skillsById(),
    ]);
    return summarizeUserAgent(doc, tools, datasetNames, skillsById);
  }

  /** Elena's tools that a user agent's effective config selects. */
  private async hostToolNames(doc: UserAgentDoc): Promise<string[]> {
    const host = this.mastra.listAgents()[USER_AGENT_HOST_KEY];
    if (!host) return [];
    const requestContext = toolSelectionContext(
      doc,
      await this.callSkills(doc),
    );
    return Object.keys(
      (await safe(() => host.listTools({ requestContext }))) ?? {},
    ).sort();
  }

  /**
   * A built-in agent's detail; `requestContext` (a user agent's tool
   * selection) shapes Elena's prompt and tools.
   */
  private async builtinDetail(
    key: string,
    requestContext?: RequestContext,
  ): Promise<Omit<AgentDetail, 'llm'> | null> {
    const agent = this.mastra.listAgents()[key];
    if (!agent) return null;

    const [summary, instructions, tools, memory, model] = await Promise.all([
      this.userAgents
        .builtinPins()
        .then((pins) => this.summarize(key, agent, pins)),
      safe(() => agent.getInstructions({ requestContext })),
      safe(() => agent.listTools({ requestContext })),
      safe(() => agent.getMemory()),
      safe(() => agent.getModel()),
    ]);

    return {
      ...summary,
      instructions: flattenInstructions(instructions),
      toolDetails: describeTools(tools),
      memory: describeMemory(memory),
      model: model
        ? {
            id: String((model as { modelId?: string }).modelId ?? ''),
            provider: String((model as { provider?: string }).provider ?? ''),
          }
        : null,
    };
  }

  /** The eval question sets defined for an agent; empty when it has none. */
  evalSets(key: string): AgentEvalSet[] {
    // A set's agent is its `agentKey` (agents.md 8.1).
    return evalSetsFor(key).map((set) => ({
      id: set.id,
      name: set.name,
      description: set.description,
      cases: set.cases.map((evalCase) => ({
        id: evalCase.id,
        question: evalCase.question,
        intent: evalCase.intent,
        checks: evalCase.scorers.map((scorer) => ({
          id: String(scorer.id ?? ''),
          name: String(scorer.name ?? ''),
          description: String(scorer.description ?? ''),
        })),
      })),
    }));
  }

  private async summarize(
    key: string,
    agent: AgentLike,
    pins: string[],
  ): Promise<AgentSummary> {
    const official = OFFICIAL_AGENT_KEYS.includes(key);
    const persona = builtinAgentPersona(key);
    return {
      key,
      id: agent.id ?? key,
      name: persona?.name ?? agent.name ?? key,
      role: persona?.role ?? '',
      intro: persona?.intro ?? '',
      domain: persona?.domain ?? DEFAULT_AGENT_DOMAIN,
      description: (await safe(() => agent.getDescription())) ?? '',
      tools: Object.keys((await safe(() => agent.listTools())) ?? {}).sort(),
      kind: official ? 'official' : 'system',
      status: 'builtin',
      pinned: pins.includes(key),
      owner: official ? 'Official' : 'System',
      hasUnpublishedChanges: false,
      missingDatasets: [],
      datasets: [],
      starterQuestions: [],
      usedInWorkflows: workflowsUsingAgent(key),
    };
  }
}

/** A user agent as a catalogue entry; `key` is its id (R48). */
function summarizeUserAgent(
  doc: UserAgentDoc,
  hostTools: string[],
  datasetNames: Set<string>,
  skillsById?: ReadonlyMap<string, SkillDoc>,
): AgentSummary {
  const config = effectiveConfig(doc);
  return {
    key: doc.id,
    id: doc.id,
    name: config.name,
    role: config.role ?? '',
    intro: '',
    domain: config.domain ?? DEFAULT_AGENT_DOMAIN,
    description: config.description,
    tools: [...hostTools],
    kind: 'user',
    status: doc.live ? 'live' : 'draft',
    pinned: Boolean(doc.pinned),
    owner: 'You',
    hasUnpublishedChanges: hasUnpublishedChanges(doc, skillsById),
    missingDatasets: missingDatasets(config, datasetNames),
    datasets: [...config.datasets],
    starterQuestions: [...config.starterQuestions],
    // A user agent is a library entry: no workflow runs it (1.23.35).
    usedInWorkflows: [],
  };
}

/** `SKILL.md` as rendered (agents.md 7.3), then the reference files. */
function inAppFiles(skill: AgentSkill): { path: string; content: string }[] {
  return [
    { path: 'SKILL.md', content: renderSkillDocument(skill) },
    ...skill.files,
  ];
}

type AgentLike = ReturnType<MastraService['listAgents']>[string];

/**
 * A requestContext carrying a user agent's tool selection from its effective
 * configuration (Live, else draft), the way its Try it gets it (agents.md
 * 2.23, 4.2): none when the agent keeps every tool, and Elena's dashboard
 * and export gates closed, as they always are for a user agent.
 */
function toolSelectionContext(
  doc: UserAgentDoc,
  skills: readonly AgentSkill[],
): RequestContext {
  const requestContext = new RequestContext();
  requestContext.set(CONVERSATION_GATES_CONTEXT_KEY, {
    dashboard: false,
    export: false,
  });
  const direct = effectiveConfig(doc).tools;
  if (direct) {
    const tools = effectiveOptionalTools(direct, skills);
    if (!isFullSelection(tools)) {
      requestContext.set(AGENT_TOOLS_CONTEXT_KEY, tools);
    }
  }
  return requestContext;
}

/**
 * Every library tool of a user agent with its status and where the link
 * comes from, for the Tools and Graph tabs: the Live version, else the
 * draft. A tool the effective selection gives without a link (a config
 * saved before ADR-0024) shows as `linked` with no source.
 */
function toolLinks(
  doc: UserAgentDoc,
  skills: readonly AgentSkill[],
): AgentToolLink[] {
  const config = effectiveConfig(doc);
  const fromInstructions = parseLinks(config.instructions).tools;
  const fromSkills = skills.map((skill) => ({
    name: skill.name,
    tools: parseLinks(skill.body).tools,
  }));
  const selected = new Set<string>(
    effectiveOptionalTools(config.tools, skills),
  );
  // Linking one tool of a pair (create_visual / update_visual) links both.
  const sameGroup = (a: string, b: string) =>
    a === b || (!!optionalToolOf(a) && optionalToolOf(a) === optionalToolOf(b));
  return [...LIBRARY_TOOLS]
    .sort((a, b) => a.localeCompare(b))
    .map((name) => {
      const instructions = fromInstructions.some((t) => sameGroup(t, name));
      const via = fromSkills
        .filter((skill) => skill.tools.some((t) => sameGroup(t, name)))
        .map((skill) => skill.name)
        .sort((a, b) => a.localeCompare(b));
      const optional = optionalToolOf(name);
      const status: AgentToolLink['status'] = ALWAYS_ON_TOOLS.includes(name)
        ? 'always-on'
        : optional && selected.has(optional)
          ? 'linked'
          : 'not-linked';
      return {
        name,
        status,
        linkedVia: {
          instructions: ALWAYS_ON_TOOLS.includes(name)
            ? fromInstructions.includes(name)
            : instructions,
          skills: ALWAYS_ON_TOOLS.includes(name)
            ? fromSkills
                .filter((skill) => skill.tools.includes(name))
                .map((skill) => skill.name)
                .sort((a, b) => a.localeCompare(b))
            : via,
        },
      };
    });
}

/** Agent accessors may be dynamic and throw without a request context. */
async function safe<T>(read: () => T | Promise<T>): Promise<T | undefined> {
  try {
    return await read();
  } catch {
    return undefined;
  }
}

/** Instructions are a string, an array of lines, or message objects. */
function flattenInstructions(instructions: unknown): string {
  if (typeof instructions === 'string') return instructions;
  if (Array.isArray(instructions)) {
    return instructions.map((part) => flattenInstructions(part)).join('\n');
  }
  if (instructions && typeof instructions === 'object') {
    const content = (instructions as { content?: unknown }).content;
    if (content !== undefined) return flattenInstructions(content);
    const text = (instructions as { text?: unknown }).text;
    if (typeof text === 'string') return text;
  }
  return '';
}

function describeTools(tools: unknown): AgentToolDetail[] {
  if (!tools || typeof tools !== 'object') return [];
  return Object.entries(tools as Record<string, unknown>)
    .map(([name, tool]) => ({
      name,
      description: String(
        (tool as { description?: string })?.description ?? '',
      ),
      inputs: schemaKeys((tool as { inputSchema?: unknown })?.inputSchema),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Read the top-level keys of a Zod object schema without depending on Zod. */
function schemaKeys(schema: unknown): string[] {
  const shape = (schema as { shape?: unknown })?.shape;
  if (shape && typeof shape === 'object') return Object.keys(shape);
  const def = (schema as { _def?: { shape?: unknown } })?._def?.shape;
  if (typeof def === 'function') {
    try {
      return Object.keys((def as () => object)());
    } catch {
      return [];
    }
  }
  if (def && typeof def === 'object') return Object.keys(def);
  return [];
}

function describeMemory(memory: unknown): AgentMemoryDetail | null {
  if (!memory) return null;
  const config =
    (safeSync(() =>
      (
        memory as { getMergedThreadConfig?: () => unknown }
      ).getMergedThreadConfig?.(),
    ) as Record<string, unknown> | undefined) ?? {};
  const storage = (memory as { storage?: unknown }).storage;
  const storageName = storage?.constructor?.name || '';
  return {
    storage: storageName || null,
    lastMessages:
      typeof config.lastMessages === 'number' || config.lastMessages === false
        ? config.lastMessages
        : null,
    semanticRecall: Boolean(config.semanticRecall),
    workingMemory: Boolean(
      (config.workingMemory as { enabled?: unknown } | undefined)?.enabled,
    ),
    generateTitle: Boolean(config.generateTitle),
  };
}

function safeSync<T>(read: () => T): T | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}
