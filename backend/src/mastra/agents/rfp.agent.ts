import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { resolveAgentModel } from '../model-resolver';
import { resolveLinks } from '../agent-links';
import { rfpTools } from '../tools/rfp.tools';
import { catalogFrameworkSkills } from '../skill-sources';
import { withToolSection } from '../tool-section';
import {
  agentPromptOverrideFor,
  agentPromptOverridesVersion,
} from '../agent-prompt-overrides';
import { RFP_PROMPT } from './system-prompts';

/** The RFP Builder's registry key (agents.md 1.2). */
export const RFP_AGENT_KEY = 'rfp';

/** Its tool-loop budget per turn (agents.md 2.8). */
export const RFP_MAX_STEPS = 15;

// Links become plain mentions before the model reads them (agents.md 2.8, 4.1).
const shippedInstructions = withToolSection(resolveLinks(RFP_PROMPT), rfpTools);

let served: { version: number; text: string } | undefined;

/**
 * The prompt as served (agents.md 2.8): the shipped text, or the in-app
 * override's (ADR-0026), its links resolved to plain mentions, with the
 * `## Tools` section generated from its tools inserted before
 * `## Working rules`. Rebuilt only when the overrides change.
 */
export function rfpInstructions(): string {
  const override = agentPromptOverrideFor(RFP_AGENT_KEY);
  if (!override) return shippedInstructions;
  const version = agentPromptOverridesVersion();
  if (served?.version !== version) {
    served = {
      version,
      text: withToolSection(resolveLinks(override.prompt), rfpTools),
    };
  }
  return served.text;
}

/** Its on-demand skills (one per stage), built per call (agents.md 7.3, 7.4). */
export function rfpSkills() {
  return catalogFrameworkSkills(RFP_AGENT_KEY);
}

// A Mercer benefits consultant's partner for building one carrier RFP over
// the Intellify data (agents.md 2.8, ADR-0028). It reaches the data only
// through the Intellify RFP API with its own tools: no SQL, no workspace.
export const rfpAgent = new Agent({
  id: 'rfp-builder',
  name: 'RFP Builder',
  description:
    'Walks a Mercer benefits consultant through building a carrier RFP for one client over the Intellify data, stage by stage, and assembles the RFP package.',
  instructions: () => rfpInstructions(),
  // Loaded on demand through Mastra's skill tools (ADR-0025).
  skills: () => rfpSkills(),
  // Resolved at call time from the persisted LLM settings (agents.md 1.3).
  model: async () => resolveAgentModel(),
  memory: new Memory({
    options: {
      lastMessages: 40,
      semanticRecall: false,
      generateTitle: false,
    },
  }),
  tools: rfpTools,
});
