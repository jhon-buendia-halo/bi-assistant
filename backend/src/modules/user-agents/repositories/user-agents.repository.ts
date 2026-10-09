import { Inject, Injectable } from '@nestjs/common';
import { AGENTS_STORE } from '../../../infrastructure/database/doc-store';
import type { DocStore } from '../../../infrastructure/database/doc-store';
import type { UserAgentDoc } from '../entities/user-agent.entity';

/** User agents (the `agents` collection), most recently updated first. */
@Injectable()
export class UserAgentsRepository {
  constructor(
    @Inject(AGENTS_STORE) private readonly store: DocStore<UserAgentDoc>,
  ) {}

  list(): Promise<UserAgentDoc[]> {
    return this.store.find({}, { sort: { updatedAt: -1 } });
  }

  get(id: string): Promise<UserAgentDoc | null> {
    return this.store.findOne({ id });
  }

  insert(doc: UserAgentDoc): Promise<UserAgentDoc> {
    return this.store.insert(doc);
  }

  /** Shallow merge: a patched `draft` or `live` replaces the whole object. */
  update(
    id: string,
    patch: Partial<UserAgentDoc>,
  ): Promise<UserAgentDoc | null> {
    return this.store.update({ id }, patch);
  }

  delete(id: string): Promise<number> {
    return this.store.deleteOne({ id });
  }
}
