import { Inject, Injectable } from '@nestjs/common';
import { AGENT_PROMPT_OVERRIDES_STORE } from '../../../infrastructure/database/doc-store';
import type { DocStore } from '../../../infrastructure/database/doc-store';
import type { AgentPromptOverrideDoc } from '../entities/agent-prompt-override.entity';

/**
 * Overrides of built-in agents' system prompts (the `agent_prompt_overrides`
 * collection), by registry key. Shared: every user sees the same documents
 * (data-model 3.15), so this injects the raw store.
 */
@Injectable()
export class AgentPromptOverridesRepository {
  constructor(
    @Inject(AGENT_PROMPT_OVERRIDES_STORE)
    private readonly store: DocStore<AgentPromptOverrideDoc>,
  ) {}

  list(): Promise<AgentPromptOverrideDoc[]> {
    return this.store.find({}, { sort: { key: 1 } });
  }

  get(key: string): Promise<AgentPromptOverrideDoc | null> {
    return this.store.findOne({ key });
  }

  save(doc: AgentPromptOverrideDoc): Promise<AgentPromptOverrideDoc | null> {
    return this.store.update({ key: doc.key }, doc, { upsert: true });
  }

  delete(key: string): Promise<number> {
    return this.store.deleteOne({ key });
  }
}
