import { Inject, Injectable } from '@nestjs/common';
import { SESSIONS_STORE } from '../../../infrastructure/database/doc-store';
import type { DocStore } from '../../../infrastructure/database/doc-store';
import { SessionDoc } from '../entities/session.entity';

/** Sessions (data-model 3.5). */
@Injectable()
export class SessionsRepository {
  constructor(
    @Inject(SESSIONS_STORE)
    private readonly store: DocStore<SessionDoc>,
  ) {}

  /** Every session, for startup work (the workspace backfill). */
  listAll(): Promise<SessionDoc[]> {
    return this.store.find({});
  }

  /** Startup work: record a session's workspace. */
  setWorkspaceId(id: string, workspaceId: string): Promise<SessionDoc | null> {
    return this.store.update({ id }, { workspaceId });
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
