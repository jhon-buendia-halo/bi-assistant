const models: { apiKey: string; doEmbed: jest.Mock }[] = [];
jest.mock('@mastra/core/llm', () => ({
  ModelRouterEmbeddingModel: class {
    doEmbed = jest.fn().mockResolvedValue({
      embeddings: [[0.1, 0.2]],
      usage: { tokens: 3 },
    });
    constructor(config: {
      apiKey: string;
      providerId: string;
      modelId: string;
    }) {
      expect(config.providerId).toBe('openai');
      expect(config.modelId).toBe('text-embedding-3-small');
      models.push({ apiKey: config.apiKey, doEmbed: this.doEmbed });
    }
  },
}));

import { NO_EMBEDDING_KEY_MESSAGE, OpenAiEmbedder } from './openai-embedder';

describe('OpenAiEmbedder', () => {
  beforeEach(() => {
    models.length = 0;
  });

  it('embeds with the key resolved at the call, rebuilt when it changes', async () => {
    let key: string | undefined = 'sk-one';
    const embedder = new OpenAiEmbedder(() => Promise.resolve(key));

    await expect(embedder.doEmbed({ values: ['a'] })).resolves.toEqual({
      embeddings: [[0.1, 0.2]],
      usage: { tokens: 3 },
    });
    await embedder.doEmbed({ values: ['b'] });
    key = 'sk-two';
    await embedder.doEmbed({ values: ['c'] });

    expect(models.map((m) => m.apiKey)).toEqual(['sk-one', 'sk-two']);
    expect(models[0].doEmbed).toHaveBeenCalledTimes(2);
  });

  it('refuses to embed without a key', async () => {
    const embedder = new OpenAiEmbedder(() => Promise.resolve(undefined));

    await expect(embedder.doEmbed({ values: ['a'] })).rejects.toThrow(
      NO_EMBEDDING_KEY_MESSAGE,
    );
    expect(models).toEqual([]);
  });
});
