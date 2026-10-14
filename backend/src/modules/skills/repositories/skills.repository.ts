import { Inject, Injectable } from '@nestjs/common';
import { OWNED_SKILLS_STORE } from '../../../infrastructure/database/doc-store';
import type { DocStore } from '../../../infrastructure/database/doc-store';
import type { SkillDoc } from '../entities/skill.entity';

/**
 * In-app skills (the `skills` collection), by name. Owner-scoped: each user
 * sees only their own (data-model 3.15).
 */
@Injectable()
export class SkillsRepository {
  constructor(
    @Inject(OWNED_SKILLS_STORE) private readonly store: DocStore<SkillDoc>,
  ) {}

  list(): Promise<SkillDoc[]> {
    return this.store.find({}, { sort: { name: 1 } });
  }

  get(id: string): Promise<SkillDoc | null> {
    return this.store.findOne({ id });
  }

  insert(doc: SkillDoc): Promise<SkillDoc> {
    return this.store.insert(doc);
  }

  update(id: string, patch: Partial<SkillDoc>): Promise<SkillDoc | null> {
    return this.store.update({ id }, patch);
  }

  delete(id: string): Promise<number> {
    return this.store.deleteOne({ id });
  }
}
