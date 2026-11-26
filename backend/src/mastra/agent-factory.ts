import { Agent, type AgentConfig } from '@mastra/core/agent';
import { resolveLinks } from './agent-links';
import { agentInstructions } from './agent-prompt-overrides';
import { modelOverrideFrom, resolveAgentModel } from './model-resolver';
import { stepModelFrom } from './step-model';
import { type PromptTool } from './agents/assistant-prompt';
import { withToolSection } from './tool-section';

/**
 * The one way a built-in agent is built (agents.md 1.1). A spec says what
 * makes the agent itself; the factory adds what every built-in agent shares:
 * its prompt as served (the shipped text or its in-app override, ADR-0026),
 * its model resolved on every call (agents.md 1.3) and its classes, which
 * decide its tools (the agent-change skill, "Classify the agent").
 */

/** A call's request context, as the agents read it. */
export interface ContextLike {
  get(key: string): unknown;
}

/**
 * What an agent is (the agent-change skill): `person`, a person talks to it;
 * `data`, it answers from the session's datasets; `orchestrator`, it calls
 * other agents as its tools; `single-step`, the code calls it once with a
 * contract, no person and no tools.
 */
export type AgentClass = 'person' | 'data' | 'orchestrator' | 'single-step';

/**
 * How an agent's model is picked on each call (agents.md 1.3): the saved
 * model; the step model on the call's context, else the saved one (a
 * workflow's or Elena's routing); or a user agent's model override, else the
 * saved one (only the assistant).
 */
const MODEL_POLICIES = {
  saved: async () => resolveAgentModel(),
  'step-model': async ({ requestContext }: { requestContext?: ContextLike }) =>
    resolveAgentModel(stepModelFrom(requestContext)?.model),
  'user-override': async ({
    requestContext,
  }: {
    requestContext?: ContextLike;
  }) => resolveAgentModel(modelOverrideFrom(requestContext)),
} as const;

export type ModelPolicy = keyof typeof MODEL_POLICIES;

export interface BuiltinAgentSpec {
  /** The registry key: the catalogue's, and the key of its prompt override. */
  key: string;
  /** The Mastra agent id, when it is not the key. */
  id?: string;
  /** The technical name traces and Monitoring show (the hub shows the persona). */
  name: string;
  description: string;
  classes: readonly AgentClass[];
  /**
   * The shipped prompt, served as is or as its in-app override; or a
   * function of the call's context for an agent that builds its own.
   */
  instructions: string | ((requestContext?: ContextLike) => string);
  /**
   * A policy, or the agent's own model function (the visual designer); never
   * a fixed model id, since every model is resolved on the call.
   */
  model:
    ModelPolicy | Extract<AgentConfig['model'], (...args: never[]) => unknown>;
  tools?: AgentConfig['tools'];
  skills?: AgentConfig['skills'];
  memory?: AgentConfig['memory'];
  workspace?: AgentConfig['workspace'];
}

const classesByKey = new Map<string, readonly AgentClass[]>();

/** The declared classes of every built-in agent built so far, by key. */
export function builtinAgentClasses(): Record<string, readonly AgentClass[]> {
  return Object.fromEntries(classesByKey);
}

/**
 * An agent's prompt as served with its tools listed (agents.md 2.8): the
 * shipped text or its in-app override, its links turned into plain mentions
 * (agents.md 4.1), with the `## Tools` section generated from `tools`.
 */
export function servedPromptWithTools(
  key: string,
  shipped: string,
  tools: Record<string, PromptTool>,
): string {
  return withToolSection(resolveLinks(agentInstructions(key, shipped)), tools);
}

/** Builds a built-in agent from its spec. */
export function defineBuiltinAgent(spec: BuiltinAgentSpec): Agent {
  classesByKey.set(spec.key, spec.classes);
  const { instructions, key } = spec;
  return new Agent({
    id: spec.id ?? key,
    name: spec.name,
    description: spec.description,
    instructions:
      typeof instructions === 'string'
        ? () => agentInstructions(key, instructions)
        : (args?: { requestContext?: ContextLike }) =>
            instructions(args?.requestContext),
    model:
      typeof spec.model === 'string' ? MODEL_POLICIES[spec.model] : spec.model,
    ...(spec.tools ? { tools: spec.tools } : {}),
    ...(spec.skills ? { skills: spec.skills } : {}),
    ...(spec.memory ? { memory: spec.memory } : {}),
    ...(spec.workspace ? { workspace: spec.workspace } : {}),
  });
}
