import type { AppSkill } from './app-skills';
import { resolveLinks } from './agent-links';

/**
 * A user agent's in-app skills on a call (ADR-0021, agents.md 4.2 and 7.3):
 * the `agent-skills` requestContext key, the virtual `/in-app-skills/<name>/`
 * paths `read_file` answers from the call's copies, and the catalog merge.
 */

/** requestContext key carrying the agent's skills of a call (agents.md 4.2). */
export const AGENT_SKILLS_CONTEXT_KEY = 'agent-skills';

/** The virtual folder an in-app skill's `<location>` lives under. */
export const IN_APP_SKILLS_ROOT = '/in-app-skills';

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

/** The catalog `<location>` of an in-app skill's `SKILL.md`. */
export function inAppLocation(name: string): string {
  return `${IN_APP_SKILLS_ROOT}/${name}/SKILL.md`;
}

/** What reading an in-app skill's `SKILL.md` returns (agents.md 7.3). */
export function renderSkillDocument(
  skill: Pick<AgentSkill, 'name' | 'description' | 'body'>,
): string {
  return `---\nname: ${skill.name}\ndescription: ${skill.description}\n---\n\n${skill.body}`;
}

/** A catalog entry: an installed skill's folder, or an in-app skill's location. */
export interface CatalogEntry {
  name: string;
  description: string;
  dir?: string;
  location?: string;
}

/**
 * The call's catalog: the assistant's on-demand skills plus the agent's, an
 * agent skill replacing a same-named user or project skill. Order is left to
 * the renderer, which sorts by name.
 */
export function mergedCatalog(
  base: readonly AppSkill[],
  agentSkills: readonly AgentSkill[],
): CatalogEntry[] {
  const own = new Set(agentSkills.map((skill) => skill.name));
  return [
    ...base.filter((skill) => !own.has(skill.name)),
    ...agentSkills.map((skill) => ({
      name: skill.name,
      description: skill.description,
      location: inAppLocation(skill.name),
    })),
  ];
}

const VIRTUAL_FILE = /^\/in-app-skills\/([^/]+)\/(SKILL\.md|reference\/[^/]+)$/;

/**
 * The content of a virtual in-app path, from the call's copies. Null when
 * the path is not one of `skills`' files (an unknown skill or file, or any
 * other path under `/in-app-skills/`): the caller answers its usual error.
 * Undefined when the path is not under `/in-app-skills/` at all.
 */
export function readInAppPath(
  skills: readonly AgentSkill[] | undefined,
  path: string,
): { path: string; content: string } | null | undefined {
  if (typeof path !== 'string' || !path.startsWith(`${IN_APP_SKILLS_ROOT}/`)) {
    return undefined;
  }
  const match = VIRTUAL_FILE.exec(path);
  const skill = match && skills?.find((entry) => entry.name === match[1]);
  if (!match || !skill) return null;
  if (match[2] === 'SKILL.md') {
    // Links become plain mentions: the model never reads `[[` (ADR-0023).
    return {
      path,
      content: renderSkillDocument({
        ...skill,
        body: resolveLinks(skill.body),
      }),
    };
  }
  const file = skill.files.find((entry) => entry.path === match[2]);
  return file ? { path, content: resolveLinks(file.content) } : null;
}
