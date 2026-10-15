/**
 * Links in an agent's instructions or a skill's body (ADR-0024). Mirrors the
 * backend: `[[skill:<name>]]` and `[[tool:<name>]]`.
 */
const LINK = /\[\[(skill|tool):([A-Za-z0-9_-]+)\]\]/g;

export type LinkKind = 'skill' | 'tool';

export type PromptSegment =
  | { kind: 'text'; text: string }
  | { kind: LinkKind; name: string };

/** One entry of the "/" menu. */
export interface LinkOption {
  kind: LinkKind;
  name: string;
  description: string;
  /** A built-in on-demand skill: every agent has it, so a link is a mention. */
  builtIn?: boolean;
}

/** Every assistant tool an author can link (`read_file` is not one). */
export const LINKABLE_TOOLS: LinkOption[] = [
  {
    kind: 'tool',
    name: 'list_entities',
    description: "Lists the entities in the session's datasets.",
  },
  {
    kind: 'tool',
    name: 'describe_entity',
    description: 'Describes an entity: its columns, types and sample values.',
  },
  {
    kind: 'tool',
    name: 'sample_rows',
    description: 'Reads a few rows of an entity to see real values.',
  },
  {
    kind: 'tool',
    name: 'run_readonly_sql',
    description: 'Runs a read-only SQL query over the datasets.',
  },
  {
    kind: 'tool',
    name: 'create_visual',
    description: 'Creates an interactive visual from an answer.',
  },
  {
    kind: 'tool',
    name: 'update_visual',
    description: 'Changes an existing visual.',
  },
  {
    kind: 'tool',
    name: 'show_in_panel',
    description:
      'Shows a file, document, table, visual or workflow progress in the right panel.',
  },
  {
    kind: 'tool',
    name: 'ask_clarification',
    description: 'Asks the user a clarifying question with options.',
  },
];

export function promptLink(kind: LinkKind, name: string): string {
  return `[[${kind}:${name}]]`;
}

/** The distinct names of one kind linked in `text`, in order of appearance. */
export function linkedNames(text: string, kind: LinkKind): string[] {
  const names = [...text.matchAll(LINK)]
    .filter((match) => match[1] === kind)
    .map((match) => match[2]);
  return [...new Set(names)];
}

/** Splits text into plain text and links, so links render as chips. */
export function promptSegments(text: string): PromptSegment[] {
  const segments: PromptSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(LINK)) {
    if (match.index > last) {
      segments.push({ kind: 'text', text: text.slice(last, match.index) });
    }
    segments.push({ kind: match[1] as LinkKind, name: match[2] });
    last = match.index + match[0].length;
  }
  if (last < text.length) {
    segments.push({ kind: 'text', text: text.slice(last) });
  }
  return segments;
}

/** The chip classes of a link: skill, tool, or danger when it does not exist. */
export function chipClass(
  kind: LinkKind,
  name: string,
  known: ReadonlySet<string>,
): string {
  if (!known.has(`${kind}:${name}`)) return 'chip chip-danger';
  return kind === 'skill' ? 'chip chip-info' : 'chip chip-neutral';
}

/** The names that exist, as `kind:name`, for `chipClass`. */
export function knownLinks(
  skills: { name: string }[],
  tools: { name: string }[] = LINKABLE_TOOLS,
  builtInSkills: { name: string }[] = [],
): Set<string> {
  return new Set([
    ...skills.map((skill) => `skill:${skill.name}`),
    ...builtInSkills.map((skill) => `skill:${skill.name}`),
    ...tools.map((tool) => `tool:${tool.name}`),
  ]);
}

/**
 * The new text of a legacy draft: its tools and skills that its instructions
 * do not link yet, appended as a last line of links. Null when none is missing.
 */
export function withLegacyLinks(
  instructions: string,
  tools: string[],
  skillNames: string[],
): string | null {
  const have = new Set([
    ...linkedNames(instructions, 'skill').map((name) => `skill:${name}`),
    ...linkedNames(instructions, 'tool').map((name) => `tool:${name}`),
  ]);
  const links = [
    ...skillNames.map((name) => ['skill', name]),
    ...tools.map((name) => ['tool', name]),
  ]
    .filter(([kind, name]) => !have.has(`${kind}:${name}`))
    .map(([kind, name]) => promptLink(kind as LinkKind, name));
  if (links.length === 0) return null;
  const line = `Tools and skills: ${links.join(' ')}`;
  return instructions === '' ? line : `${instructions}\n${line}`;
}

/** The built-in skills a prompt can link: the on-demand ones (the harness ones load on their own). */
export function linkableBuiltInSkills<
  T extends { name: string; loading: 'on-demand' | 'harness' },
>(skills: readonly T[] | null | undefined): T[] {
  return (skills ?? []).filter((skill) => skill.loading === 'on-demand');
}
