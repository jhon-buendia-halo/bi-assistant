#!/usr/bin/env node
// Configure a running local instance for hand testing (BA-325, delivery.md 2):
// save the LLM settings from .env.llm.local, then load every Testing Data
// fixture through the app's own API.
//
//   node scripts/setup-local.mjs [baseUrl]      # default http://127.0.0.1:3000
//
// The LLM settings come from `.env.llm.local` in this checkout, else in the
// main checkout (found through `git rev-parse --git-common-dir`, so a worktree
// needs no copy). Keys: LLM_PROVIDER (default custom), LLM_API_STYLE (default
// anthropic), LLM_BASE_URL, LLM_API_KEY, LLM_MODEL. The environment wins over
// the file. Without LLM_BASE_URL and LLM_MODEL the LLM step is skipped.
// No dependencies: Node 18+ fetch only.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ENV_FILE = '.env.llm.local';
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Parse `KEY=value` lines; `#` comments and blank lines are skipped. */
export function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

/** The first `.env.llm.local`: this checkout's, then the main checkout's. */
function findEnvFile() {
  const candidates = [join(repoRoot, ENV_FILE)];
  try {
    const common = execFileSync('git', ['rev-parse', '--git-common-dir'], {
      cwd: repoRoot,
      encoding: 'utf8',
    }).trim();
    candidates.push(join(resolve(repoRoot, common), '..', ENV_FILE));
  } catch {
    // Not a git checkout: only this folder is looked at.
  }
  return candidates.find((p) => existsSync(p));
}

/** The LLM settings body of `PUT /llm/settings` (api.md 30), or undefined. */
export function llmSettings(env) {
  if (!env.LLM_BASE_URL || !env.LLM_MODEL) return undefined;
  const provider = env.LLM_PROVIDER || 'custom';
  return {
    provider,
    ...(provider === 'custom' ? { apiStyle: env.LLM_API_STYLE || 'anthropic' } : {}),
    baseUrl: env.LLM_BASE_URL,
    model: env.LLM_MODEL,
    ...(env.LLM_API_KEY ? { apiKey: env.LLM_API_KEY } : {}),
  };
}

/** The load body for one fixture: a seedable fixture loads with its own defaults. */
export function fixtureBody(fixture) {
  return fixture.seedable ? fixture.defaults : {};
}

async function main() {
  const base = (process.argv[2] || 'http://127.0.0.1:3000').replace(/\/+$/, '');
  const file = findEnvFile();
  const env = { ...(file ? parseEnv(readFileSync(file, 'utf8')) : {}), ...process.env };

  const call = async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return res.json();
  };

  let failed = false;
  const settings = llmSettings(env);
  if (!settings) {
    console.log(`LLM: skipped — set LLM_BASE_URL and LLM_MODEL in ${ENV_FILE} (see .env.llm.example)`);
  } else {
    const saved = await call('PUT', '/llm/settings', settings);
    console.log(`LLM (${settings.provider}/${settings.model} at ${settings.baseUrl}):`, saved.message);
    failed ||= !saved.ok;
  }

  const { fixtures } = await call('GET', '/testing-data');
  for (const f of fixtures) {
    // Seedable Postgres fixtures load with their own defaults. Other fixtures are script-only.
    if (!f.seedable) continue;
    if (f.status?.loaded) {
      console.log(`${f.id}: already loaded`);
      continue;
    }
    const res = await call('POST', `/testing-data/${f.id}/load`, fixtureBody(f));
    console.log(`${f.id}:`, res.message);
    failed ||= !res.ok;
  }
  process.exitCode = failed ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`setup-local: ${err.message} — is the app running at that URL?`);
    process.exitCode = 1;
  });
}
