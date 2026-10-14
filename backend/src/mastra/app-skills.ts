import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, normalize, sep } from 'path';

/**
 * App-owned agent skills (ADR-0018, agents.md sections 7.3 and 7.4).
 *
 * Skills ship with the backend build under `skills/<name>/`. Each agent
 * declares its own on-demand skills below; harness-loaded skills are read by
 * their callers through `appSkillDocument` / `appSkillFile` and never appear
 * in a catalog. The whole folder is validated when this module is first used,
 * so a broken skill stops the backend at startup instead of silently never
 * triggering.
 */

/** On-demand skills each agent's catalog lists, by registry key. */
export const AGENT_SKILLS: Readonly<Record<string, readonly string[]>> = {
  assistant: [],
};

export interface AppSkill {
  name: string;
  description: string;
  /** Absolute path of the skill's folder. */
  dir: string;
  /** The whole `SKILL.md`, front matter included. */
  document: string;
}

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
const FRONT_MATTER_KEYS = ['name', 'description'];
const LINKED_FILE = /\b(?:phases|references)\/[A-Za-z0-9._/-]+\.md\b/g;

const rootCandidates = () => [
  // dist/mastra/skills (built) and src/mastra/skills (ts-node, Jest).
  join(__dirname, 'skills'),
  // Mastra Studio bundles this file away from its folder and serves from
  // src/mastra/public, beside src/mastra/skills.
  join(process.cwd(), '..', 'skills'),
  join(process.cwd(), 'src', 'mastra', 'skills'),
];

/** The bundled skills folder; the first candidate when none exists. */
export function skillsRoot(): string {
  const candidates = rootCandidates();
  return candidates.find((dir) => existsSync(dir)) ?? candidates[0];
}

function parseFrontMatter(text: string, problems: string[]) {
  const match = FRONT_MATTER.exec(text);
  if (!match) {
    problems.push('front matter is missing');
    return {};
  }
  const values: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim()) continue;
    const pair = /^([A-Za-z_-]+):\s*(.*)$/.exec(line);
    if (!pair) {
      const key = Object.keys(values).at(-1);
      problems.push(
        key
          ? `${key} must be on one line`
          : `unreadable front matter "${line}"`,
      );
      continue;
    }
    const [, key, raw] = pair;
    if (!FRONT_MATTER_KEYS.includes(key)) {
      problems.push(`unknown front-matter key "${key}"`);
      continue;
    }
    const value = raw.trim().replace(/^(['"])(.*)\1$/, '$2');
    if (/^[|>]/.test(value)) {
      problems.push(`${key} must be on one line`);
      values[key] = '';
      continue;
    }
    values[key] = value;
  }
  return values;
}

function readSkill(root: string, folder: string, problems: string[]) {
  const dir = join(root, folder);
  const file = join(dir, 'SKILL.md');
  const own: string[] = [];
  if (!existsSync(file)) {
    problems.push(`${folder}: SKILL.md is missing`);
    return undefined;
  }
  const document = readFileSync(file, 'utf8');
  const values = parseFrontMatter(document, own);
  if (FRONT_MATTER.test(document)) {
    if (values.name === undefined) own.push('name is missing');
    else if (values.name !== folder) {
      own.push(`name "${values.name}" does not match its folder`);
    }
    if (values.description === undefined) own.push('description is missing');
    else if (values.description && !values.description.startsWith('Use when')) {
      own.push('description must start with "Use when"');
    }
  }
  const body = document.replace(FRONT_MATTER, '');
  for (const linked of new Set(body.match(LINKED_FILE) ?? [])) {
    if (!existsSync(join(dir, linked))) own.push(`${linked} is missing`);
  }
  problems.push(...[...new Set(own)].map((problem) => `${folder}: ${problem}`));
  if (own.length) return undefined;
  return {
    name: folder,
    description: values.description ?? '',
    dir,
    document,
  } satisfies AppSkill;
}

/**
 * Read and validate every skill under `root`. Throws `Invalid app skills:`
 * with one `<skill>: <problem>` line per problem.
 */
export function loadAppSkills(root: string): Map<string, AppSkill> {
  const problems: string[] = [];
  const skills = new Map<string, AppSkill>();
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    problems.push(`${root}: skills folder not found`);
  } else {
    const folders = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    for (const folder of folders) {
      const skill = readSkill(root, folder, problems);
      if (skill) skills.set(skill.name, skill);
    }
  }
  if (problems.length) {
    throw new Error(['Invalid app skills:', ...problems].join('\n'));
  }
  return skills;
}

/** Every skill an agent declares must exist. */
export function validateAgentSkills(
  skills: ReadonlyMap<string, AppSkill>,
  declared: Readonly<Record<string, readonly string[]>>,
): void {
  for (const [agent, names] of Object.entries(declared)) {
    for (const name of names) {
      if (!skills.has(name)) {
        throw new Error(
          `Unknown skill "${name}" declared for agent "${agent}"`,
        );
      }
    }
  }
}

let bundled: Map<string, AppSkill> | undefined;

/** The bundled skills, loaded and validated once per process. */
export function appSkills(): ReadonlyMap<string, AppSkill> {
  if (!bundled) {
    const skills = loadAppSkills(skillsRoot());
    validateAgentSkills(skills, AGENT_SKILLS);
    bundled = skills;
  }
  return bundled;
}

function bundledSkill(name: string): AppSkill {
  const skill = appSkills().get(name);
  if (!skill) throw new Error(`Unknown app skill "${name}"`);
  return skill;
}

/** Folders of the on-demand skills an agent declares (Mastra `skills`). */
export function skillPathsFor(agent: string): string[] {
  return (AGENT_SKILLS[agent] ?? []).map((name) => bundledSkill(name).dir);
}

/** A harness-loaded skill's whole `SKILL.md`. */
export function appSkillDocument(name: string): string {
  return bundledSkill(name).document;
}

/**
 * A harness-loaded skill's `SKILL.md` without its front matter, trimmed: the
 * text a caller sends as the skill's system message.
 */
export function appSkillBody(name: string): string {
  return skillBody(bundledSkill(name).document);
}

/** A `SKILL.md` document without its front matter, trimmed. */
export function skillBody(document: string): string {
  return document.replace(FRONT_MATTER, '').trim();
}

/** One linked file of a skill, by its path in the skill's folder. */
export function appSkillFile(name: string, path: string): string {
  const skill = bundledSkill(name);
  const relative = normalize(path);
  if (
    relative.startsWith('..') ||
    relative.startsWith(sep) ||
    /^[A-Za-z]:/.test(relative)
  ) {
    throw new Error(`Invalid skill file path "${path}"`);
  }
  return readFileSync(join(skill.dir, relative), 'utf8');
}
