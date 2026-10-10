import { BadRequestException, Injectable } from '@nestjs/common';
import { MastraService } from '../../mastra/mastra.service';
import { ASSISTANT_EVAL_SETS } from '../../mastra/evals/assistant.evals';
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

/** The registry key of the official agent; every other built-in is `system`. */
const OFFICIAL_AGENT_KEY = 'assistant';

export interface AgentSummary {
  /** Registry key the agent is registered under in the Mastra instance. */
  key: string;
  /** The agent's own id, which may differ from the registry key. */
  id: string;
  name: string;
  description: string;
  /** Tool names the agent can call, sorted alphabetically. A user agent
   * runs on the assistant, so it lists the assistant's. */
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
}

@Injectable()
export class AgentsService {
  constructor(
    private readonly mastra: MastraService,
    private readonly userAgents: UserAgentsService,
  ) {}

  /** Built-in and user agents together, alphabetical by name (R48). */
  async list(): Promise<AgentSummary[]> {
    const registry = this.mastra.listAgents();
    const [pins, docs, datasetNames, assistantTools] = await Promise.all([
      this.userAgents.builtinPins(),
      this.userAgents.list(),
      this.userAgents.datasetNames(),
      this.assistantToolNames(),
    ]);
    const builtins = await Promise.all(
      Object.entries(registry).map(([key, agent]) =>
        this.summarize(key, agent, pins),
      ),
    );
    const users = docs.map((doc) =>
      summarizeUserAgent(doc, assistantTools, datasetNames),
    );
    return [...builtins, ...users].sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Full detail for one agent: a registry key first, then a user-agent id
   * (R49). Null when neither matches.
   */
  async get(key: string): Promise<AgentDetail | null> {
    if (this.isBuiltin(key)) return this.builtinDetail(key);
    const doc = await this.userAgents.get(key);
    if (!doc) return null;

    const assistant = await this.builtinDetail(OFFICIAL_AGENT_KEY);
    const summary = summarizeUserAgent(
      doc,
      assistant?.tools ?? [],
      await this.userAgents.datasetNames(),
    );
    return {
      ...summary,
      draft: doc.draft,
      ...(doc.live ? { live: doc.live } : {}),
      instructions: assistant?.instructions ?? '',
      toolDetails: assistant?.toolDetails ?? [],
      memory: assistant?.memory ?? null,
      model: assistant?.model ?? null,
    };
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
    const [tools, datasetNames] = await Promise.all([
      this.assistantToolNames(),
      this.userAgents.datasetNames(),
    ]);
    return summarizeUserAgent(doc, tools, datasetNames);
  }

  private async assistantToolNames(): Promise<string[]> {
    const assistant = this.mastra.listAgents()[OFFICIAL_AGENT_KEY];
    if (!assistant) return [];
    return Object.keys((await safe(() => assistant.listTools())) ?? {}).sort();
  }

  private async builtinDetail(key: string): Promise<AgentDetail | null> {
    const agent = this.mastra.listAgents()[key];
    if (!agent) return null;

    const [summary, instructions, tools, memory, model] = await Promise.all([
      this.userAgents
        .builtinPins()
        .then((pins) => this.summarize(key, agent, pins)),
      safe(() => agent.getInstructions()),
      safe(() => agent.listTools()),
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
            id: String((model as { modelId?: unknown }).modelId ?? ''),
            provider: String((model as { provider?: unknown }).provider ?? ''),
          }
        : null,
    };
  }

  /** The eval question sets defined for an agent; empty when it has none. */
  evalSets(key: string): AgentEvalSet[] {
    if (key !== 'assistant') return [];
    return ASSISTANT_EVAL_SETS.map((set) => ({
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
    const official = key === OFFICIAL_AGENT_KEY;
    return {
      key,
      id: agent.id ?? key,
      name: agent.name ?? key,
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
    };
  }
}

/** A user agent as a catalogue entry; `key` is its id (R48). */
function summarizeUserAgent(
  doc: UserAgentDoc,
  assistantTools: string[],
  datasetNames: Set<string>,
): AgentSummary {
  const config = effectiveConfig(doc);
  return {
    key: doc.id,
    id: doc.id,
    name: config.name,
    description: config.description,
    tools: [...assistantTools],
    kind: 'user',
    status: doc.live ? 'live' : 'draft',
    pinned: Boolean(doc.pinned),
    owner: 'You',
    hasUnpublishedChanges: hasUnpublishedChanges(doc),
    missingDatasets: missingDatasets(config, datasetNames),
    datasets: [...config.datasets],
    starterQuestions: [...config.starterQuestions],
  };
}

type AgentLike = ReturnType<MastraService['listAgents']>[string];

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
        (tool as { description?: unknown })?.description ?? '',
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
        ? (config.lastMessages as number | false)
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
