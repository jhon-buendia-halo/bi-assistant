import { Inject, Injectable } from '@nestjs/common';
import { SKILL_OVERRIDES_STORE } from '../../../infrastructure/database/doc-store';
import type { DocStore } from '../../../infrastructure/database/doc-store';
import type { SkillOverrideDoc } from '../entities/skill-override.entity';

/**
 * Overrides of built-in skills (the `skill_overrides` collection), by the
 * built-in's name. Shared: every user sees the same documents (data-model
 * 3.15), so this injects the raw store.
 */
@Injectable()
export class SkillOverridesRepository {
  constructor(
    @Inject(SKILL_OVERRIDES_STORE)
    private readonly store: DocStore<SkillOverrideDoc>,
  ) {}

  list(): Promise<SkillOverrideDoc[]> {
    return this.store.find({}, { sort: { name: 1 } });
  }

  get(name: string): Promise<SkillOverrideDoc | null> {
    return this.store.findOne({ name });
  }

  save(doc: SkillOverrideDoc): Promise<SkillOverrideDoc | null> {
    return this.store.update({ name: doc.name }, doc, { upsert: true });
  }

  delete(name: string): Promise<number> {
    return this.store.deleteOne({ name });
  }
}
