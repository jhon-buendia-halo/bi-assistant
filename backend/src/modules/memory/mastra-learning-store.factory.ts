import { createClient } from '@libsql/client';
import { Agent } from '@mastra/core/agent';
import { LibSQLVector } from '@mastra/libsql';
import { join } from 'path';
import { resolveAgentModel } from '../../mastra/model-resolver';
import { mastraDataDir, mastraStorage } from '../../mastra/storage';
import type { EmbeddingKeyResolver } from './embedding-key';
import { MastraLearningStore } from './mastra-learning-store';
import type { SummaryModel } from './models';
import { OpenAiEmbedder } from './openai-embedder';

/** `busy_timeout` of the store's raw client, as the framework sets its own. */
const BUSY_TIMEOUT_MS = 5_000;

/**
 * The app's `MastraLearningStore`: the learning memories in the same
 * `mastra.sqlite` as the chat threads (data-model 5.2), through the app's
 * own framework storage, a vector store and a raw client of that file, the
 * OpenAI embedder and the configured model for the summary. Nothing is
 * opened until the store first needs it.
 */
export function createMastraLearningStore(
  keys: EmbeddingKeyResolver,
): MastraLearningStore {
  const url = `file:${join(mastraDataDir, 'mastra.sqlite')}`;
  const apiKey = async () => (await keys.resolve()).apiKey;
  return new MastraLearningStore({
    backend: () => ({
      storage: mastraStorage,
      vector: new LibSQLVector({ id: 'questions-to-insights-learning', url }),
    }),
    client: async () => {
      const client = createClient({ url });
      await client.execute(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
      return client;
    },
    embedder: new OpenAiEmbedder(apiKey),
    hasEmbeddingKey: async () => !!(await apiKey()),
    summaryModel: configuredSummaryModel(),
  });
}

/**
 * The summary step's one call (agents.md 2.1): the configured model as the
 * other background calls resolve it (1.3), no tools, no memory. Not a
 * registered agent.
 */
export function configuredSummaryModel(): SummaryModel {
  return {
    async generate(instructions, prompt) {
      const model = await resolveAgentModel();
      const agent = new Agent({
        id: 'memory-summary',
        name: 'Memory summary',
        instructions,
        model,
      });
      const result = await agent.generate(prompt, { maxSteps: 1 });
      return {
        text: result.text ?? '',
        model: typeof model === 'string' ? model : model.id,
        usage: {
          inputTokens: result.usage?.inputTokens,
          outputTokens: result.usage?.outputTokens,
          cachedInputTokens: result.usage?.cachedInputTokens,
          reasoningTokens: result.usage?.reasoningTokens,
        },
      };
    },
  };
}
