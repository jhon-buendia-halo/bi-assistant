/**
 * The real model a live-LLM spec runs against (`npm run test:live-llm`):
 * `LIVE_LLM_*` from the environment, else the `LLM_*` keys of
 * `.env.llm.local` in this checkout or the main checkout (the file
 * `scripts/setup-local.mjs` reads; gitignored). Plain data, no app import.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/** The `PUT /llm/settings` body (api.md 30) for the live model. */
export interface LiveLlmSettings {
  provider: string;
  apiStyle?: string;
  baseUrl: string;
  model: string;
  apiKey?: string;
}

function parseEnvFile(file: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (match && !line.trimStart().startsWith('#')) {
      values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
  return values;
}

/** `.env.llm.local` of this checkout, else of the main checkout. */
function envFile(): string | undefined {
  const root = resolve(__dirname, '..', '..');
  const here = join(root, '.env.llm.local');
  if (existsSync(here)) return here;
  try {
    const common = execFileSync('git', ['rev-parse', '--git-common-dir'], {
      cwd: root,
      encoding: 'utf8',
    }).trim();
    const main = join(dirname(resolve(root, common)), '.env.llm.local');
    return existsSync(main) ? main : undefined;
  } catch {
    return undefined;
  }
}

/** The live model's settings, or undefined when none is configured. */
export function liveLlmSettings(): LiveLlmSettings | undefined {
  const file = envFile();
  const fromFile = file ? parseEnvFile(file) : {};
  const pick = (key: string) =>
    process.env[`LIVE_LLM_${key}`] || fromFile[`LLM_${key}`] || '';
  const baseUrl = pick('BASE_URL');
  const model = pick('MODEL');
  if (!baseUrl || !model) return undefined;
  const provider = pick('PROVIDER') || 'custom';
  const apiKey = pick('API_KEY');
  return {
    provider,
    ...(provider === 'custom'
      ? { apiStyle: pick('API_STYLE') || 'anthropic' }
      : {}),
    baseUrl,
    model,
    ...(apiKey ? { apiKey } : {}),
  };
}
