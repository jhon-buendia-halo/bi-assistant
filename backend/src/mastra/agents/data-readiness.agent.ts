import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { resolveAgentModel } from '../model-resolver';
import { resolveLinks } from '../agent-links';
import { readinessTools } from '../tools/readiness.tools';
import { catalogFrameworkSkills } from '../skill-sources';
import { withToolSection } from '../tool-section';
import {
  agentPromptOverrideFor,
  agentPromptOverridesVersion,
} from '../agent-prompt-overrides';
import { DATA_READINESS_PROMPT } from './system-prompts';

/** The Data Readiness Agent's registry key (agents.md 1.2). */
export const DATA_READINESS_AGENT_KEY = 'data-readiness';

/** Its tool-loop budget per turn (agents.md 2.10). */
export const DATA_READINESS_MAX_STEPS = 10;

// Links become plain mentions before the model reads them (agents.md 2.10, 4.1).
const shippedInstructions = withToolSection(
  resolveLinks(DATA_READINESS_PROMPT),
  readinessTools,
);

let served: { version: number; text: string } | undefined;

/**
 * The prompt as served (agents.md 2.10): the shipped text, or the in-app
 * override's (ADR-0026), its links resolved to plain mentions, with the
 * `## Tools` section generated from its tools inserted before
 * `## Working rules`. Rebuilt only when the overrides change.
 */
export function dataReadinessInstructions(): string {
  const override = agentPromptOverrideFor(DATA_READINESS_AGENT_KEY);
  if (!override) return shippedInstructions;
  const version = agentPromptOverridesVersion();
  if (served?.version !== version) {
    served = {
      version,
      text: withToolSection(resolveLinks(override.prompt), readinessTools),
    };
  }
  return served.text;
}

/** Its on-demand skills, built per call (agents.md 7.3, 7.4). */
export function dataReadinessSkills() {
  return catalogFrameworkSkills(DATA_READINESS_AGENT_KEY);
}

// Explains how ready a session's PostgreSQL or Databricks data is, on the
// DMBOK dimensions (agents.md 2.10, ADR-0031). A deterministic engine behind
// its tools computes every score. It may run read-only SQL only to show the
// records behind a finding (ADR-0035); it has no visual tools and no
// workspace.
export const dataReadinessAgent = new Agent({
  id: 'data-readiness-agent',
  name: 'Data Readiness Agent',
  description:
    'Assesses how ready a PostgreSQL or Databricks dataset is for analysis, scoring it on the DMBOK data-quality dimensions with a deterministic engine and explaining the findings.',
  instructions: () => dataReadinessInstructions(),
  // Loaded on demand through Mastra's skill tools (ADR-0025).
  skills: () => dataReadinessSkills(),
  // Resolved at call time from the persisted LLM settings (agents.md 1.3).
  model: async () => resolveAgentModel(),
  memory: new Memory({
    options: {
      lastMessages: 40,
      semanticRecall: false,
      generateTitle: false,
    },
  }),
  tools: readinessTools,
});
