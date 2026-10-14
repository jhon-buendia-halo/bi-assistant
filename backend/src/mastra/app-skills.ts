import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from 'fs';
import { isAbsolute, join, normalize, resolve, sep } from 'path';

/**
 * Agent skills (ADR-0018, ADR-0019, agents.md sections 7.3 and 7.4).
 *
 * Skills come from three levels, read once when this module is first used:
 * built-in (the bundle under `skills/<name>/`), user (`<data dir>/skills/`)
 * and project (the folder `QUESTIONS_TO_INSIGHTS_PROJECT_SKILLS_DIR` names).
 * A later level overrides an earlier one by name. A broken built-in skill
 * stops the backend; a broken user or project skill is skipped and reported,
 * because a typo in a dropped-in folder must not take the app down.
 *
 * Harness-loaded skills are read by their callers through `appSkillDocument`
 * / `appSkillBody` / `appSkillFile`, always from the skill that won for the
 * name, and never appear in a catalog.
 */

export type SkillLevel = 'built-in' | 'user' | 'project';
export type SkillLoading = 'on-demand' | 'harness';

/** Built-in on-demand skills each agent's catalog lists, by registry key. */
export const AGENT_SKILLS: Readonly<Record<string, readonly string[]>> = {
  assistant: [],
};

/** Built-in skills code sends to each agent itself (agents.md 7.4). */
export const HARNESS_SKILLS: Readonly<Record<string, readonly string[]>> = {
  assistant: ['curated-knowledge', 'deep-analysis'],
  visualization: ['interactive-visuals'],
};

/**
 * Agents that can load a skill on demand: they run with tools and pass
 * `skills: skillPathsFor(...)`. The others run without tools, so a catalog
 * entry would be a skill they can never read.
 */
export const ON_DEMAND_AGENTS: readonly string[] = ['assistant'];

/** Registry keys (agents.md 1.2), to tell an unknown agent from one without tools. */
const REGISTERED_AGENTS: readonly string[] = [
  'assistant',
  'visualization',
  'sql-fixer',
  'sql-verifier',
  'assistant-eval-judge',
  'knowledge-bootstrap',
];

export const PROJECT_SKILLS_VARIABLE =
  'QUESTIONS_TO_INSIGHTS_PROJECT_SKILLS_DIR';

/** Files over this size, or holding a NUL byte, are listed but not shown. */
const MAX_SHOWN_FILE_BYTES = 256 * 1024;

export interface AppSkill {
  name: string;
  description: string;
  /** Absolute path of the skill's folder. */
  dir: string;
  /** The whole `SKILL.md`, front matter included. */
  document: string;
  level: SkillLevel;
  loading: SkillLoading;
  /** Registry keys of the agents that get this skill. */
  agents: string[];
  /** Lower levels that also hold a valid skill with this name, lowest first. */
  overrides: SkillLevel[];
  warnings: string[];
}

export interface SkippedSkill {
  /** The folder name. */
  name: string;
  level: 'user' | 'project';
  dir: string;
  problems: string[];
  /** The agents it would have reached; its page lists it under Skipped. */
  agents: string[];
}

export interface SkillLevelInfo {
  level: SkillLevel;
  path: string | null;
  found: boolean;
}

export interface ResolvedSkills {
  skills: Map<string, AppSkill>;
  skipped: SkippedSkill[];
  levels: SkillLevelInfo[];
}

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
const LINKED_FILE = /\b(?:phases|references?)\/[A-Za-z0-9._/-]+\.md\b/g;
const PLACEHOLDER = /\{\{([^{}]*)\}\}/g;
/** Folders an override of a harness-loaded skill must carry, file by file. */
const REQUIRED_FOLDERS = ['phases', 'reference', 'references'];

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

/** Same launch directory as `storage.ts`: Studio changes `cwd`, not these. */
function launchDir(): string {
  return process.env.INIT_CWD ?? process.env.PWD ?? process.cwd();
}

/** `<data dir>/skills`, the data dir resolved as `storage.ts` does. */
export function userSkillsRoot(): string {
  return join(process.env.APP_DATA_DIR ?? join(launchDir(), 'data'), 'skills');
}

/** The project skills folder, or null when the variable is not set. */
export function projectSkillsRoot(): string | null {
  const value = process.env[PROJECT_SKILLS_VARIABLE]?.trim();
  if (!value) return null;
  return isAbsolute(value) ? value : resolve(launchDir(), value);
}

interface FrontMatter {
  name?: string;
  description?: string;
  agents?: string[];
}

/**
 * Read the front matter. `strict` (built-in skills) allows only `name` and
 * `description`. Otherwise `agents` is read too and any other key is ignored
 * with its continuation lines, so a standard skill carrying `license` or a
 * nested `metadata` map still loads. `description` may wrap onto indented
 * lines or use a `>` / `|` block; its lines are joined with single spaces.
 */
function parseFrontMatter(
  text: string,
  problems: string[],
  strict: boolean,
): FrontMatter {
  const match = FRONT_MATTER.exec(text);
  if (!match) {
    problems.push('front matter is missing');
    return {};
  }
  const known = strict
    ? ['name', 'description']
    : ['name', 'description', 'agents'];
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
      if (strict) problems.push(`unknown front-matter key "${key}"`);
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
      if (key === 'name') values.name = '';
      continue;
    }
    if (key === 'agents') {
      values.agents = value
        .replace(/^\[(.*)\]$/, '$1')
        .split(',')
        .map((item) => item.trim().replace(/^(['"])(.*)\1$/, '$2'))
        .filter(Boolean);
    } else {
      values.name = value;
    }
  }
  return values;
}

interface ReadSkill {
  folder: string;
  dir: string;
  document?: string;
  frontMatter: FrontMatter;
  description: string;
  problems: string[];
}

function readSkill(root: string, folder: string, strict: boolean): ReadSkill {
  const dir = join(root, folder);
  const file = join(dir, 'SKILL.md');
  const problems: string[] = [];
  const result: ReadSkill = {
    folder,
    dir,
    frontMatter: {},
    description: '',
    problems,
  };
  if (!isRegularFile(file)) {
    problems.push('SKILL.md is missing');
    return result;
  }
  const document = readFileSync(file, 'utf8');
  result.document = document;
  const values = parseFrontMatter(document, problems, strict);
  result.frontMatter = values;
  if (FRONT_MATTER.test(document)) {
    if (values.name === undefined) problems.push('name is missing');
    else if (values.name !== folder) {
      problems.push(`name "${values.name}" does not match its folder`);
    }
    if (!values.description) problems.push('description is missing');
    else if (values.description && !values.description.startsWith('Use when')) {
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

/** Built-in agents and loading mode of a built-in skill, from the two tables. */
function builtInTargets(name: string): Pick<AppSkill, 'agents' | 'loading'> {
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
 * Read and validate every built-in skill under `root`. Throws
 * `Invalid app skills:` with one `<skill>: <problem>` line per problem.
 */
export function loadAppSkills(root: string): Map<string, AppSkill> {
  const problems: string[] = [];
  const skills = new Map<string, AppSkill>();
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    problems.push(`${root}: skills folder not found`);
  } else {
    for (const folder of skillFolders(root)) {
      const read = readSkill(root, folder, true);
      problems.push(...read.problems.map((problem) => `${folder}: ${problem}`));
      if (read.problems.length || read.document === undefined) continue;
      skills.set(folder, {
        name: folder,
        description: read.description,
        dir: read.dir,
        document: read.document,
        level: 'built-in',
        ...builtInTargets(folder),
        overrides: [],
        warnings: [],
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

function placeholders(text: string): string[] {
  return [...new Set([...text.matchAll(PLACEHOLDER)].map((m) => m[1]))].sort();
}

/**
 * What an override of a harness-loaded built-in must keep: the code sends
 * its body, reads its phase and reference files by path, and fills the
 * phases' placeholders, so a missing file or placeholder breaks that call.
 */
function harnessOverrideProblems(builtIn: AppSkill, read: ReadSkill): string[] {
  const problems: string[] = [];
  if (read.document !== undefined && !skillBody(read.document)) {
    problems.push('the body is empty');
  }
  const required = skillFiles(builtIn.dir).filter((file) =>
    REQUIRED_FOLDERS.includes(file.path.split('/')[0]),
  );
  for (const { path } of required) {
    const own = join(read.dir, path);
    if (!isRegularFile(own)) {
      problems.push(`${path} is missing (the skill it overrides has it)`);
      continue;
    }
    const expected = placeholders(
      readFileSync(join(builtIn.dir, path), 'utf8'),
    );
    const actual = placeholders(readFileSync(own, 'utf8'));
    if (expected.join('\n') !== actual.join('\n')) {
      problems.push(
        expected.length
          ? `${path} must use the placeholders ${expected.map((name) => `{{${name}}}`).join(', ')}`
          : `${path} must use no placeholders`,
      );
    }
  }
  return problems;
}

/** The agents a new user or project skill targets, and the problems with them. */
function targetAgents(read: ReadSkill): {
  agents: string[];
  problems: string[];
} {
  const named = read.frontMatter.agents;
  if (!named) return { agents: ['assistant'], problems: [] };
  const problems: string[] = [];
  for (const agent of named) {
    if (!REGISTERED_AGENTS.includes(agent)) {
      problems.push(`unknown agent "${agent}"`);
    } else if (!ON_DEMAND_AGENTS.includes(agent)) {
      problems.push(`agent "${agent}" does not load skills on demand`);
    }
  }
  const agents = named.filter((agent) => REGISTERED_AGENTS.includes(agent));
  return { agents: agents.length ? agents : ['assistant'], problems };
}

/**
 * Resolve the three levels: the validated built-ins, then the user and
 * project folders in that order, each overriding the skill of the same name
 * below it. Problems in the two upper levels skip the skill, never throw.
 */
export function resolveSkills(
  builtIn: ReadonlyMap<string, AppSkill>,
  roots: { user: string | null; project: string | null },
  warn: (message: string) => void = () => undefined,
): ResolvedSkills {
  const skills = new Map(builtIn);
  const skipped: SkippedSkill[] = [];
  const levels: SkillLevelInfo[] = [
    { level: 'built-in', path: null, found: true },
  ];
  for (const level of ['user', 'project'] as const) {
    const root = roots[level];
    const found =
      root !== null && existsSync(root) && statSync(root).isDirectory();
    levels.push({ level, path: root, found });
    if (level === 'project' && root !== null && !found) {
      warn(`[skills] Project skills folder not found: ${root}`);
    }
    if (!found || root === null) continue;

    for (const folder of skillFolders(root)) {
      const read = readSkill(root, folder, false);
      const problems = [...read.problems];
      const warnings: string[] = [];
      const below = skills.get(folder);
      let agents: string[];
      let loading: SkillLoading;
      if (below) {
        ({ agents, loading } = below);
        if (read.frontMatter.agents)
          warnings.push('agents is ignored on an override');
        const original = builtIn.get(folder);
        if (loading === 'harness' && original) {
          problems.push(...harnessOverrideProblems(original, read));
        }
      } else {
        const target = targetAgents(read);
        agents = target.agents;
        problems.push(...target.problems);
        loading = 'on-demand';
      }
      if (existsSync(join(read.dir, 'scripts'))) {
        warnings.push('scripts/ is not run for user and project skills');
      }
      if (problems.length || read.document === undefined) {
        skipped.push({ name: folder, level, dir: read.dir, problems, agents });
        warn(
          `[skills] Skipped ${level} skill "${folder}": ${problems.join('; ')}`,
        );
        continue;
      }
      skills.set(folder, {
        name: folder,
        description: read.description,
        dir: read.dir,
        document: read.document,
        level,
        loading,
        agents,
        overrides: below ? [...below.overrides, below.level] : [],
        warnings,
      });
    }
  }
  return { skills, skipped, levels };
}

let resolved: ResolvedSkills | undefined;

/** Every level, loaded once per process; a broken built-in throws here. */
export function resolvedAppSkills(): ResolvedSkills {
  if (!resolved) {
    const builtIn = loadAppSkills(skillsRoot());
    validateAgentSkills(builtIn, AGENT_SKILLS);
    validateAgentSkills(builtIn, HARNESS_SKILLS);
    resolved = resolveSkills(
      builtIn,
      { user: userSkillsRoot(), project: projectSkillsRoot() },
      (message) => console.warn(message),
    );
  }
  return resolved;
}

/** The skill that won for each name, across the three levels. */
export function appSkills(): ReadonlyMap<string, AppSkill> {
  return resolvedAppSkills().skills;
}

function winningSkill(name: string): AppSkill {
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
  return winningSkill(name).document;
}

/**
 * A harness-loaded skill's `SKILL.md` without its front matter, trimmed: the
 * text a caller sends as the skill's system message.
 */
export function appSkillBody(name: string): string {
  return skillBody(winningSkill(name).document);
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
  const skill = winningSkill(name);
  const relative = safeRelativePath(path);
  if (relative === null) throw new Error(`Invalid skill file path "${path}"`);
  return readFileSync(join(skill.dir, relative), 'utf8');
}

export interface AgentSkillsView {
  levels: SkillLevelInfo[];
  skills: {
    name: string;
    description: string;
    level: SkillLevel;
    loading: SkillLoading;
    overrides: SkillLevel[];
    files: { path: string; size: number }[];
    warnings: string[];
  }[];
  skipped: { name: string; level: 'user' | 'project'; problems: string[] }[];
}

/** What `GET /agents/:key/skills` returns for a registry key (api.md 34a). */
export function agentSkillsView(agent: string): AgentSkillsView {
  const { skills, skipped, levels } = resolvedAppSkills();
  const order = (level: SkillLevel) => (level === 'user' ? 0 : 1);
  return {
    levels,
    skills: [...skills.values()]
      .filter((skill) => skill.agents.includes(agent))
      .sort((a, b) => (a.name < b.name ? -1 : 1))
      .map((skill) => ({
        name: skill.name,
        description: skill.description,
        level: skill.level,
        loading: skill.loading,
        overrides: skill.overrides,
        files: skillFiles(skill.dir),
        warnings: skill.warnings,
      })),
    skipped: skipped
      .filter((skill) => skill.agents.includes(agent))
      .sort(
        (a, b) => order(a.level) - order(b.level) || (a.name < b.name ? -1 : 1),
      )
      .map(({ name, level, problems }) => ({ name, level, problems })),
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
