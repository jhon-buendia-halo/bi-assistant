import { ModelRouterEmbeddingModel } from '@mastra/core/llm';
import { EMBEDDING_MODEL } from './entities/memory-settings.entity';
import {
  type EmbeddingModelLike,
  type EmbedArgs,
  type EmbedResult,
  NO_EMBEDDING_KEY_MESSAGE,
} from './models';

export { NO_EMBEDDING_KEY_MESSAGE };

/**
 * OpenAI `text-embedding-3-small` (1536 dimensions), the one embedding
 * model of every learning memory (agents.md 2.1). The key is resolved per
 * call and the client rebuilt when it changes, so a key saved in Settings
 * applies to the next embedding. With no key every call throws.
 */
export class OpenAiEmbedder implements EmbeddingModelLike {
  readonly specificationVersion = 'v2' as const;
  readonly provider = 'openai';
  readonly modelId = EMBEDDING_MODEL;
  /** OpenAI's limit of inputs per request. */
  readonly maxEmbeddingsPerCall = 2048;
  readonly supportsParallelCalls = true;
  private current?: { apiKey: string; model: ModelRouterEmbeddingModel };

  constructor(private readonly apiKey: () => Promise<string | undefined>) {}

  async doEmbed(args: EmbedArgs): Promise<EmbedResult> {
    const apiKey = await this.apiKey();
    if (!apiKey) throw new Error(NO_EMBEDDING_KEY_MESSAGE);
    if (this.current?.apiKey !== apiKey) {
      this.current = {
        apiKey,
        model: new ModelRouterEmbeddingModel({
          providerId: 'openai',
          modelId: EMBEDDING_MODEL,
          apiKey,
        }),
      };
    }
    return this.current.model.doEmbed(
      args as Parameters<ModelRouterEmbeddingModel['doEmbed']>[0],
    );
  }
}
