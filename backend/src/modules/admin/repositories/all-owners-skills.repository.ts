import { Inject, Injectable } from '@nestjs/common';
import { SKILLS_STORE } from '../../../infrastructure/database/doc-store';
import type { DocStore } from '../../../infrastructure/database/doc-store';
import type { SkillDoc } from '../../skills/entities/skill.entity';

/**
 * In-app skills across owners, for the agent transfer only (api.md 86,
 * data-model 3.10): the new owner gets copies of the skills the agent's
 * draft names. Like `AllOwnersAgentsRepository`, deliberately the raw store
 * and reachable only from a `manage-users` route.
 */
@Injectable()
export class AllOwnersSkillsRepository {
  constructor(
    @Inject(SKILLS_STORE) private readonly store: DocStore<SkillDoc>,
  ) {}

  /** One skill of a given owner; null when missing or owned by another. */
  async ofOwner(id: string, ownerId: string): Promise<SkillDoc | null> {
    const doc = await this.store.findOne({ id });
    return doc?.ownerId === ownerId ? doc : null;
  }

  /** Every skill of one owner. */
  allOf(ownerId: string): Promise<SkillDoc[]> {
    return this.store.find({ ownerId });
  }

  insert(doc: SkillDoc): Promise<SkillDoc> {
    return this.store.insert(doc);
  }
}
