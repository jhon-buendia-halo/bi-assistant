import { Inject, Injectable } from '@nestjs/common';
import { AGENTS_STORE } from '../../../infrastructure/database/doc-store';
import type { DocStore } from '../../../infrastructure/database/doc-store';
import type { UserAgentDoc } from '../../user-agents/entities/user-agent.entity';

/**
 * User agents of EVERY owner, for the admin area only.
 *
 * Deliberately the raw `agents` store, not the owner-scoped one every other
 * repository uses (data-model 3.15): the Overview counts agents across
 * owners (data-model 3.14.8), the user detail lists another user's agents,
 * and a transfer moves an agent between owners (api.md 86, admin R64). This
 * is the one place the app reads or writes a private collection across
 * owners at request time. Every route reaching it needs `manage-users`, and
 * it never exposes an agent's instructions or the sessions started from it.
 *
 * A document without `ownerId` was stored before org server mode (admin
 * R33): it belongs to nobody here, so `owned()` leaves it out.
 */
@Injectable()
export class AllOwnersAgentsRepository {
  constructor(
    @Inject(AGENTS_STORE) private readonly store: DocStore<UserAgentDoc>,
  ) {}

  /** Every agent that has an owner. */
  async owned(): Promise<UserAgentDoc[]> {
    return (await this.store.find()).filter((doc) => !!doc.ownerId);
  }

  /** One agent with an owner; `null` when missing or ownerless. */
  async ownedById(id: string): Promise<UserAgentDoc | null> {
    const doc = await this.store.findOne({ id });
    return doc?.ownerId ? doc : null;
  }

  /** Move an agent to another owner, unpinned (admin R64). */
  async moveTo(id: string, ownerId: string): Promise<UserAgentDoc | null> {
    return this.store.update({ id }, { ownerId, pinned: false });
  }
}
