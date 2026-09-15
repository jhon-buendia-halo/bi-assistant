// Bridge between the standalone Mastra agents (constructed at module load,
// with no Nest DI) and the Nest-side LLM settings (persisted provider/model +
// encrypted key). Each agent's `model` is an async function that calls
// resolveAgentModel(); LlmModule installs the real resolver at runtime via
// setAgentModelResolver(). Until then the default keeps the env string-router
// behaviour so the framework still boots. Mirrored from data-readiness-agent
// (its ADR-0010).

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

export type AgentModelResolver = () => Promise<AgentModelConfig>;

let resolver: AgentModelResolver | null = null;

export function setAgentModelResolver(fn: AgentModelResolver): void {
  resolver = fn;
}

export async function resolveAgentModel(): Promise<AgentModelConfig> {
  if (resolver) {
    return resolver();
  }
  // Fallback: env-bound string router (OPENAI_API_KEY) when no settings exist.
  return 'openai/gpt-4o-mini';
}
