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

/**
 * The eval judge's own resolver, separate from the assistant's — installed
 * by `LlmService.onModuleInit` alongside `setAgentModelResolver`. It is a
 * full `AgentModelResolver` (not just a model id) because deciding the
 * judge's model needs Nest-side state — `EngineSettings.judgeModel`, plus
 * the persisted LLM doc to reuse a stored key when the pin matches the
 * configured provider — that this pure module has no access to.
 */
let judgeResolver: AgentModelResolver | null = null;
let lastJudgeId: string | undefined;

/** Installed once, at boot, by `LlmService.onModuleInit`. */
export function setJudgeModelResolver(fn: AgentModelResolver): void {
  judgeResolver = fn;
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

/**
 * The model config the eval judge (`mastra/agents/eval-judge.agent.ts`)
 * runs on. Before `LlmModule` installs the real resolver — or when nothing
 * was ever pinned via `EngineSettings.judgeModel` — this is exactly
 * `resolveAgentModel()`: the judge runs on the assistant's own configured
 * model, same as always. The installed resolver decides the pinned-vs-not
 * branch itself (it owns the Nest-side settings this module can't see);
 * this function only decides whether to ask it.
 */
export async function resolveJudgeModel(): Promise<AgentModelConfig> {
  const config = judgeResolver
    ? await judgeResolver()
    : await resolveAgentModel();
  lastJudgeId = agentModelId(config);
  return config;
}

/**
 * The model id the judge most recently ran on, or `undefined` before the
 * first call — same reasoning as `lastAgentModelId`: only the module that
 * actually dispatched the call knows what a run spent tokens on.
 */
export function lastJudgeModelId(): string | undefined {
  return lastJudgeId;
}
