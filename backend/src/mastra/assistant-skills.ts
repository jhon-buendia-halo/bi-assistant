import { createSkill } from '@mastra/core/skills';
import { type AgentSkill, agentSkillsFrom } from './agent-skills';
import { resolveLinks } from './agent-links';
import { catalogSkills, skillBody, skillReferences } from './app-skills';

/**
 * The skills the assistant declares to Mastra on a call (ADR-0025, agents.md
 * 7.3): the on-demand skills that reach it (built-in, with an in-app
 * override's content, and user or project folder skills) plus the call's
 * `agent-skills` (Live copies, or current ones for a preview), sorted by
 * name. An agent skill replaces a same-named folder skill. Links are
 * resolved to plain mentions (ADR-0024) in the instructions and in every
 * reference file. Mastra serves a skill's files at `references/<key>`, so a
 * file is keyed by its name under `references/` (or a folder skill's
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

interface SkillSource {
  name: string;
  description: string;
  body: string;
  files: Record<string, string>;
}

/** The skills of a call, before Mastra wraps them, sorted by name. */
export function assistantSkillSources(
  agentSkills?: readonly AgentSkill[],
): SkillSource[] {
  const own = new Set((agentSkills ?? []).map((skill) => skill.name));
  const folder: SkillSource[] = catalogSkills('assistant')
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
  return [...folder, ...agent].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
}

/** Mastra's `skills` resolver for the assistant: one inline skill per source. */
export function assistantSkills(requestContext?: {
  get(key: string): unknown;
}) {
  return assistantSkillSources(agentSkillsFrom(requestContext)).map((skill) =>
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
