import { Inject, Injectable } from '@nestjs/common';
import { AUTH_SESSIONS_STORE } from '../../../infrastructure/database/doc-store';
import type { DocStore } from '../../../infrastructure/database/doc-store';
import type { AuthSessionDoc } from '../entities/directory.entity';

/** Signed-in browsers (data-model 3.14.6), keyed by the token's SHA-256. */
@Injectable()
export class AuthSessionsRepository {
  constructor(
    @Inject(AUTH_SESSIONS_STORE)
    private readonly store: DocStore<AuthSessionDoc>,
  ) {}

  insert(session: AuthSessionDoc): Promise<AuthSessionDoc> {
    return this.store.insert(session);
  }

  byId(id: string): Promise<AuthSessionDoc | null> {
    return this.store.findOne({ id });
  }

  all(): Promise<AuthSessionDoc[]> {
    return this.store.find();
  }

  touch(id: string, lastSeenAt: string): Promise<AuthSessionDoc | null> {
    return this.store.update({ id }, { lastSeenAt });
  }

  delete(id: string): Promise<number> {
    return this.store.deleteOne({ id });
  }

  deleteAllOf(userId: string): Promise<number> {
    return this.store.deleteMany({ userId });
  }
}
