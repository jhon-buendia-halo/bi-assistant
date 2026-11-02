import type { EmbeddingKeySource } from './entities/memory-settings.entity';

/** Where the embedding key comes from now, and the key itself. */
export interface EmbeddingKey {
  source: EmbeddingKeySource;
  /** Never logged, never returned by the API. */
  apiKey?: string;
}

/** Resolves the embedding key per call (`EmbeddingKeyService`). */
export interface EmbeddingKeyResolver {
  resolve(): Promise<EmbeddingKey>;
}

export const EMBEDDING_KEY_RESOLVER = 'EMBEDDING_KEY_RESOLVER';

/**
 * The memory's OpenAI key (contract 1.4, agents.md 2.1): the key saved in
 * the LLM settings when their provider is OpenAI; otherwise
 * `OPENAI_API_KEY` from the environment, with any quotes around it
 * stripped (a stray one in a `.env` would be sent and refused); otherwise
 * none, and the memory stores and recalls nothing. Pure.
 */
export function embeddingKeyFrom(
  savedOpenAiKey: string | undefined,
  env: Record<string, string | undefined>,
): EmbeddingKey {
  const saved = savedOpenAiKey?.trim();
  if (saved) return { source: 'llm-settings', apiKey: saved };
  const fromEnv = (env.OPENAI_API_KEY ?? '')
    .trim()
    .replace(/^['"]+|['"]+$/g, '')
    .trim();
  if (fromEnv) return { source: 'environment', apiKey: fromEnv };
  return { source: 'none' };
}
