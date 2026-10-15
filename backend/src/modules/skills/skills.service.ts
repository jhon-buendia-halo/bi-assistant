import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { parseLinks } from '../../mastra/agent-links';
import { builtInSkillNames } from '../../mastra/app-skills';
import { UserAgentsService } from '../user-agents/user-agents.service';
import type {
  Skill,
  SkillDoc,
  SkillInput,
  SkillSummary,
} from './entities/skill.entity';
import { SkillsRepository } from './repositories/skills.repository';
import { validateSkill, type SkillFields } from './skill-rules';

/**
 * In-app skills: know-how a user writes and assigns to their agents
 * (R68-R74, ADR-0022). Private to their owner; another user's skill answers
 * as not found because the repository only sees the caller's.
 */
@Injectable()
export class SkillsService {
  constructor(
    private readonly repository: SkillsRepository,
    private readonly userAgents: UserAgentsService,
  ) {}

  /** The caller's skills sorted by name (api.md 94). */
  async list(): Promise<SkillSummary[]> {
    const [docs, usedBy] = await Promise.all([
      this.repository.list(),
      this.agentNamesBySkill(),
    ]);
    return docs
      .map((doc) => summarize(doc, usedBy.get(doc.id)))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }

  async get(id: string): Promise<Skill> {
    const doc = await this.require(id);
    return toSkill(doc, (await this.agentNamesBySkill()).get(id));
  }

  async create(input: SkillInput): Promise<Skill> {
    const fields = await this.validate(input);
    const doc = await this.repository.insert({ id: randomUUID(), ...fields });
    return toSkill(doc, undefined);
  }

  /** Replace the whole skill; its id stays (api.md 97). */
  async save(id: string, input: SkillInput): Promise<Skill> {
    const current = await this.require(id);
    const fields = await this.validate(input, id);
    if (fields.name !== current.name) await this.assertUnlinked(current.name);
    const doc = await this.repository.update(id, fields);
    if (!doc) throw notFound(id);
    return toSkill(doc, (await this.agentNamesBySkill()).get(id));
  }

  /** Delete the skill unless a draft links it (api.md 98, ADR-0024). */
  async delete(id: string): Promise<SkillDoc> {
    const doc = await this.require(id);
    await this.assertUnlinked(doc.name);
    await this.repository.delete(id);
    return doc;
  }

  /** Refuse while a draft's instructions link the skill `name`. */
  private async assertUnlinked(name: string): Promise<void> {
    const agents = await this.userAgents.draftsLinking(name);
    if (agents.length) {
      throw new BadRequestException(
        `"${name}" is linked by ${agents.join(', ')}. Unlink it first.`,
      );
    }
  }

  private async require(id: string): Promise<SkillDoc> {
    const doc = await this.repository.get(id);
    if (!doc) throw notFound(id);
    return doc;
  }

  private async validate(
    input: SkillInput,
    selfId?: string,
  ): Promise<SkillFields> {
    const taken = new Set(
      (await this.repository.list())
        .filter((doc) => doc.id !== selfId)
        .map((doc) => doc.name),
    );
    return validateSkill(input, {
      builtIns: builtInSkillNames(),
      nameTaken: (name) => taken.has(name),
    });
  }

  /** Names of the caller's agents whose draft or Live version names each skill. */
  private async agentNamesBySkill(): Promise<Map<string, Set<string>>> {
    const usedBy = new Map<string, Set<string>>();
    for (const agent of await this.userAgents.list()) {
      const ids = new Set([
        ...(agent.draft.skills ?? []),
        ...(agent.live?.skills ?? []),
      ]);
      for (const id of ids) {
        const names = usedBy.get(id) ?? new Set<string>();
        names.add(agent.draft.name);
        usedBy.set(id, names);
      }
    }
    return usedBy;
  }
}

function notFound(id: string): NotFoundException {
  return new NotFoundException(`Skill "${id}" not found`);
}

function summarize(doc: SkillDoc, agents?: Set<string>): SkillSummary {
  return {
    id: doc.id,
    name: doc.name,
    description: doc.description,
    fileCount: doc.files.length,
    tools: [...parseLinks(doc.body).tools].sort(),
    agents: [...(agents ?? [])].sort((a, b) => a.localeCompare(b)),
    updatedAt: doc.updatedAt ?? doc.createdAt ?? '',
  };
}

function toSkill(doc: SkillDoc, agents?: Set<string>): Skill {
  return {
    ...summarize(doc, agents),
    body: doc.body,
    files: doc.files.map((file) => ({ ...file })),
  };
}
