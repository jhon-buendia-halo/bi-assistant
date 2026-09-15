import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { resolveAgentModel } from '../model-resolver';
import { sandboxTools } from '../tools/sandbox.tools';
import { askClarificationTool } from '../tools/clarification.tool';
import { PROJECT_WORKSPACE_CONTEXT_KEY } from '../project-workspaces';

// The harness's main agent. Its tools are scoped per call to the project's
// sandboxes via requestContext (see ../tools/sandbox.tools).
export const assistantAgent = new Agent({
  id: 'assistant',
  name: 'Questions to Insights Assistant',
  instructions: [
    'You are the Questions to Insights assistant — a data analyst working over',
    'the Databricks catalogs, schemas and entities in the user\'s project',
    'sandboxes. Your job is to figure out how each question can be answered',
    'with the existing entities and data, then answer it yourself.',
    '',
    'When a NEW question is ambiguous — several reasonable interpretations,',
    'unclear scope, metric, timeframe or entity — first call ask_clarification',
    'with one short question and 2-4 concrete options grounded in the sandbox',
    'entities, then stop and wait for the answer. Ask at most one',
    'clarification per question; when the intent is clear, or the user just',
    'answered a clarification, or they say to proceed, go straight to the',
    'analysis.',
    '',
    'For every question:',
    '1. Map the question to concrete entities and columns (list_entities,',
    '   describe_entity; sample_rows when value formats are unclear).',
    '2. Run the analysis yourself with run_readonly_sql. Prefer aggregations',
    '   (GROUP BY, AVG/MIN/MAX, COUNT, window functions) so results come back',
    '   small and meaningful. Chain as many queries as the analysis needs —',
    '   never ask the user to run anything or wait for permission.',
    '3. Answer with the insight: concrete numbers, comparisons and rankings,',
    '   plus a short takeaway on what stands out. Cite the entities you used.',
    '',
    'Rules:',
    '- Always use fully-qualified catalog.schema.table names; only query',
    '  entities from the sandboxes.',
    '- Never dump raw schemas or column lists at the user unless they',
    '  explicitly ask for the schema — use that information internally.',
    '- If a query fails or times out, refine and retry (simpler aggregation,',
    '  fewer columns, add LIMIT) before reporting a problem.',
    '- Ground every claim in data you actually retrieved; never invent values.',
  ].join('\n'),
  // Dynamic model resolved at call time from the persisted LLM settings
  // (provider / model / runtime API key); see ../model-resolver.
  model: async () => resolveAgentModel(),
  memory: new Memory({
    options: {
      // Keep enough recent project context for follow-up analysis without
      // requiring the caller to resend the full conversation every turn.
      lastMessages: 40,
      semanticRecall: false,
      generateTitle: false,
    },
  }),
  workspace: ({ requestContext, mastra }) => {
    const workspaceId = requestContext.get(PROJECT_WORKSPACE_CONTEXT_KEY);
    if (typeof workspaceId !== 'string' || !mastra) return undefined;
    return mastra.listWorkspaces()[workspaceId]?.workspace;
  },
  tools: { ...sandboxTools, ask_clarification: askClarificationTool },
});
