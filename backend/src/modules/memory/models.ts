/**
 * The two models the memory calls itself, as plain shapes (no framework
 * import), so the store can be tested with fakes.
 */

/** Why the memory stores and recalls nothing (contract 1.4). */
export const NO_EMBEDDING_KEY_MESSAGE =
  'No OpenAI key for embeddings: choose OpenAI in LLM configuration or set OPENAI_API_KEY';

/** What an embedding call is given. */
export interface EmbedArgs {
  values: string[];
  abortSignal?: AbortSignal;
  headers?: Record<string, string | undefined>;
  providerOptions?: Record<string, Record<string, unknown>>;
}

/** What an embedding call returns; `usage.tokens` as the provider reports. */
export interface EmbedResult {
  embeddings: number[][];
  usage?: { tokens: number };
}

/** The part of an AI SDK v2 embedding model the framework's memory calls. */
export interface EmbeddingModelLike {
  readonly specificationVersion: 'v2';
  readonly provider: string;
  readonly modelId: string;
  readonly maxEmbeddingsPerCall: number | undefined;
  readonly supportsParallelCalls: boolean;
  doEmbed(args: EmbedArgs): Promise<EmbedResult>;
}

/** One summary call's text, the model's id and the usage it reported. */
export interface SummaryResult {
  text: string;
  /** The model id as configured, with or without provider prefix. */
  model: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    cachedInputTokens?: number;
    reasoningTokens?: number;
  };
}

/** One call of the configured model, no tools, no memory (agents.md 2.1). */
export interface SummaryModel {
  generate(instructions: string, prompt: string): Promise<SummaryResult>;
}

/** `openai/GPT-5.6-Luna` → `gpt-5.6-luna`: the id a price table keys. */
export function modelName(id: string): string {
  const slash = id.indexOf('/');
  return (slash >= 0 ? id.slice(slash + 1) : id).toLowerCase();
}
