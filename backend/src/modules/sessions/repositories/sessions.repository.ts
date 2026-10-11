import { Inject, Injectable } from '@nestjs/common';
import {
  OWNED_SESSIONS_STORE,
  SESSIONS_STORE,
} from '../../../infrastructure/database/doc-store';
import type { DocStore } from '../../../infrastructure/database/doc-store';
import { SessionDoc } from '../entities/session.entity';

/**
 * Sessions, owner-scoped (data-model 3.15): every method but the two
 * `…AnyOwner` ones sees only the current user's sessions.
 */
@Injectable()
export class SessionsRepository {
  constructor(
    @Inject(OWNED_SESSIONS_STORE)
    private readonly store: DocStore<SessionDoc>,
    @Inject(SESSIONS_STORE)
    private readonly allOwners: DocStore<SessionDoc>,
  ) {}

  /** Every owner's sessions, for startup work only (the workspace backfill). */
  listAllOwners(): Promise<SessionDoc[]> {
    return this.allOwners.find({});
  }

  /** Startup work only: record a session's workspace, whoever owns it. */
  setWorkspaceIdAnyOwner(
    id: string,
    workspaceId: string,
  ): Promise<SessionDoc | null> {
    return this.allOwners.update({ id }, { workspaceId });
  }

  list(): Promise<SessionDoc[]> {
    return this.store.find({}, { sort: { updatedAt: -1 } });
  }

  get(id: string): Promise<SessionDoc | null> {
    return this.store.findOne({ id });
  }

  insert(doc: SessionDoc): Promise<SessionDoc> {
    return this.store.insert(doc);
  }

  update(id: string, patch: Partial<SessionDoc>): Promise<SessionDoc | null> {
    return this.store.update({ id }, patch);
  }

  delete(id: string): Promise<number> {
    return this.store.deleteOne({ id });
  }
}
