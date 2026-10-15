import { Agent } from '@mastra/core/agent';
import { resolveAgentModel } from '../model-resolver';
import { agentInstructions } from '../agent-prompt-overrides';
import { SHOWCASE_AGENTS, ShowcaseAgentDef } from './showcase-catalog';

/** A showcase agent (agents.md 2.9): registered, never run. */
function showcaseAgent(def: ShowcaseAgentDef): Agent {
  return new Agent({
    id: def.id,
    name: def.name,
    description: def.description,
    // The shipped prompt, or the in-app override (ADR-0026).
    instructions: () => agentInstructions(def.key, def.prompt),
    // Never called (the agent cannot chat), but every agent resolves the
    // configured model the same way; see ../model-resolver.
    model: async () => resolveAgentModel(),
  });
}

/** The registered showcase agents, by registry key. */
export const showcaseAgents: Readonly<Record<string, Agent>> =
  Object.fromEntries(
    SHOWCASE_AGENTS.map((def) => [def.key, showcaseAgent(def)]),
  );
