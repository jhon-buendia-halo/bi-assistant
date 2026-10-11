import { Inject, Injectable } from '@nestjs/common';
import { SETTINGS_STORE } from '../../../infrastructure/database/doc-store';
import type { DocStore } from '../../../infrastructure/database/doc-store';
import { CurrentUserService } from '../../auth/current-user.service';
import {
  BUILTIN_AGENT_PINS_KEY,
  type BuiltinAgentPinsDoc,
} from '../entities/user-agent.entity';

/**
 * The pinned built-in agents, kept as a second `settings` document next to the
 * LLM one (data-model 3.2). LLM readers filter by `key: 'llm'`, so the two
 * never mix. Pins are per user: the local user keeps `builtin-agent-pins`,
 * a user of an org server has `builtin-agent-pins:<user id>`.
 */
@Injectable()
export class BuiltinAgentPinsRepository {
  constructor(
    @Inject(SETTINGS_STORE)
    private readonly store: DocStore<BuiltinAgentPinsDoc>,
    private readonly users: CurrentUserService,
  ) {}

  /** The current user's pins document key. */
  private key(): string {
    const owner = this.users.ownerScope();
    return owner === null
      ? BUILTIN_AGENT_PINS_KEY
      : `${BUILTIN_AGENT_PINS_KEY}:${owner}`;
  }

  async get(): Promise<string[]> {
    const doc = await this.store.findOne({ key: this.key() });
    return Array.isArray(doc?.pinned) ? doc.pinned.map(String) : [];
  }

  async save(pinned: string[]): Promise<string[]> {
    const key = this.key();
    await this.store.update({ key }, { key, pinned }, { upsert: true });
    return pinned;
  }
}
