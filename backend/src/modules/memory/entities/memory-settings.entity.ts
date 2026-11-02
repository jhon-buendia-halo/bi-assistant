/** The embedding model of every learning memory (agents.md 2.1). */
export const EMBEDDING_MODEL = 'text-embedding-3-small';

/**
 * Where the embedding key would come from now: the saved LLM settings when
 * their provider is OpenAI, else `OPENAI_API_KEY` from the environment.
 */
export type EmbeddingKeySource = 'llm-settings' | 'environment' | 'none';

/** The memory lever (knowledge R30), one document in `settings`. */
export interface MemorySettingsDoc {
  key: 'memory';
  enabled: boolean;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * A compaction of the store files that failed or was cut short, to run
 * again at the next start (data-model 3.15, 5.2).
 */
export interface MemoryCompactionDoc {
  key: 'memory-compaction';
  pendingSince: string;
  lastError?: string;
  createdAt?: string;
  updatedAt?: string;
}

/** `GET /memory/settings` and `PUT /memory/settings` (api.md 108, 109). */
export interface MemorySettingsView {
  enabled: boolean;
  embeddingModel: typeof EMBEDDING_MODEL;
  embeddingKey: EmbeddingKeySource;
}
