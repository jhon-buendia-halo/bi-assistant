import { Injectable } from '@nestjs/common';
import { MastraService } from '../../mastra/mastra.service';
import { ASSISTANT_EVAL_CASES } from '../../mastra/evals/assistant.evals';

export interface AgentSummary {
  /** Registry key the agent is registered under in the Mastra instance. */
  key: string;
  /** The agent's own id, which may differ from the registry key. */
  id: string;
  name: string;
  description: string;
  /** Tool names the agent can call, sorted alphabetically. */
  tools: string[];
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

export interface AgentDetail extends AgentSummary {
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
  constructor(private readonly mastra: MastraService) {}

  /** Every agent registered on the Mastra instance, alphabetical by name. */
  async list(): Promise<AgentSummary[]> {
    const registry = this.mastra.listAgents();
    const summaries = await Promise.all(
      Object.entries(registry).map(([key, agent]) => this.summarize(key, agent)),
    );
    return summaries.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Full detail for one agent, or null when the key is not registered. */
  async get(key: string): Promise<AgentDetail | null> {
    const agent = this.mastra.listAgents()[key];
    if (!agent) return null;

    const [summary, instructions, tools, memory, model] = await Promise.all([
      this.summarize(key, agent),
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

  /** The eval questions defined for an agent; empty when it has none. */
  evals(key: string): AgentEvalCase[] {
    if (key !== 'assistant') return [];
    return ASSISTANT_EVAL_CASES.map((evalCase) => ({
      id: evalCase.id,
      question: evalCase.question,
      intent: evalCase.intent,
      checks: evalCase.scorers.map((scorer) => ({
        id: String(scorer.id ?? ''),
        name: String(scorer.name ?? ''),
        description: String(scorer.description ?? ''),
      })),
    }));
  }

  private async summarize(key: string, agent: AgentLike): Promise<AgentSummary> {
    return {
      key,
      id: agent.id ?? key,
      name: agent.name ?? key,
      description: (await safe(() => agent.getDescription())) ?? '',
      tools: Object.keys((await safe(() => agent.listTools())) ?? {}).sort(),
    };
  }
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
