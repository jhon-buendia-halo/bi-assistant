import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { modelOverrideFrom, resolveAgentModel } from '../model-resolver';
import { datasetTools } from '../tools/dataset.tools';
import { askClarificationTool } from '../tools/clarification.tool';
import { visualTools } from '../tools/visual.tools';
import { SESSION_WORKSPACE_CONTEXT_KEY } from '../session-workspaces';
import { catalogSkills } from '../app-skills';
import { skillToolsFor } from '../skill-tools';
import { buildAssistantInstructions } from './assistant-prompt';

/** The assistant's tools, in the order its prompt lists them. */
const tools = {
  ...datasetTools,
  ...visualTools,
  ask_clarification: askClarificationTool,
  ...skillToolsFor('assistant'),
};

// The harness's main agent. Its tools are scoped per call to the session's
// datasets via requestContext (see ../tools/dataset.tools).
export const assistantAgent = new Agent({
  id: 'assistant',
  name: 'Questions to Insights Assistant',
  description:
    "Answers business questions over a session's datasets — plans the analysis, writes and runs the SQL, and explains the result.",
  // Identity, ## Tools, ## Working rules, then ## Skills when it has
  // on-demand skills (agents.md 2.1, 7.5; ADR-0020).
  instructions: buildAssistantInstructions(tools, catalogSkills('assistant')),
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
  tools,
});
