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
let lastModelId: string | undefined;

export function setAgentModelResolver(fn: AgentModelResolver): void {
  resolver = fn;
}

/** The router id out of either config shape — never the key that goes with it. */
export function agentModelId(config: AgentModelConfig): string {
  return typeof config === 'string' ? config : config.id;
}

/**
 * The model id the agents most recently ran on, or `undefined` before the
 * first call. Recorded here because nothing else can answer the question
 * truthfully: settings can change mid-run, and `LlmService` knows what is
 * *configured*, not what a given run actually spent tokens on. Eval runs log
 * this against their token counts, since a count without the model that
 * produced it cannot be priced or compared.
 */
export function lastAgentModelId(): string | undefined {
  return lastModelId;
}

export async function resolveAgentModel(): Promise<AgentModelConfig> {
  if (resolver) {
    const config = await resolver();
    lastModelId = agentModelId(config);
    return config;
  }
  // Fallback: env-bound string router (OPENAI_API_KEY) when no settings exist.
  const fallback: AgentModelConfig = 'openai/gpt-4o-mini';
  lastModelId = fallback;
  return fallback;
}
