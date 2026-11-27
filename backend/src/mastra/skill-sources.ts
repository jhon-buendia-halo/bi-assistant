import { frameworkSkills, skillSourcesFor } from './agent-skill-sources';

/**
 * The on-demand built-in skills of an agent, as Mastra skills (ADR-0025,
 * agents.md 7.3): `catalogSkills(agent)` (an in-app override's content
 * included), in catalogue order, wrapped by `frameworkSkills` — links
 * resolved to plain mentions, reference files served at
 * `references/<file name>` and the body's `reference/` mentions pointed
 * there. Built per call, so an override applies to the next call.
 */
export function catalogFrameworkSkills(agent: string) {
  return frameworkSkills(skillSourcesFor(agent));
}
