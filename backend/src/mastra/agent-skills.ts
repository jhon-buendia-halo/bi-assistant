/**
 * A user agent's in-app skills on a call (ADR-0021, agents.md 4.2 and 7.3):
 * the `agent-skills` requestContext key and the shape of a call's copies.
 * They reach the model through Mastra's skills (ADR-0024).
 */

/** requestContext key carrying the agent's skills of a call (agents.md 4.2). */
export const AGENT_SKILLS_CONTEXT_KEY = 'agent-skills';

export interface AgentSkillFile {
  path: string;
  content: string;
}

/** One skill as a call sees it: a copy, never read from the store again. */
export interface AgentSkill {
  id: string;
  name: string;
  description: string;
  body: string;
  files: AgentSkillFile[];
}

/** The skills on a call's context, or undefined when it has none. */
export function agentSkillsFrom(requestContext?: {
  get(key: string): unknown;
}): AgentSkill[] | undefined {
  const value = requestContext?.get(AGENT_SKILLS_CONTEXT_KEY);
  if (!Array.isArray(value)) return undefined;
  const skills = value.filter(
    (skill): skill is AgentSkill =>
      !!skill &&
      typeof (skill as AgentSkill).name === 'string' &&
      typeof (skill as AgentSkill).description === 'string' &&
      typeof (skill as AgentSkill).body === 'string',
  );
  return skills.length ? skills : undefined;
}

/** What an in-app skill's `SKILL.md` holds: front matter, then the body. */
export function renderSkillDocument(
  skill: Pick<AgentSkill, 'name' | 'description' | 'body'>,
): string {
  return `---\nname: ${skill.name}\ndescription: ${skill.description}\n---\n\n${skill.body}`;
}
