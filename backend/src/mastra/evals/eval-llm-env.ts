import type { ApiStyle } from '../../modules/llm/llm.types';
import { API_STYLES } from '../../modules/llm/llm.types';
import {
  customModelConfig,
  endpointHost,
} from '../../modules/llm/custom-endpoint/config';
import {
  API_STYLE_INVALID,
  BASE_URL_INVALID,
  BASE_URL_REQUIRED,
} from '../../modules/llm/custom-endpoint/messages';
import type { AgentModelResolver } from '../model-resolver';

// The eval CLI's model target from env (agents.md 8.5, BA-300). Plain data
// only: run-assistant-evals installs the resolver, so this file stays
// loadable in jest without the Mastra / AI SDK modules.

/** A custom endpoint read from EVAL_LLM_* (the key never leaves this shape). */
export interface EvalCustomEndpoint {
  apiStyle: ApiStyle;
  baseUrl: string;
  model: string;
  apiKey?: string;
}

export type EvalLlmTarget =
  | { kind: 'saved' }
  | { kind: 'custom'; endpoint: EvalCustomEndpoint }
  | { error: string };

/** Mirrors `model is required` of the settings validation (api.md 30). */
export const MODEL_REQUIRED = 'model is required';

export const EVAL_LLM_PROVIDER_INVALID =
  'EVAL_LLM_PROVIDER must be custom, or unset to use the saved LLM settings';

type Env = Record<string, string | undefined>;

const read = (env: Env, name: string): string => (env[name] ?? '').trim();

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Which model the eval run uses. EVAL_LLM_PROVIDER unset → the saved
 * settings. `custom` → the endpoint from EVAL_LLM_API_STYLE, _BASE_URL,
 * _MODEL and the optional _API_KEY, validated in the order of llm-settings
 * R44 (provider, API style, base URL presence, base URL form, model) with its
 * texts; the first failure is reported.
 */
export function evalLlmTargetFromEnv(env: Env): EvalLlmTarget {
  const provider = read(env, 'EVAL_LLM_PROVIDER');
  if (!provider) return { kind: 'saved' };
  if (provider !== 'custom') return { error: EVAL_LLM_PROVIDER_INVALID };

  const apiStyle = read(env, 'EVAL_LLM_API_STYLE');
  if (!API_STYLES.includes(apiStyle as ApiStyle)) {
    return { error: API_STYLE_INVALID };
  }
  const baseUrl = read(env, 'EVAL_LLM_BASE_URL');
  if (!baseUrl) return { error: BASE_URL_REQUIRED };
  if (!isHttpUrl(baseUrl)) return { error: BASE_URL_INVALID };
  const model = read(env, 'EVAL_LLM_MODEL');
  if (!model) return { error: MODEL_REQUIRED };

  const apiKey = read(env, 'EVAL_LLM_API_KEY');
  return {
    kind: 'custom',
    endpoint: {
      apiStyle: apiStyle as ApiStyle,
      baseUrl,
      model,
      ...(apiKey ? { apiKey } : {}),
    },
  };
}

/**
 * The resolver the CLI installs for a custom endpoint: the same route the
 * saved `custom` settings get (customModelConfig, agents.md 1.3), with a user
 * agent's model override replacing only the model name.
 */
export function evalCustomResolver(
  endpoint: EvalCustomEndpoint,
): AgentModelResolver {
  return (modelOverride) =>
    Promise.resolve(
      customModelConfig({
        ...endpoint,
        model: modelOverride?.trim() || endpoint.model,
      }),
    );
}

/** One line naming the target for the run log — never the key. */
export function describeEvalTarget(endpoint: EvalCustomEndpoint): string {
  const style =
    endpoint.apiStyle === 'openai'
      ? 'OpenAI-compatible'
      : 'Anthropic-compatible';
  return (
    `Model: ${endpoint.model} on custom endpoint ` +
    `${endpointHost(endpoint.baseUrl)} ` +
    `(${style}, ${endpoint.apiKey ? 'with API key' : 'no API key'})`
  );
}
