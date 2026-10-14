import { spawn } from 'child_process';
import { isAbsolute, join, normalize, relative, sep } from 'path';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import {
  type AppSkill,
  catalogSkills,
  readSkillFile,
  skillFiles,
} from './app-skills';

/**
 * The assistant's skill tools (ADR-0020, agents.md 3.9 and 3.10): a
 * read-only `read_file` limited to the folders of the skills its catalog
 * lists, and `run_skill_script` for built-in skills' Node scripts. They
 * replace the framework's `skill` / `skill_search` / `skill_read`.
 */

export const SCRIPT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_CHARS = 20_000;
const MAX_ARGS = 20;
const MAX_ARG_CHARS = 2_000;
const SCRIPT_FILE = /^scripts\/.+\.(?:c|m)?js$/;

export type ReadResult =
  | { path: string; content: string }
  | { path: string; error: string }
  | { error: string };

/**
 * One file of a listed skill, by absolute path. The path must resolve to a
 * regular file `skillFiles` lists inside one of `skills`' folders, so a
 * symbolic link or a path outside them is refused.
 */
export function readSkillPath(skills: AppSkill[], path: string): ReadResult {
  const refused = {
    error: `Not a file of an installed skill: ${path}. Use the skill's location folder joined with the path SKILL.md names.`,
  };
  if (typeof path !== 'string' || !isAbsolute(path)) return refused;
  const target = normalize(path);
  for (const skill of skills) {
    const inside = relative(skill.dir, target);
    if (!inside || inside.startsWith('..') || isAbsolute(inside)) continue;
    const result = readSkillFile(skill.dir, inside.split(sep).join('/'));
    if ('error' in result) return refused;
    if (result.content === null) {
      return {
        path,
        error:
          "This file is larger than 256 KB or isn't text, so it can't be read.",
      };
    }
    return { path, content: result.content };
  }
  return refused;
}

/** A built-in skill's runnable scripts: listed `scripts/*.js|mjs|cjs` files. */
export function skillScripts(skill: AppSkill): string[] {
  if (skill.level !== 'built-in') return [];
  return skillFiles(skill.dir)
    .map((file) => file.path)
    .filter((path) => SCRIPT_FILE.test(path));
}

export interface ScriptResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut?: true;
}

function capped(text: string): string {
  return text.length > MAX_OUTPUT_CHARS
    ? `${text.slice(0, MAX_OUTPUT_CHARS)}…[truncated]`
    : text;
}

/**
 * Run one script of `skill` with the backend's own Node runtime: no shell,
 * the skill folder as working directory, an environment without any app
 * secret, and a timeout after which the process is killed.
 */
export function runSkillScript(
  skill: AppSkill,
  script: string,
  args: string[],
  timeoutMs = SCRIPT_TIMEOUT_MS,
): Promise<ScriptResult> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const child = spawn(process.execPath, [join(skill.dir, script), ...args], {
      cwd: skill.dir,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      // Only what Node needs: no APP_SECRET, API keys or data-dir paths.
      // ELECTRON_RUN_AS_NODE makes the desktop app's runtime act as Node.
      env: {
        PATH: process.env.PATH ?? '',
        ELECTRON_RUN_AS_NODE: '1',
        NODE_ENV: process.env.NODE_ENV ?? 'production',
      },
    });
    // Collect a little past the cap so `capped` can mark the cut.
    const collect = (chunk: Buffer, into: 'out' | 'err') => {
      const text = chunk.toString('utf8');
      if (into === 'out' && stdout.length <= MAX_OUTPUT_CHARS) stdout += text;
      if (into === 'err' && stderr.length <= MAX_OUTPUT_CHARS) stderr += text;
    };
    child.stdout.on('data', (chunk: Buffer) => collect(chunk, 'out'));
    child.stderr.on('data', (chunk: Buffer) => collect(chunk, 'err'));
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ exitCode: null, stdout: '', stderr: error.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: timedOut ? null : code,
        stdout: capped(stdout),
        stderr: capped(stderr),
        ...(timedOut ? { timedOut: true as const } : {}),
      });
    });
  });
}

/** Resolve a `run_skill_script` request against the catalog. */
export function resolveScript(
  skills: AppSkill[],
  name: string,
  script: string,
): { skill: AppSkill; script: string } | { error: string } {
  const skill = skills.find(
    (candidate) => candidate.name === name && candidate.level === 'built-in',
  );
  if (!skill) return { error: `Unknown skill: ${name}` };
  if (!skillScripts(skill).includes(script)) {
    return { error: `Not a script of ${name}: ${script}` };
  }
  return { skill, script };
}

export const READ_FILE_DESCRIPTION =
  "Read one file of an installed skill by its absolute path: the location the skill list gives for SKILL.md, or that folder joined with a path SKILL.md names. Only files inside the listed skills' folders can be read.";

export const RUN_SKILL_SCRIPT_DESCRIPTION =
  "Run one of a built-in skill's bundled scripts and return its output. Use it instead of reading the script. Arguments are passed as a list, never through a shell.";

/**
 * The skill tools for `agent`, from its catalog: none when it has no
 * on-demand skills, `run_skill_script` only when a listed built-in skill
 * has a script.
 */
export function skillToolsFor(
  agent: string,
  skills = catalogSkills(agent),
): Record<string, ReturnType<typeof createTool>> {
  if (!skills.length) return {};
  const readFile = createTool({
    id: 'read_file',
    description: READ_FILE_DESCRIPTION,
    inputSchema: z.object({
      path: z.string().describe('Absolute path of the skill file to read'),
    }),
    execute: ({ path }) => Promise.resolve(readSkillPath(skills, path)),
  });
  if (!skills.some((skill) => skillScripts(skill).length)) {
    return { read_file: readFile };
  }
  const runScript = createTool({
    id: 'run_skill_script',
    description: RUN_SKILL_SCRIPT_DESCRIPTION,
    inputSchema: z.object({
      skill: z
        .string()
        .describe("The skill's name, as the skill list gives it"),
      script: z
        .string()
        .describe(
          "The script's path in the skill folder, e.g. scripts/check.js",
        ),
      args: z
        .array(z.string().max(MAX_ARG_CHARS))
        .max(MAX_ARGS)
        .optional()
        .describe('Arguments, one per item'),
    }),
    execute: async ({ skill, script, args }) => {
      const resolved = resolveScript(skills, skill, script);
      if ('error' in resolved) return resolved;
      return runSkillScript(resolved.skill, resolved.script, args ?? []);
    },
  });
  return { read_file: readFile, run_skill_script: runScript };
}
