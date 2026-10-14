import {
  OPTIONAL_AGENT_TOOLS,
  OPTIONAL_TOOL_NAMES,
  type OptionalAgentTool,
} from './agent-tools';

/**
 * Links in an agent's instructions and in an in-app skill's body (ADR-0023,
 * agents.md 4.3): `[[skill:<name>]]` and `[[tool:<name>]]`. They are stored
 * as written and turned into plain mentions before the model reads them.
 */

/** Same expression as the frontend's `prompt-links`. */
const LINK_SOURCE = String.raw`\[\[(skill|tool):([A-Za-z0-9_-]+)\]\]`;

/** The assistant tools a link may name (`read_file` and `run_skill_script` are not in it). */
export const LIBRARY_TOOLS = [
  'ask_clarification',
  'create_visual',
  'describe_entity',
  'list_entities',
  'run_readonly_sql',
  'sample_rows',
  'update_visual',
] as const;

/** Given to every agent; linking them changes nothing. */
export const ALWAYS_ON_TOOLS: readonly string[] = [
  'describe_entity',
  'list_entities',
  'run_readonly_sql',
];

export interface ParsedLinks {
  /** Distinct skill names, in order of first appearance. */
  skills: string[];
  /** Distinct tool names, in order of first appearance. */
  tools: string[];
}

export function parseLinks(text: string): ParsedLinks {
  const skills = new Set<string>();
  const tools = new Set<string>();
  for (const match of (text ?? '').matchAll(new RegExp(LINK_SOURCE, 'g'))) {
    (match[1] === 'skill' ? skills : tools).add(match[2]);
  }
  return { skills: [...skills], tools: [...tools] };
}

/** `[[tool:x]]` -> `the "x" tool`, `[[skill:x]]` -> `the "x" skill`. */
export function resolveLinks(text: string): string {
  return (text ?? '').replace(
    new RegExp(LINK_SOURCE, 'g'),
    (_, kind: string, name: string) => `the "${name}" ${kind}`,
  );
}

export function isLibraryTool(name: string): boolean {
  return (LIBRARY_TOOLS as readonly string[]).includes(name);
}

/** The optional tool id a library tool belongs to; undefined for an always-on tool. */
export function optionalToolOf(name: string): OptionalAgentTool | undefined {
  return OPTIONAL_AGENT_TOOLS.find((tool) =>
    OPTIONAL_TOOL_NAMES[tool].includes(name),
  );
}

/** The optional tool ids the tool names stand for, in canonical order. */
export function optionalToolsOf(names: readonly string[]): OptionalAgentTool[] {
  const found = new Set(names.map(optionalToolOf));
  return OPTIONAL_AGENT_TOOLS.filter((tool) => found.has(tool));
}

/**
 * The optional tools a call offers: the agent's direct ones plus those its
 * skills' bodies link. Undefined `direct` (a config saved before BA-217) is
 * every tool.
 */
export function effectiveOptionalTools(
  direct: readonly OptionalAgentTool[] | undefined,
  skills: readonly { body: string }[] | undefined,
): OptionalAgentTool[] {
  if (!direct) return [...OPTIONAL_AGENT_TOOLS];
  const all = new Set<string>(direct);
  for (const skill of skills ?? []) {
    for (const tool of optionalToolsOf(parseLinks(skill.body).tools)) {
      all.add(tool);
    }
  }
  return OPTIONAL_AGENT_TOOLS.filter((tool) => all.has(tool));
}

/** `[[skill:old]]` rewritten to `[[skill:new]]` for each name in `renamed`. */
export function resolveSkillLinkNames(
  text: string,
  renamed: ReadonlyMap<string, string>,
): string {
  if (!renamed.size) return text;
  return (text ?? '').replace(
    new RegExp(LINK_SOURCE, 'g'),
    (whole, kind: string, name: string) =>
      kind === 'skill' && renamed.has(name)
        ? `[[skill:${renamed.get(name)}]]`
        : whole,
  );
}
