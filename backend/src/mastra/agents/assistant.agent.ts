import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { resolveAgentModel } from '../model-resolver';
import { datasetTools } from '../tools/dataset.tools';
import { lookupTools } from '../tools/lookup.tools';
import { askClarificationTool } from '../tools/clarification.tool';
import { visualTools } from '../tools/visual.tools';
import { SESSION_WORKSPACE_CONTEXT_KEY } from '../session-workspaces';
import {
  buildAssistantInstructions,
  readEngineAblation,
} from './assistant-instructions';

// The harness's main agent. Its tools are scoped per call to the session's
// datasets via requestContext (see ../tools/dataset.tools).
export const assistantAgent = new Agent({
  id: 'assistant',
  name: 'Questions to Insights Assistant',
  description:
    "Answers business questions over a session's datasets — plans the analysis, writes and runs the SQL, and explains the result.",
  // The prompt lives in assistant-instructions.ts as named rule groups so an
  // eval arm can ablate some (L5 `promptAblation`, read off requestContext).
  // With nothing ablated it is byte-identical to the prompt that used to be
  // inlined here (golden: __fixtures__/assistant-instructions.golden.txt).
  instructions: ({ requestContext }) =>
    buildAssistantInstructions(readEngineAblation(requestContext)),
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
    ...datasetTools,
    ...visualTools,
    ask_clarification: askClarificationTool,
    // Last, so the default tool order is unchanged. Offered per turn only
    // when the `lookupTools` lever is on: SessionsService passes
    // `activeTools` without LOOKUP_TOOL_NAMES otherwise.
    ...lookupTools,
  },
});
