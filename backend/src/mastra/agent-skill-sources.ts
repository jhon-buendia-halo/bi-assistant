import { createSkill } from '@mastra/core/skills';
import type { AgentSkill } from './agent-skills';
import { resolveLinks } from './agent-links';
import { catalogSkills, skillBody, skillReferences } from './app-skills';

/**
 * The skills an agent declares to Mastra on a call (ADR-0025, agents.md
 * 7.3): the on-demand skills of its catalogue (built-in, with an in-app
 * override's content, and user or project folder skills), then the call's
 * `agent-skills` (a user agent's Live copies, or current ones for a
 * preview). An agent skill replaces a catalogue skill of the same name.
 * Links are resolved to plain mentions (ADR-0024) in the instructions and in
 * every reference file. Mastra serves a skill's files at `references/<key>`,
 * so a file is keyed by its name under `references/` (or a folder skill's
 * `reference/`), and a folder skill's `reference/` mentions are pointed there.
 */

/** The key Mastra serves a file under, as `references/<key>`. */
export function referenceKey(path: string): string {
  return path.replace(/^references?\//, '');
}

/** Points `reference/<file>` mentions at `references/<file>`, where Mastra serves them. */
export function servedPaths(text: string): string {
  return text.replace(/\breference\//g, 'references/');
}

/** One skill of a call, before Mastra wraps it. */
export interface SkillSource {
  name: string;
  description: string;
  body: string;
  files: Record<string, string>;
}

/**
 * The skills of a call for `agentKey`, before Mastra wraps them: its
 * catalogue skills in catalogue order, without those an agent skill
 * replaces, then the agent skills in their order.
 */
export function skillSourcesFor(
  agentKey: string,
  agentSkills?: readonly AgentSkill[],
): SkillSource[] {
  const own = new Set((agentSkills ?? []).map((skill) => skill.name));
  const catalogue: SkillSource[] = catalogSkills(agentKey)
    .filter((skill) => !own.has(skill.name))
    .map((skill) => ({
      name: skill.name,
      description: skill.description,
      body: skillBody(skill.document),
      files: skillReferences(skill),
    }));
  const agent: SkillSource[] = (agentSkills ?? []).map((skill) => ({
    name: skill.name,
    description: skill.description,
    body: skill.body,
    files: Object.fromEntries(
      skill.files.map((file) => [file.path, file.content]),
    ),
  }));
  return [...catalogue, ...agent];
}

/** Mastra's skills for `sources`: one inline skill per source, in order. */
export function frameworkSkills(sources: readonly SkillSource[]) {
  return sources.map((skill) =>
    createSkill({
      name: skill.name,
      description: skill.description,
      instructions: servedPaths(resolveLinks(skill.body)),
      references: Object.fromEntries(
        Object.entries(skill.files).map(([path, content]) => [
          referenceKey(path),
          servedPaths(resolveLinks(content)),
        ]),
      ),
    }),
  );
}
