import { Inject, Injectable } from '@nestjs/common';
import {
  PERSONAS_STORE,
  SETTINGS_STORE,
} from '../../../infrastructure/database/doc-store';
import type { DocStore } from '../../../infrastructure/database/doc-store';
import type { UserPersona } from '../entities/user-persona.entity';
import { PERSONAS_SEED_KEY } from '../demo-persona';

/** The `settings` document that marks the default personas as seeded. */
interface PersonasSeedDoc {
  key: string;
  seededAt: string;
}

/** User personas, keyed by id. Name ordering and uniqueness live in the service. */
@Injectable()
export class PersonasRepository {
  constructor(
    @Inject(PERSONAS_STORE)
    private readonly store: DocStore<UserPersona>,
    @Inject(SETTINGS_STORE)
    private readonly settings: DocStore<PersonasSeedDoc>,
  ) {}

  /** Whether the default personas were already seeded into this data dir. */
  async isSeeded(): Promise<boolean> {
    return (await this.settings.findOne({ key: PERSONAS_SEED_KEY })) !== null;
  }

  /** Records that the default personas were seeded (data-model 3.9a). */
  async markSeeded(): Promise<void> {
    const doc = { key: PERSONAS_SEED_KEY, seededAt: new Date().toISOString() };
    await this.settings.update({ key: PERSONAS_SEED_KEY }, doc, {
      upsert: true,
    });
  }

  list(): Promise<UserPersona[]> {
    return this.store.find({});
  }

  get(id: string): Promise<UserPersona | null> {
    return this.store.findOne({ id });
  }

  insert(doc: UserPersona): Promise<UserPersona> {
    return this.store.insert(doc);
  }

  /** Partial merge: fields absent from `patch` are left untouched. */
  update(id: string, patch: Partial<UserPersona>): Promise<UserPersona | null> {
    return this.store.update({ id }, patch);
  }

  delete(id: string): Promise<number> {
    return this.store.deleteOne({ id });
  }
}
