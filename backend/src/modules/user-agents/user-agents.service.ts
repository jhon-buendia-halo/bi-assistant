import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  OPTIONAL_AGENT_TOOLS,
  type OptionalAgentTool,
} from '../../mastra/agent-tools';
import {
  isLibraryTool,
  optionalToolsOf,
  parseLinks,
} from '../../mastra/agent-links';
import { REASONING_EFFORTS, type ReasoningEffort } from '../llm/llm.types';
import { builtInOnDemandSkillNames } from '../../mastra/app-skills';
import { SkillsRepository } from '../skills/repositories/skills.repository';
import {
  SKILL_LIMITS,
  sameSkillContent,
  toSkillCopy,
  type SkillCopy,
  type SkillDoc,
} from '../skills/entities/skill.entity';
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
  /** Ignored: derived from the instructions' links (ADR-0024). */
  tools?: string[];
  /** Ignored: derived from the instructions' links (ADR-0024). */
  skills?: string[];
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
    private readonly skills: SkillsRepository,
  ) {}

  list(): Promise<UserAgentDoc[]> {
    return this.repository.list();
  }

  get(id: string): Promise<UserAgentDoc | null> {
    return this.repository.get(id);
  }

  async create(input: AgentConfigInput): Promise<UserAgentDoc> {
    const parsed = normalizeAgentConfig(input);
    await this.assertNameAvailable(parsed.name);
    const draft = await this.withLinks(parsed);
    return this.repository.insert({ id: randomUUID(), draft, pinned: false });
  }

  /** Replace the whole draft; the Live version is untouched (R44). */
  async saveDraft(id: string, input: AgentConfigInput): Promise<UserAgentDoc> {
    await this.require(id);
    const parsed = normalizeAgentConfig(input);
    await this.assertNameAvailable(parsed.name, id);
    const draft = await this.withLinks(parsed);
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
    // The skills the draft names are copied as they are now; a Live agent
    // runs on these copies until it is published again (R44, ADR-0022).
    const copies = (await this.skillsFor(doc.draft.skills)).map(toSkillCopy);
    const live: AgentConfig = { ...doc.draft };
    if (doc.draft.skills) live.skills = copies.map((copy) => copy.id);
    return this.patch(id, {
      live,
      ...(copies.length || doc.liveSkills ? { liveSkills: copies } : {}),
      publishedAt: new Date().toISOString(),
    });
  }

  /**
   * The caller's skills with these ids, in the order given; an id with no
   * skill (deleted) is skipped. A preview runs on these (R60).
   */
  async skillsFor(ids: readonly string[] | undefined): Promise<SkillDoc[]> {
    if (!ids?.length) return [];
    const found = await Promise.all(ids.map((id) => this.skills.get(id)));
    return found.filter((doc): doc is SkillDoc => !!doc);
  }

  /** Every skill of the caller by id, to tell which changed since a publish. */
  async skillsById(): Promise<Map<string, SkillDoc>> {
    return new Map((await this.skills.list()).map((doc) => [doc.id, doc]));
  }

  /**
   * Names of the caller's agents whose draft instructions link the skill
   * `name`, sorted; a skill they link cannot be deleted or renamed
   * (ADR-0024). Live copies are not checked: they keep running.
   */
  async draftsLinking(name: string): Promise<string[]> {
    return (await this.repository.list())
      .filter((doc) => parseLinks(doc.draft.instructions).skills.includes(name))
      .map((doc) => doc.draft.name)
      .sort((a, b) => a.localeCompare(b));
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

  /**
   * Derive `skills` and `tools` from the instructions' links (ADR-0024): the
   * skills are the caller's in-app skills the links name, the tools the
   * optional ones linked directly. Refuses an unknown skill, more than 10
   * skills, then an unknown tool, by name.
   */
  private async withLinks(config: AgentConfig): Promise<AgentConfig> {
    const links = parseLinks(config.instructions);
    const owned = new Map(
      (await this.skills.list()).map((doc) => [doc.name, doc.id]),
    );
    const ids: string[] = [];
    const builtIn = builtInOnDemandSkillNames();
    for (const name of links.skills) {
      // A built-in on-demand skill is a mention: every agent has it.
      if (builtIn.includes(name)) continue;
      const id = owned.get(name);
      if (!id) throw new BadRequestException(`Unknown skill "${name}"`);
      ids.push(id);
    }
    if (ids.length > SKILL_LIMITS.perAgent) {
      throw new BadRequestException(
        `An agent can have at most ${SKILL_LIMITS.perAgent} skills`,
      );
    }
    const unknownTool = links.tools.find((name) => !isLibraryTool(name));
    if (unknownTool !== undefined) {
      throw new BadRequestException(`Unknown tool "${unknownTool}"`);
    }
    return { ...config, tools: optionalToolsOf(links.tools), skills: ids };
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

/**
 * Live and its draft differ, or a skill the draft names changed since its
 * copy was taken (R44). Derived, never stored. `current` is the owner's
 * skills by id; without it only the configurations are compared.
 */
export function hasUnpublishedChanges(
  doc: Pick<UserAgentDoc, 'draft' | 'live' | 'liveSkills'>,
  current?: ReadonlyMap<string, SkillDoc>,
): boolean {
  if (!doc.live) return false;
  if (!sameConfig(doc.draft, doc.live)) return true;
  return skillsChanged(doc.draft.skills ?? [], doc.liveSkills ?? [], current);
}

/** A named skill with no copy, or whose current content differs from it. */
function skillsChanged(
  ids: readonly string[],
  copies: readonly SkillCopy[],
  current?: ReadonlyMap<string, SkillDoc>,
): boolean {
  return ids.some((id) => {
    const copy = copies.find((entry) => entry.id === id);
    if (!copy) return true;
    const now = current?.get(id);
    return !!now && !sameSkillContent(copy, now);
  });
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
    (a.reasoningEffort ?? '') === (b.reasoningEffort ?? '') &&
    sameList(selectedTools(a), selectedTools(b)) &&
    sameList(a.skills, b.skills)
  );
}

/** A config's tool selection, absent read as every tool (data-model 3.10). */
export function selectedTools(config: AgentConfig): OptionalAgentTool[] {
  return config.tools ? [...config.tools] : [...OPTIONAL_AGENT_TOOLS];
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
