import { Inject, Injectable } from '@nestjs/common';
import { SETTINGS_STORE } from '../../../infrastructure/database/doc-store';
import type { DocStore } from '../../../infrastructure/database/doc-store';
import {
  BUILTIN_AGENT_PINS_KEY,
  type BuiltinAgentPinsDoc,
} from '../entities/user-agent.entity';

/**
 * The pinned built-in agents, kept as a second `settings` document next to the
 * LLM one (data-model 3.2). LLM readers filter by `key: 'llm'`, so the two
 * never mix.
 */
@Injectable()
export class BuiltinAgentPinsRepository {
  constructor(
    @Inject(SETTINGS_STORE)
    private readonly store: DocStore<BuiltinAgentPinsDoc>,
  ) {}

  async get(): Promise<string[]> {
    const doc = await this.store.findOne({ key: BUILTIN_AGENT_PINS_KEY });
    return Array.isArray(doc?.pinned) ? doc.pinned.map(String) : [];
  }

  async save(pinned: string[]): Promise<string[]> {
    await this.store.update(
      { key: BUILTIN_AGENT_PINS_KEY },
      { key: BUILTIN_AGENT_PINS_KEY, pinned },
      { upsert: true },
    );
    return pinned;
  }
}
