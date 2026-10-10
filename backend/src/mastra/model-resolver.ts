// Bridge between the standalone Mastra agents (constructed at module load,
// with no Nest DI) and the Nest-side LLM settings (persisted provider/model +
// encrypted key). Each agent's `model` is an async function that calls
// resolveAgentModel(); LlmModule installs the real resolver at runtime via
// setAgentModelResolver(). Until then the default keeps the env string-router
// behaviour so the framework still boots. Mirrored from data-readiness-agent
// (its ADR-0010).

import type { ReasoningEffort } from './effort-levels';

/**
 * A Mastra model config. Either a router id string (`openai/gpt-4o-mini`,
 * which reads OPENAI_API_KEY from the env) or an OpenAI-compatible config
 * carrying a runtime apiKey — both are accepted by Mastra's model router.
 * When `url` is set, Mastra builds an OpenAI-compatible client against that
 * base URL — the LenAI gateway path.
 */
export type AgentModelConfig =
  | `${string}/${string}`
  | {
      id: `${string}/${string}`;
      apiKey: string;
      url?: string;
      headers?: Record<string, string>;
    };

/**
 * Resolves the persisted model. `modelOverride` replaces the saved model or
 * deployment name for one call (a user agent's override, agents.md 1.3).
 */
export type AgentModelResolver = (
  modelOverride?: string,
) => Promise<AgentModelConfig>;

let resolver: AgentModelResolver | null = null;

export function setAgentModelResolver(fn: AgentModelResolver): void {
  resolver = fn;
}

export async function resolveAgentModel(
  modelOverride?: string,
): Promise<AgentModelConfig> {
  if (resolver) {
    return resolver(modelOverride);
  }
  // Fallback: env-bound string router (OPENAI_API_KEY) when no settings exist.
  return 'openai/gpt-4o-mini';
}

/**
 * requestContext key carrying a user agent's model and reasoning-effort
 * overrides for the assistant's calls in a session bound to that agent
 * (agents.md 4.2). Only the assistant's model function reads it.
 */
export const AGENT_OVERRIDES_CONTEXT_KEY = 'agent-overrides';

export interface AgentOverrides {
  model?: string;
  reasoningEffort?: ReasoningEffort;
}

/** The model override on a call's requestContext, if any. */
export function modelOverrideFrom(requestContext?: {
  get(key: string): unknown;
}): string | undefined {
  const overrides = requestContext?.get(AGENT_OVERRIDES_CONTEXT_KEY) as
    AgentOverrides | undefined;
  return overrides?.model || undefined;
}
