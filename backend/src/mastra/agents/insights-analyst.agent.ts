import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { resolveAgentModel } from '../model-resolver';
import { resolveLinks } from '../agent-links';
import { withToolSection } from '../tool-section';
import {
  agentPromptOverrideFor,
  agentPromptOverridesVersion,
} from '../agent-prompt-overrides';
import {
  describeEntityTool,
  listEntitiesTool,
  runReadOnlySqlTool,
  sampleRowsTool,
} from '../tools/dataset.tools';
import { askClarificationTool } from '../tools/clarification.tool';
import { catalogFrameworkSkills } from '../skill-sources';
import { INSIGHTS_ANALYST_PROMPT } from './system-prompts';
import {
  INSIGHTS_ANALYST_AGENT_KEY,
  INSIGHTS_ANALYST_DESCRIPTION,
  INSIGHTS_ANALYST_NAME,
} from './insights-analyst-catalog';

export {
  INSIGHTS_ANALYST_AGENT_KEY,
  INSIGHTS_ANALYST_MAX_STEPS,
} from './insights-analyst-catalog';

/**
 * Its tools (agents.md 2.11): the assistant's dataset tools and its
 * clarification tool (the same instances), in the order of
 * `INSIGHTS_ANALYST_TOOL_NAMES`, and nothing else — no visuals, panel or
 * workflow tool and no workspace.
 */
export const insightsAnalystTools = {
  list_entities: listEntitiesTool,
  describe_entity: describeEntityTool,
  sample_rows: sampleRowsTool,
  run_readonly_sql: runReadOnlySqlTool,
  ask_clarification: askClarificationTool,
};

/** Its on-demand skills, built per call (agents.md 7.3, 7.4). */
export function insightsAnalystSkills() {
  return catalogFrameworkSkills(INSIGHTS_ANALYST_AGENT_KEY);
}

// Links become plain mentions before the model reads them (agents.md 4.1).
const shippedInstructions = withToolSection(
  resolveLinks(INSIGHTS_ANALYST_PROMPT),
  insightsAnalystTools,
);

let served: { version: number; text: string } | undefined;

/**
 * The prompt as served: the shipped text, or the in-app override's
 * (ADR-0026), its links resolved to plain mentions, with the `## Tools`
 * section generated from its tools inserted before `## Working rules`, or
 * appended when there is none. Rebuilt only when the overrides change.
 */
export function insightsAnalystInstructions(): string {
  const override = agentPromptOverrideFor(INSIGHTS_ANALYST_AGENT_KEY);
  if (!override) return shippedInstructions;
  const version = agentPromptOverridesVersion();
  if (served?.version !== version) {
    served = {
      version,
      text: withToolSection(
        resolveLinks(override.prompt),
        insightsAnalystTools,
      ),
    };
  }
  return served.text;
}

// A business data analyst (BA-320), next to the `assistant`, which it
// leaves unchanged. Its tools are scoped per call to the session's datasets
// via requestContext (see ../tools/dataset.tools).
export const insightsAnalystAgent = new Agent({
  id: 'insights-analyst',
  name: INSIGHTS_ANALYST_NAME,
  description: INSIGHTS_ANALYST_DESCRIPTION,
  instructions: () => insightsAnalystInstructions(),
  // Loaded on demand through Mastra's skill tools (ADR-0025).
  skills: () => insightsAnalystSkills(),
  // Resolved at call time from the persisted LLM settings (agents.md 1.3).
  model: async () => resolveAgentModel(),
  // One thread per session, configured as the assistant's.
  memory: new Memory({
    options: {
      lastMessages: 40,
      semanticRecall: false,
      generateTitle: false,
    },
  }),
  tools: insightsAnalystTools,
});
