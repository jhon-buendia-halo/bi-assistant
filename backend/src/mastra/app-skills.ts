import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from 'fs';
import { isAbsolute, join, normalize, sep } from 'path';

/**
 * Agent skills (ADR-0018, agents.md sections 7.3 and 7.4).
 *
 * The app uses only its built-in skills: the bundle under `skills/<name>/`,
 * read and validated once when this module is first used. A broken built-in
 * skill stops the backend. There are no user or project skills; a
 * `<data dir>/skills/` folder left by an older version is ignored.
 *
 * Harness-loaded skills are read by their callers through `appSkillDocument`
 * / `appSkillBody` / `appSkillFile` and never appear in a catalog.
 */

export type SkillLoading = 'on-demand' | 'harness';

/** Built-in on-demand skills each agent's catalog lists, by registry key. */
export const AGENT_SKILLS: Readonly<Record<string, readonly string[]>> = {
  // How to apply the curated-knowledge block: the model reads it with
  // read_file when a call carries the block (ADR-0020).
  assistant: ['curated-knowledge'],
};

/** Built-in skills code sends to each agent itself (agents.md 7.4). */
export const HARNESS_SKILLS: Readonly<Record<string, readonly string[]>> = {
  assistant: ['deep-analysis'],
  visualization: ['interactive-visuals'],
};

/** Files over this size, or holding a NUL byte, are listed but not shown. */
const MAX_SHOWN_FILE_BYTES = 256 * 1024;

export interface AppSkill {
  name: string;
  description: string;
  /** Absolute path of the skill's folder. */
  dir: string;
  /** The whole `SKILL.md`, front matter included. */
  document: string;
  loading: SkillLoading;
  /** Registry keys of the agents that get this skill. */
  agents: string[];
}

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
const LINKED_FILE = /\b(?:phases|references?)\/[A-Za-z0-9._/-]+\.md\b/g;

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

interface FrontMatter {
  name?: string;
  description?: string;
}

/**
 * Read the front matter: only `name` and `description` are allowed.
 * `description` may wrap onto indented lines or use a `>` / `|` block; its
 * lines are joined with single spaces.
 */
function parseFrontMatter(text: string, problems: string[]): FrontMatter {
  const match = FRONT_MATTER.exec(text);
  if (!match) {
    problems.push('front matter is missing');
    return {};
  }
  const known = ['name', 'description'];
  const values: FrontMatter = {};
  let lastKey: string | undefined;
  let lastKnown = false;
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim()) continue;
    const pair = /^([A-Za-z_-]+):\s*(.*)$/.exec(line);
    if (!pair) {
      if (lastKey && !lastKnown) continue;
      if (lastKey === 'description' && /^\s/.test(line)) {
        values.description = [values.description, line.trim()]
          .filter(Boolean)
          .join(' ');
        continue;
      }
      problems.push(
        lastKey
          ? `${lastKey} must be on one line`
          : `unreadable front matter "${line}"`,
      );
      continue;
    }
    const [, key, raw] = pair;
    lastKey = key;
    lastKnown = known.includes(key);
    if (!lastKnown) {
      problems.push(`unknown front-matter key "${key}"`);
      continue;
    }
    const value = raw.trim().replace(/^(['"])(.*)\1$/, '$2');
    if (key === 'description') {
      // A `>` or `|` block starts empty; its indented lines follow.
      values.description = /^[|>][+-]?$/.test(value) ? '' : value;
      continue;
    }
    if (/^[|>]/.test(value) || !value) {
      problems.push(`${key} must be on one line`);
      values.name = '';
      continue;
    }
    values.name = value;
  }
  return values;
}

interface ReadSkill {
  dir: string;
  document?: string;
  description: string;
  problems: string[];
}

function readSkill(root: string, folder: string): ReadSkill {
  const dir = join(root, folder);
  const file = join(dir, 'SKILL.md');
  const problems: string[] = [];
  const result: ReadSkill = { dir, description: '', problems };
  if (!isRegularFile(file)) {
    problems.push('SKILL.md is missing');
    return result;
  }
  const document = readFileSync(file, 'utf8');
  result.document = document;
  const values = parseFrontMatter(document, problems);
  if (FRONT_MATTER.test(document)) {
    if (values.name === undefined) problems.push('name is missing');
    else if (values.name !== folder) {
      problems.push(`name "${values.name}" does not match its folder`);
    }
    if (!values.description) problems.push('description is missing');
    else if (!values.description.startsWith('Use when')) {
      problems.push('description must start with "Use when"');
    }
  }
  result.description = values.description ?? '';
  const body = document.replace(FRONT_MATTER, '');
  for (const linked of new Set(body.match(LINKED_FILE) ?? [])) {
    if (!isRegularFile(join(dir, linked)))
      problems.push(`${linked} is missing`);
  }
  result.problems = [...new Set(problems)];
  return result;
}

function isRegularFile(path: string): boolean {
  try {
    return lstatSync(path).isFile();
  } catch {
    return false;
  }
}

/** Skill folders under `root`: real directories, dot-folders excluded, sorted. */
function skillFolders(root: string): string[] {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort();
}

/** The agents and loading mode of a skill, from the two tables. */
function skillTargets(name: string): Pick<AppSkill, 'agents' | 'loading'> {
  const onDemand = Object.keys(AGENT_SKILLS).filter((agent) =>
    AGENT_SKILLS[agent].includes(name),
  );
  const harness = Object.keys(HARNESS_SKILLS).filter((agent) =>
    HARNESS_SKILLS[agent].includes(name),
  );
  return onDemand.length
    ? { agents: onDemand, loading: 'on-demand' }
    : { agents: harness, loading: 'harness' };
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
    for (const folder of skillFolders(root)) {
      const read = readSkill(root, folder);
      problems.push(...read.problems.map((problem) => `${folder}: ${problem}`));
      if (read.problems.length || read.document === undefined) continue;
      skills.set(folder, {
        name: folder,
        description: read.description,
        dir: read.dir,
        document: read.document,
        ...skillTargets(folder),
      });
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

/**
 * Every regular file in a skill's folder, relative and `/`-separated:
 * `SKILL.md` first, then sorted. Symbolic links are skipped, so a file can
 * never be read from outside the folder.
 */
export function skillFiles(dir: string): { path: string; size: number }[] {
  const files: { path: string; size: number }[] = [];
  const walk = (relative: string) => {
    for (const entry of readdirSync(join(dir, relative), {
      withFileTypes: true,
    })) {
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) {
        files.push({ path, size: statSync(join(dir, path)).size });
      }
    }
  };
  walk('');
  return files.sort((a, b) =>
    a.path === 'SKILL.md'
      ? -1
      : b.path === 'SKILL.md'
        ? 1
        : a.path < b.path
          ? -1
          : a.path > b.path
            ? 1
            : 0,
  );
}

let loaded: Map<string, AppSkill> | undefined;

/** The built-in skills, loaded once per process; a broken one throws here. */
export function appSkills(): ReadonlyMap<string, AppSkill> {
  if (!loaded) {
    const skills = loadAppSkills(skillsRoot());
    validateAgentSkills(skills, AGENT_SKILLS);
    validateAgentSkills(skills, HARNESS_SKILLS);
    loaded = skills;
  }
  return loaded;
}

function appSkill(name: string): AppSkill {
  const skill = appSkills().get(name);
  if (!skill) throw new Error(`Unknown app skill "${name}"`);
  return skill;
}

/**
 * The on-demand skills an agent gets, sorted by name: the catalog the app
 * renders into its prompt and the only folders `read_file` may read
 * (agents.md 7.3, 7.5).
 */
export function catalogSkills(agent: string): AppSkill[] {
  return [...appSkills().values()]
    .filter(
      (skill) => skill.loading === 'on-demand' && skill.agents.includes(agent),
    )
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** A harness-loaded skill's whole `SKILL.md`. */
export function appSkillDocument(name: string): string {
  return appSkill(name).document;
}

/**
 * A harness-loaded skill's `SKILL.md` without its front matter, trimmed: the
 * text a caller sends as the skill's system message.
 */
export function appSkillBody(name: string): string {
  return skillBody(appSkill(name).document);
}

/** A `SKILL.md` document without its front matter, trimmed. */
export function skillBody(document: string): string {
  return document.replace(FRONT_MATTER, '').trim();
}

/** A relative path inside a skill folder, or null when it could escape it. */
function safeRelativePath(path: string): string | null {
  if (!path || isAbsolute(path) || /^[A-Za-z]:/.test(path)) return null;
  const relative = normalize(path);
  if (relative.startsWith('..') || relative.startsWith(sep)) return null;
  return relative;
}

/** One linked file of a skill, by its path in the skill's folder. */
export function appSkillFile(name: string, path: string): string {
  const skill = appSkill(name);
  const relative = safeRelativePath(path);
  if (relative === null) throw new Error(`Invalid skill file path "${path}"`);
  return readFileSync(join(skill.dir, relative), 'utf8');
}

export interface AgentSkillsView {
  skills: {
    name: string;
    description: string;
    loading: SkillLoading;
    files: { path: string; size: number }[];
  }[];
}

/** What `GET /agents/:key/skills` returns for a registry key (api.md 34a). */
export function agentSkillsView(agent: string): AgentSkillsView {
  return {
    skills: [...appSkills().values()]
      .filter((skill) => skill.agents.includes(agent))
      .sort((a, b) => (a.name < b.name ? -1 : 1))
      .map((skill) => ({
        name: skill.name,
        description: skill.description,
        loading: skill.loading,
        files: skillFiles(skill.dir),
      })),
  };
}

export type SkillFileResult =
  | { path: string; size: number; content: string | null }
  | { error: 'no-skill' | 'invalid-path' | 'no-file' };

/** One file of one of an agent's skills (api.md 34b). */
export function agentSkillFile(
  agent: string,
  name: string,
  path: string,
): SkillFileResult {
  const skill = appSkills().get(name);
  if (!skill || !skill.agents.includes(agent)) return { error: 'no-skill' };
  return readSkillFile(skill.dir, path);
}

/**
 * A file of the skill folder `dir`, by a path `skillFiles` lists. Content is
 * null for a file too large to show or one that isn't text.
 */
export function readSkillFile(dir: string, path: string): SkillFileResult {
  if (safeRelativePath(path) === null) return { error: 'invalid-path' };
  const file = skillFiles(dir).find((entry) => entry.path === path);
  if (!file) return { error: 'no-file' };
  if (file.size > MAX_SHOWN_FILE_BYTES) return { ...file, content: null };
  const bytes = readFileSync(join(dir, file.path));
  return {
    ...file,
    content: bytes.includes(0) ? null : bytes.toString('utf8'),
  };
}
