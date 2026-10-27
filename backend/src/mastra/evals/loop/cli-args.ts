/**
 * Flags, paths and exit codes shared by the improvement-loop commands
 * `eval:diff`, `eval:export-failures` and `eval:leak-check` (agents-evals R225
 * to R230; delivery.md section 2, *Improvement loop*).
 *
 * The commands run through `npm --prefix backend run …`, so their working
 * directory is `backend/` while the paths a person types are relative to the
 * folder they typed them in. npm keeps that folder in `INIT_CWD`, and every
 * path flag is resolved against it.
 *
 * Pure module: no Nest, no Mastra, no model.
 */
import { isAbsolute, join, resolve } from 'path';

/** A refused input: a bad flag, file or run id. The command exits with 2. */
export class LoopInputError extends Error {
  readonly exitCode = 2;

  constructor(message: string) {
    super(message);
    this.name = 'LoopInputError';
  }
}

/** The kind of each flag a command takes: a value, or a switch. */
export type FlagSpec = Readonly<Record<string, 'string' | 'boolean'>>;

export type ParsedFlags<S extends FlagSpec> = {
  [K in keyof S]?: S[K] extends 'boolean' ? boolean : string;
};

/**
 * Read `--name value`, `--name=value` and `--switch` flags. An unknown flag,
 * a value missing or given to a switch, a flag given twice and any bare
 * argument are refused with the command's usage line.
 */
export function parseFlags<S extends FlagSpec>(
  argv: readonly string[],
  spec: S,
  usage: string,
): ParsedFlags<S> {
  const refuse = (problem: string): never => {
    throw new LoopInputError(`${problem}\nUsage: ${usage}`);
  };
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) refuse(`Unexpected argument "${arg}"`);
    const eq = arg.indexOf('=');
    const name = eq >= 0 ? arg.slice(2, eq) : arg.slice(2);
    const kind = spec[name];
    if (!kind) refuse(`Unknown flag "--${name}"`);
    if (name in flags) refuse(`--${name} is given twice`);
    if (kind === 'boolean') {
      if (eq >= 0) refuse(`--${name} takes no value`);
      flags[name] = true;
      continue;
    }
    let value: string | undefined;
    if (eq >= 0) {
      value = arg.slice(eq + 1);
    } else {
      value = argv[i + 1];
      i += 1;
    }
    if (value === undefined || value.startsWith('--') || value.trim() === '') {
      refuse(`--${name} needs a value`);
    }
    flags[name] = value;
  }
  return flags as ParsedFlags<S>;
}

/** Where the person typed the command: npm's `INIT_CWD`, else the cwd. */
export function launchDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.INIT_CWD ?? process.cwd();
}

/** A path flag resolved against the folder the command was typed in. */
export function resolveUserPath(
  path: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return isAbsolute(path) ? path : resolve(launchDir(env), path);
}

/** The backend folder: `backend/src/mastra/evals/loop` → `backend`. */
export const BACKEND_DIR = resolve(__dirname, '..', '..', '..', '..');

/** The repository root, the backend folder's parent. */
export const REPO_ROOT = resolve(BACKEND_DIR, '..');

/**
 * The data directory runs are read from (agents-evals R225, R228):
 * `--data-dir` (resolved where it was typed), else `APP_DATA_DIR` (resolved as
 * the backend resolves it, against its own working directory), else `data` in
 * the backend folder.
 */
export function dataDirFrom(
  flag: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
  backendDir: string = BACKEND_DIR,
): string {
  if (flag) return resolveUserPath(flag, env);
  if (env.APP_DATA_DIR) return resolve(env.APP_DATA_DIR);
  return join(backendDir, 'data');
}

/** Where a command writes: the console, or a test's buffers. */
export interface CommandIo {
  out(line: string): void;
  err(line: string): void;
}

export const CONSOLE_IO: CommandIo = {
  out: (line) => console.log(line),
  err: (line) => console.error(line),
};

/**
 * Run a command's body and map its outcome to an exit code: the body's own
 * code, 2 for a refused input (its message on stderr), 1 for anything else.
 */
export function runCommand(
  io: CommandIo,
  body: () => number | Promise<number>,
): Promise<number> {
  return Promise.resolve()
    .then(body)
    .catch((error: unknown) => {
      if (error instanceof LoopInputError) {
        io.err(error.message);
        return error.exitCode;
      }
      io.err(
        error instanceof Error ? (error.stack ?? error.message) : String(error),
      );
      return 1;
    });
}
