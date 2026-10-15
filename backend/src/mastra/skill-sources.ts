import { createSkill } from '@mastra/core/skills';
import { resolveLinks } from './agent-links';
import { catalogSkills, skillBody, skillReferences } from './app-skills';
import { referenceKey, servedPaths } from './assistant-skills';

/**
 * The on-demand built-in skills of an agent other than the assistant, as
 * Mastra skills (ADR-0025, agents.md 7.3): `catalogSkills(agent)` (an in-app
 * override's content included), sorted by name, wrapped the way the
 * assistant's are — links resolved to plain mentions, reference files served
 * at `references/<file name>` and the body's `reference/` mentions pointed
 * there. Built per call, so an override applies to the next call.
 */
export function catalogFrameworkSkills(agent: string) {
  return catalogSkills(agent).map((skill) =>
    createSkill({
      name: skill.name,
      description: skill.description,
      instructions: servedPaths(resolveLinks(skillBody(skill.document))),
      references: Object.fromEntries(
        Object.entries(skillReferences(skill)).map(([path, content]) => [
          referenceKey(path),
          servedPaths(resolveLinks(content)),
        ]),
      ),
    }),
  );
}
