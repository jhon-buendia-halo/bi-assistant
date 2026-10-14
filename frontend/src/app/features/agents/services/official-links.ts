import type { AgentToolLink } from './agents-api.service';
import {
  LINKABLE_TOOLS,
  LinkOption,
  linkableBuiltInSkills,
  linkedNames,
} from './prompt-links';

/**
 * The links of an Official agent's shared prompt (agents-evals R99, R105;
 * agents.md 2.1, 2.8): the assistant links the library tools and its
 * built-in skills, the RFP Builder its own tools and `rfp-process`. Links are
 * mentions: every tool of the agent stays on.
 */

const ASSISTANT_KEY = 'assistant';

/** The first sentence of a tool's description, for the `/` menu. */
function firstSentence(text: string): string {
  const match = /^[\s\S]*?[.!?](?=\s|$)/.exec(text.trim());
  return match ? match[0] : text.trim();
}

/** The tools an Official agent's prompt can link: the assistant's library, else its own tools. */
export function officialLinkTools(agent: {
  key: string;
  toolDetails?: { name: string; description: string }[];
}): LinkOption[] {
  if (agent.key === ASSISTANT_KEY) return LINKABLE_TOOLS;
  return (agent.toolDetails ?? []).map((tool) => ({
    kind: 'tool' as const,
    name: tool.name,
    description: firstSentence(tool.description),
  }));
}

/** The built-in on-demand skills an Official agent's prompt can link: the ones it gets. */
export function officialLinkSkills<
  T extends {
    name: string;
    loading: 'on-demand' | 'harness';
    agents?: string[];
  },
>(skills: readonly T[] | null | undefined, agentKey: string): T[] {
  return linkableBuiltInSkills(skills).filter((skill) =>
    (skill.agents ?? []).includes(agentKey),
  );
}

/** What the Graph tab of an Official agent draws: its skills and every tool, always on. */
export function officialGraphInput(
  agent: {
    key: string;
    toolDetails?: { name: string; description: string }[];
    prompt?: { editable: string };
  },
  skills: readonly {
    name: string;
    loading: 'on-demand' | 'harness';
    agents?: string[];
  }[],
): { skills: { name: string; tools: string[] }[]; toolLinks: AgentToolLink[] } {
  const linked = linkedNames(agent.prompt?.editable ?? '', 'tool');
  return {
    skills: officialLinkSkills(skills, agent.key).map((skill) => ({
      name: skill.name,
      tools: [] as string[],
    })),
    toolLinks: officialLinkTools(agent).map((tool) => ({
      name: tool.name,
      status: 'always-on' as const,
      linkedVia: { instructions: linked.includes(tool.name), skills: [] },
    })),
  };
}

/** How the copy of the built-in prompt editor names the agent: `the assistant`, `the RFP Builder`. */
function agentPhrase(agent: { key: string; name: string }): string {
  return agent.key === ASSISTANT_KEY ? 'the assistant' : `the ${agent.name}`;
}

/** The hint, editor note and reading-state note of an Official agent's prompt. */
export function officialPromptCopy(agent: { key: string; name: string }): {
  toolbarHint: string;
  toolsNote: string;
  generatedToolsNote: string;
} {
  const who = agentPhrase(agent);
  return {
    toolbarHint: `Type / to link a tool or a built-in skill. Links here are mentions; ${who} keeps all its tools.`,
    toolsNote: `The ## Tools list is generated from the tools ${who} gets and is inserted before ## Working rules.`,
    generatedToolsNote: `## Tools — generated from the tools ${who} gets`,
  };
}
