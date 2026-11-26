import {
  LinkOption,
  linkableBuiltInSkills,
} from './prompt-links';

/**
 * The links of an Official agent's shared prompt (agents-evals R99, R105;
 * agents.md 2.1, 2.8): an Official agent links its own tools and
 * skills (Elena's are the library tools a user agent builds on). Links
 * are mentions: every tool of the agent stays on.
 */

/** The first sentence of a tool's description, for the `/` menu. */
function firstSentence(text: string): string {
  const match = /^[\s\S]*?[.!?](?=\s|$)/.exec(text.trim());
  return match ? match[0] : text.trim();
}

/** The tools an Official agent's prompt can link: the ones it gets. */
export function officialLinkTools(agent: {
  key: string;
  toolDetails?: { name: string; description: string }[];
}): LinkOption[] {
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

/**
 * How the copy of the built-in prompt editor names the agent: by its
 * persona's human name, with no article (`Elena`, `Michael`; agents-evals R107).
 */
function agentPhrase(agent: { key: string; name: string }): string {
  return agent.name;
}

/** The hint, editor note and reading-state note of an Official agent's prompt. */
export function officialPromptCopy(agent: { key: string; name: string }): {
  toolbarHint: string;
  toolsNote: string;
  generatedToolsNote: string;
} {
  const who = agentPhrase(agent);
  return {
    toolbarHint: `Type / to link a tool or a built-in skill. Links here are mentions; ${who} keeps every tool.`,
    toolsNote: `The ## Tools list is generated from the tools ${who} gets and is inserted before ## Working rules.`,
    generatedToolsNote: `## Tools — generated from the tools ${who} gets`,
  };
}
