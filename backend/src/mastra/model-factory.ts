import type { LanguageModelV3 } from '@ai-sdk/provider';
import type {
  AgentModelConfig,
  CustomAnthropicModelConfig,
} from './model-resolver';

// Turns a model config into what a Mastra agent accepts (unit 3, BA-284).
// Router configs pass through unchanged; an Anthropic-compatible custom
// endpoint becomes an @ai-sdk/anthropic model instance (ADR-0032).

export type BuiltModel =
  Exclude<AgentModelConfig, CustomAnthropicModelConfig> | LanguageModelV3;

export async function buildModel(
  config: AgentModelConfig,
): Promise<BuiltModel> {
  if (typeof config === 'object' && 'kind' in config) {
    throw new Error(
      'Anthropic-compatible custom endpoints are not implemented yet (BA-281 scaffold)',
    );
  }
  return Promise.resolve(config);
}
