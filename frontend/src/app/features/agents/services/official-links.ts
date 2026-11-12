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
 * built-in skills, other Official agents their own tools and skills. Links
 * are mentions: every tool of the agent stays on.
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

/**
 * What the Graph tab of an Official agent draws: its skills with the tools
 * each body links, and every tool, always on.
 */
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
    tools?: string[];
  }[],
): { skills: { name: string; tools: string[] }[]; toolLinks: AgentToolLink[] } {
  const linked = linkedNames(agent.prompt?.editable ?? '', 'tool');
  const graphSkills = officialLinkSkills(skills, agent.key).map((skill) => ({
    name: skill.name,
    tools: [...(skill.tools ?? [])],
  }));
  return {
    skills: graphSkills,
    toolLinks: officialLinkTools(agent).map((tool) => ({
      name: tool.name,
      status: 'always-on' as const,
      linkedVia: {
        instructions: linked.includes(tool.name),
        skills: graphSkills
          .filter((skill) => skill.tools.includes(tool.name))
          .map((skill) => skill.name),
      },
    })),
  };
}

/**
 * Questions to Insights v2 (agents-evals R107): its copy names it without an
 * article, and its prompt links tools only (it has no skills).
 */
const ASSISTANT_V2_KEY = 'assistant-v2';

/**
 * How the copy of the built-in prompt editor names the agent: `the assistant`,
 * `the Data Readiness Agent`, `Questions to Insights v2`.
 */
function agentPhrase(agent: { key: string; name: string }): string {
  if (agent.key === ASSISTANT_KEY) return 'the assistant';
  if (agent.key === ASSISTANT_V2_KEY) return agent.name;
  return `the ${agent.name}`;
}

/** The hint, editor note and reading-state note of an Official agent's prompt. */
export function officialPromptCopy(agent: { key: string; name: string }): {
  toolbarHint: string;
  toolsNote: string;
  generatedToolsNote: string;
} {
  const who = agentPhrase(agent);
  const links =
    agent.key === ASSISTANT_V2_KEY ? 'a tool' : 'a tool or a built-in skill';
  return {
    toolbarHint: `Type / to link ${links}. Links here are mentions; ${who} keeps all its tools.`,
    toolsNote: `The ## Tools list is generated from the tools ${who} gets and is inserted before ## Working rules.`,
    generatedToolsNote: `## Tools — generated from the tools ${who} gets`,
  };
}
