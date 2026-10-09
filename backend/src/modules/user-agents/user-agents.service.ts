import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { REASONING_EFFORTS, type ReasoningEffort } from '../llm/llm.types';
import { DatasetsRepository } from '../datasets/repositories/datasets.repository';
import {
  AGENT_LIMITS,
  type AgentConfig,
  type UserAgentDoc,
} from './entities/user-agent.entity';
import { BuiltinAgentPinsRepository } from './repositories/builtin-agent-pins.repository';
import { UserAgentsRepository } from './repositories/user-agents.repository';

/** The untyped create / save-draft payload, already coerced to strings. */
export interface AgentConfigInput {
  name?: string;
  description?: string;
  instructions?: string;
  datasets?: string[];
  starterQuestions?: string[];
  model?: string;
  reasoningEffort?: ReasoningEffort;
}

/**
 * User agents: stored configurations of the assistant with a draft and an
 * optional Live version (R43-R52, ADR-0008). Knows nothing about the built-in
 * registry; `AgentsService` refuses built-in keys before calling in here.
 */
@Injectable()
export class UserAgentsService {
  constructor(
    private readonly repository: UserAgentsRepository,
    private readonly pins: BuiltinAgentPinsRepository,
    private readonly datasets: DatasetsRepository,
  ) {}

  list(): Promise<UserAgentDoc[]> {
    return this.repository.list();
  }

  get(id: string): Promise<UserAgentDoc | null> {
    return this.repository.get(id);
  }

  async create(input: AgentConfigInput): Promise<UserAgentDoc> {
    const draft = normalizeAgentConfig(input);
    await this.assertNameAvailable(draft.name);
    return this.repository.insert({ id: randomUUID(), draft, pinned: false });
  }

  /** Replace the whole draft; the Live version is untouched (R44). */
  async saveDraft(id: string, input: AgentConfigInput): Promise<UserAgentDoc> {
    await this.require(id);
    const draft = normalizeAgentConfig(input);
    await this.assertNameAvailable(draft.name, id);
    return this.patch(id, { draft });
  }

  /** Copy the draft to the Live version (R44, R45). */
  async publish(id: string): Promise<UserAgentDoc> {
    const doc = await this.require(id);
    if (!doc.draft.name)
      throw new BadRequestException('Agent name is required');
    if (!doc.draft.datasets.length) {
      throw new BadRequestException('Select at least one dataset to publish');
    }
    return this.patch(id, {
      live: { ...doc.draft },
      publishedAt: new Date().toISOString(),
    });
  }

  /** Remove the definition only; sessions keep their transcript (R50). */
  async delete(id: string): Promise<UserAgentDoc> {
    const doc = await this.require(id);
    await this.repository.delete(id);
    return doc;
  }

  async setPinned(id: string, pinned: boolean): Promise<UserAgentDoc> {
    await this.require(id);
    return this.patch(id, { pinned });
  }

  /** Registry keys of the pinned built-in agents (R47). */
  builtinPins(): Promise<string[]> {
    return this.pins.get();
  }

  async setBuiltinPin(key: string, pinned: boolean): Promise<string[]> {
    const current = await this.pins.get();
    if (pinned === current.includes(key)) return current;
    return this.pins.save(
      pinned ? [...current, key] : current.filter((k) => k !== key),
    );
  }

  /** Names of the datasets that exist, for `missingDatasets` (R48). */
  async datasetNames(): Promise<Set<string>> {
    return new Set((await this.datasets.list()).map((d) => d.name));
  }

  private async require(id: string): Promise<UserAgentDoc> {
    const doc = await this.repository.get(id);
    if (!doc) throw new NotFoundException(`Agent "${id}" not found`);
    return doc;
  }

  private async patch(
    id: string,
    patch: Partial<UserAgentDoc>,
  ): Promise<UserAgentDoc> {
    const updated = await this.repository.update(id, patch);
    if (!updated) throw new NotFoundException(`Agent "${id}" not found`);
    return updated;
  }

  /** Names are unique among user agents, ignoring case (R43, R45). */
  private async assertNameAvailable(name: string, selfId?: string) {
    if (!name) throw new BadRequestException('Agent name is required');
    const wanted = name.toLowerCase();
    const taken = (await this.repository.list()).some(
      (doc) =>
        doc.id !== selfId &&
        [doc.draft?.name, doc.live?.name].some(
          (other) => other?.toLowerCase() === wanted,
        ),
    );
    if (taken) {
      throw new BadRequestException(`An agent named "${name}" already exists`);
    }
  }
}

/** Trim, clip and de-duplicate a payload into an `AgentConfig` (R43). */
export function normalizeAgentConfig(input: AgentConfigInput): AgentConfig {
  const config: AgentConfig = {
    name: clip(input.name, AGENT_LIMITS.name),
    description: clip(input.description, AGENT_LIMITS.description),
    instructions: clip(input.instructions, AGENT_LIMITS.instructions),
    datasets: uniqueNonBlank(input.datasets),
    starterQuestions: uniqueNonBlank(
      input.starterQuestions,
      AGENT_LIMITS.starterQuestion,
    ).slice(0, AGENT_LIMITS.starterQuestions),
  };
  const model = clip(input.model, Number.POSITIVE_INFINITY);
  if (model) config.model = model;
  if (
    input.reasoningEffort &&
    REASONING_EFFORTS.includes(input.reasoningEffort)
  ) {
    config.reasoningEffort = input.reasoningEffort;
  }
  return config;
}

/** The configuration a user agent runs with: Live when published, else draft. */
export function effectiveConfig(
  doc: Pick<UserAgentDoc, 'draft' | 'live'>,
): AgentConfig {
  return doc.live ?? doc.draft;
}

/** Live and its draft differ (R44). Derived, never stored. */
export function hasUnpublishedChanges(
  doc: Pick<UserAgentDoc, 'draft' | 'live'>,
): boolean {
  return Boolean(doc.live) && !sameConfig(doc.draft, doc.live!);
}

/** Dataset names in `config` that are not among `existing` (R48). */
export function missingDatasets(
  config: AgentConfig,
  existing: Set<string>,
): string[] {
  return config.datasets.filter((name) => !existing.has(name));
}

function sameConfig(a: AgentConfig, b: AgentConfig): boolean {
  return (
    a.name === b.name &&
    a.description === b.description &&
    a.instructions === b.instructions &&
    sameList(a.datasets, b.datasets) &&
    sameList(a.starterQuestions, b.starterQuestions) &&
    (a.model ?? '') === (b.model ?? '') &&
    (a.reasoningEffort ?? '') === (b.reasoningEffort ?? '')
  );
}

function sameList(a: string[] = [], b: string[] = []): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

function clip(value: unknown, limit: number): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, limit).trim();
}

function uniqueNonBlank(
  values: unknown,
  limit = Number.POSITIVE_INFINITY,
): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  for (const value of values) {
    const text = clip(value, limit);
    if (text) seen.add(text);
  }
  return [...seen];
}
