/**
 * The harness's main agent, rewritten to the model vocabulary (ADR-0007,
 * roadmap 1.2.2): no catalogs, schemas, tables, SQL dialects, Databricks,
 * PostgreSQL or SQLite anywhere in these instructions — the assistant
 * reasons over the session's data model (entities, attributes,
 * relationships, metrics) and asks for data with `query_entities`. Its
 * tools are scoped per call to the session's datasets via requestContext
 * (see ../tools/model.tools). `assistant-legacy.agent.ts` keeps the
 * pre-change instructions + `datasetTools` for the eval harness's `legacy`
 * comparison path only.
 */
import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { resolveAgentModel } from '../model-resolver';
import { modelTools } from '../tools/model.tools';
import { askClarificationTool } from '../tools/clarification.tool';
import { visualTools } from '../tools/visual.tools';
import { SESSION_WORKSPACE_CONTEXT_KEY } from '../session-workspaces';
import { ASSISTANT_INSTRUCTIONS } from './assistant.instructions';

export const assistantAgent = new Agent({
  id: 'assistant',
  name: 'Questions to Insights Assistant',
  description:
    "Answers business questions over a session's data model — plans the analysis, queries the entities, and explains the result.",
  instructions: ASSISTANT_INSTRUCTIONS,
  // Dynamic model resolved at call time from the persisted LLM settings
  // (provider / model / runtime API key); see ../model-resolver.
  model: async () => resolveAgentModel(),
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
  tools: {
    ...modelTools,
    ...visualTools,
    ask_clarification: askClarificationTool,
  },
});
