/**
 * Bridge for the in-app overrides of built-in agents' system prompts
 * (ADR-0026, agents.md 2). The agents are plain code with no Nest DI, so the
 * prompt service installs the current overrides here when the app starts and
 * after every save or reset. Each agent reads them per call, so a change
 * applies to the next call without a restart. An override of a key that is
 * not a built-in agent is never read.
 */

/** One override as resolution needs it (data-model 3.10.3). */
export interface AgentPromptOverride {
  key: string;
  prompt: string;
  baseHash: string;
  updatedAt?: string;
}

let overrides: ReadonlyMap<string, AgentPromptOverride> = new Map();
let version = 0;

/** Replace every override (start-up load, or after a save or reset). */
export function setAgentPromptOverrides(
  list: readonly AgentPromptOverride[],
): void {
  overrides = new Map(list.map((entry) => [entry.key, entry]));
  version += 1;
}

export function agentPromptOverrideFor(
  key: string,
): AgentPromptOverride | undefined {
  return overrides.get(key);
}

/** Changes whenever the overrides do: the key of anything built from them. */
export function agentPromptOverridesVersion(): number {
  return version;
}

/**
 * A System agent's instructions for a call: the override's text, else the
 * shipped prompt unchanged.
 */
export function agentInstructions(key: string, shipped: string): string {
  return agentPromptOverrideFor(key)?.prompt ?? shipped;
}
