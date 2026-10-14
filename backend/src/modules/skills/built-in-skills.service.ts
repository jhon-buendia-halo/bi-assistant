import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import {
  type ShippedBuiltIn,
  builtInHash,
  shippedBuiltIn,
  shippedSkills,
} from '../../mastra/app-skills';
import { parseLinks } from '../../mastra/agent-links';
import { setSkillOverrides } from '../../mastra/skill-overrides';
import { CurrentUserService } from '../auth/current-user.service';
import { validateOverride } from './built-in-skill-rules';
import type {
  BuiltInSkill,
  BuiltInSkillInput,
  BuiltInSkillSummary,
  SkillOverrideDoc,
} from './entities/skill-override.entity';
import { SkillOverridesRepository } from './repositories/skill-overrides.repository';

/**
 * Built-in skills edited in the app (R75-R80, ADR-0023): an org-wide
 * override per skill, stored in `skill_overrides`. The current overrides are
 * mirrored into the `skill-overrides` bridge, which the loader reads per
 * call, so a save or reset applies to the next call.
 */
@Injectable()
export class BuiltInSkillsService implements OnModuleInit {
  constructor(
    private readonly repository: SkillOverridesRepository,
    private readonly users: CurrentUserService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.refresh();
  }

  /** The built-in skills, sorted by name (api.md 99). */
  async list(): Promise<BuiltInSkillSummary[]> {
    const overrides = new Map(
      (await this.repository.list()).map((doc) => [doc.name, doc]),
    );
    return [...shippedSkills().keys()]
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
      .map((name) => this.summary(name, overrides.get(name)));
  }

  /** One built-in skill, as served and as shipped (api.md 100). */
  async get(name: string): Promise<BuiltInSkill> {
    this.requireBuiltIn(name);
    return this.full(name, await this.repository.get(name));
  }

  /** Save the override of `name`; it applies to the next call (api.md 101). */
  async save(name: string, input: BuiltInSkillInput): Promise<BuiltInSkill> {
    const shipped = this.requireBuiltIn(name);
    const fields = validateOverride(input, shipped);
    const doc = await this.repository.save({
      name,
      ...fields,
      baseHash: builtInHash(shipped),
      updatedBy: this.users.current()?.id ?? 'local',
    });
    await this.refresh();
    return this.full(name, doc);
  }

  /** Delete the override of `name`, if any (api.md 102). */
  async reset(name: string): Promise<void> {
    this.requireBuiltIn(name);
    await this.repository.delete(name);
    await this.refresh();
  }

  /** Reload every override into the bridge the loader reads. */
  private async refresh(): Promise<void> {
    setSkillOverrides(await this.repository.list());
  }

  private requireBuiltIn(name: string): ShippedBuiltIn {
    const shipped = shippedBuiltIn(name);
    if (!shipped) {
      throw new NotFoundException(`Unknown built-in skill "${name}"`);
    }
    return shipped;
  }

  private summary(
    name: string,
    override: SkillOverrideDoc | null | undefined,
  ): BuiltInSkillSummary {
    const bundled = shippedSkills().get(name);
    const shipped = shippedBuiltIn(name) as ShippedBuiltIn;
    // The tools the served body links, for an Official agent's Graph tab.
    const tools = parseLinks(override?.body ?? shipped.body).tools;
    return {
      name,
      description: override?.description ?? shipped.description,
      loading: bundled?.loading ?? 'on-demand',
      agents: [...(bundled?.agents ?? [])],
      ...(tools.length ? { tools } : {}),
      modified: !!override,
      builtInChanged: !!override && override.baseHash !== builtInHash(shipped),
      updatedAt: override?.updatedAt ?? null,
    };
  }

  private full(name: string, override: SkillOverrideDoc | null): BuiltInSkill {
    const shipped = shippedBuiltIn(name) as ShippedBuiltIn;
    return {
      ...this.summary(name, override),
      body: override?.body ?? shipped.body,
      files: (override?.files ?? shipped.files).map((file) => ({ ...file })),
      builtIn: {
        description: shipped.description,
        body: shipped.body,
        files: shipped.files.map((file) => ({ ...file })),
      },
    };
  }
}
