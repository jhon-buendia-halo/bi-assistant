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
} from '../tools/dataset.tools';
import { ASSISTANT_V2_PROMPT } from './system-prompts';
import {
  ASSISTANT_V2_AGENT_KEY,
  ASSISTANT_V2_DESCRIPTION,
  ASSISTANT_V2_NAME,
} from './assistant-v2-catalog';

export {
  ASSISTANT_V2_AGENT_KEY,
  ASSISTANT_V2_MAX_STEPS,
} from './assistant-v2-catalog';

/**
 * Its tools: the assistant's own core data tools (the same instances), and
 * nothing else — no sample_rows, visuals, clarification, panel or workflow
 * tool, no skills and no workspace.
 */
export const assistantV2Tools = {
  list_entities: listEntitiesTool,
  describe_entity: describeEntityTool,
  run_readonly_sql: runReadOnlySqlTool,
};

// Links become plain mentions before the model reads them (agents.md 4.1).
const shippedInstructions = withToolSection(
  resolveLinks(ASSISTANT_V2_PROMPT),
  assistantV2Tools,
);

let served: { version: number; text: string } | undefined;

/**
 * The prompt as served: the shipped text, or the in-app override's
 * (ADR-0026), its links resolved to plain mentions, with the `## Tools`
 * section generated from its tools inserted before `## Working rules`, or
 * appended when there is none. Rebuilt only when the overrides change.
 */
export function assistantV2Instructions(): string {
  const override = agentPromptOverrideFor(ASSISTANT_V2_AGENT_KEY);
  if (!override) return shippedInstructions;
  const version = agentPromptOverridesVersion();
  if (served?.version !== version) {
    served = {
      version,
      text: withToolSection(resolveLinks(override.prompt), assistantV2Tools),
    };
  }
  return served.text;
}

// A slimmed-down data analyst under construction (BA-320), next to the
// `assistant`, which it leaves unchanged. Its tools are scoped per call to
// the session's datasets via requestContext (see ../tools/dataset.tools).
export const assistantV2Agent = new Agent({
  id: 'questions-to-insights-v2',
  name: ASSISTANT_V2_NAME,
  description: ASSISTANT_V2_DESCRIPTION,
  instructions: () => assistantV2Instructions(),
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
  tools: assistantV2Tools,
});
