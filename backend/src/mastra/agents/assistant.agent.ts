import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { modelOverrideFrom, resolveAgentModel } from '../model-resolver';
import { datasetTools } from '../tools/dataset.tools';
import { askClarificationTool } from '../tools/clarification.tool';
import { visualTools } from '../tools/visual.tools';
import { SESSION_WORKSPACE_CONTEXT_KEY } from '../session-workspaces';
import { catalogSkills } from '../app-skills';
import {
  type AgentSkill,
  agentSkillsFrom,
  mergedCatalog,
} from '../agent-skills';
import { skillOverridesVersion } from '../skill-overrides';
import { skillToolsFor } from '../skill-tools';
import {
  OPTIONAL_AGENT_TOOLS,
  OPTIONAL_TOOL_NAMES,
  type OptionalAgentTool,
  selectionKey,
  selects,
  toolSelectionFrom,
} from '../agent-tools';
import { buildAssistantInstructions } from './assistant-prompt';

/** Every tool the assistant can be given, in the order its prompt lists them. */
const ALL_TOOLS = {
  ...datasetTools,
  ...visualTools,
  ask_clarification: askClarificationTool,
  ...skillToolsFor('assistant'),
};

type AssistantTools = Partial<typeof ALL_TOOLS>;

/** The tools and prompt of one tool selection, built once each (8 variants). */
interface AssistantVariant {
  tools: AssistantTools;
  instructions: string;
}

const variants = new Map<string, AssistantVariant>();
/** The overrides version the cached variants were built under (ADR-0022). */
let variantsVersion = skillOverridesVersion();

/**
 * The tools a call offers under `selection` (ADR-0021, agents.md 2.1): the
 * always-given tools and the selected optional ones, in the usual order.
 * Undefined selects every tool. `read_file` / `run_skill_script` stay
 * whenever the assistant has on-demand skills.
 */
export function assistantVariant(
  selection?: readonly OptionalAgentTool[],
  agentSkills?: readonly AgentSkill[],
): AssistantVariant {
  const base = baseVariant(selection);
  if (!agentSkills?.length) return base;
  // The agent's in-app skills join the catalog (ADR-0021, agents.md 7.3).
  // The tools don't change, so only the prompt is rebuilt, and it is not
  // cached: it follows each agent's copies and a cache would grow with them.
  return {
    tools: base.tools,
    instructions: buildAssistantInstructions(
      base.tools,
      mergedCatalog(catalogSkills('assistant'), agentSkills),
      selection,
    ),
  };
}

function baseVariant(
  selection?: readonly OptionalAgentTool[],
): AssistantVariant {
  // The catalog is baked into the prompt: drop every variant when an in-app
  // override of a built-in skill changes (ADR-0022).
  if (variantsVersion !== skillOverridesVersion()) {
    variants.clear();
    variantsVersion = skillOverridesVersion();
  }
  const key = selectionKey(selection);
  const cached = variants.get(key);
  if (cached) return cached;
  const dropped = new Set(
    OPTIONAL_AGENT_TOOLS.filter((tool) => !selects(selection, tool)).flatMap(
      (tool) => OPTIONAL_TOOL_NAMES[tool],
    ),
  );
  const tools = Object.fromEntries(
    Object.entries(ALL_TOOLS).filter(([name]) => !dropped.has(name)),
  ) as AssistantTools;
  const variant = {
    tools,
    // Identity, ## Tools, ## Working rules, then ## Skills when it has
    // on-demand skills (agents.md 2.1, 7.5; ADR-0020).
    instructions: buildAssistantInstructions(
      tools,
      catalogSkills('assistant'),
      selection,
    ),
  };
  variants.set(key, variant);
  return variant;
}

// The harness's main agent. Its tools are scoped per call to the session's
// datasets via requestContext (see ../tools/dataset.tools).
export const assistantAgent = new Agent({
  id: 'assistant',
  name: 'Questions to Insights Assistant',
  description:
    "Answers business questions over a session's datasets — plans the analysis, writes and runs the SQL, and explains the result.",
  // The prompt and tools follow the call's tool selection (`agent-tools`,
  // ADR-0021); a call without one gets every tool and the full prompt.
  instructions: ({ requestContext }) =>
    assistantVariant(
      toolSelectionFrom(requestContext),
      agentSkillsFrom(requestContext),
    ).instructions,
  // Dynamic model resolved at call time from the persisted LLM settings
  // (provider / model / runtime API key); see ../model-resolver. A session
  // bound to a user agent may override the model name for this agent only.
  model: async ({ requestContext }) =>
    resolveAgentModel(modelOverrideFrom(requestContext)),
  memory: new Memory({
    options: {
      // Keep enough recent session context for follow-up analysis without
      // requiring the caller to resend the full conversation every turn.
      lastMessages: 40,
      semanticRecall: false,
      generateTitle: false,
    },
  }),
  workspace: ({ requestContext, mastra }) => {
    const workspaceId = requestContext.get(SESSION_WORKSPACE_CONTEXT_KEY);
    if (typeof workspaceId !== 'string' || !mastra) return undefined;
    return mastra.listWorkspaces()[workspaceId]?.workspace;
  },
  // No framework `skills`: the app renders the catalog into the prompt and
  // gives read_file / run_skill_script instead (ADR-0020). Harness-loaded
  // skills are sent by their callers.
  tools: ({ requestContext }) =>
    assistantVariant(toolSelectionFrom(requestContext)).tools,
});
