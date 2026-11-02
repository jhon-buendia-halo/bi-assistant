/** Where the embeddings key would come from right now (knowledge R30). */
export type MemoryEmbeddingKey = 'llm-settings' | 'environment' | 'none';

/** GET/PUT /memory/settings: the lever of the memory of past sessions. */
export interface MemorySettingsView {
  enabled: boolean;
  embeddingModel: 'text-embedding-3-small';
  embeddingKey: MemoryEmbeddingKey;
}

/** A rejected PUT answers in Style A instead of the view. */
export interface MemorySettingsFailure {
  ok: false;
  message: string;
}
