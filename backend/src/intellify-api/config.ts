import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const INTELLIFY_API_KEY_FILE_NAME = '.intellify-api-key';
export const DEFAULT_INTELLIFY_API_PORT = 3100;

/** Where and how the API reaches the Intellify database (api.md 6.1). */
export interface IntellifyDbConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
  /** Schema holding the Intellify data; the `rfp` schema's name is fixed. */
  schema: string;
}

export interface IntellifyApiConfig {
  /** `false` when `INTELLIFY_API=off`: the embedded API is not started. */
  enabled: boolean;
  host: string;
  /** 0 = a port the OS picks. */
  port: number;
  /** Keys from `INTELLIFY_API_KEY` (comma-separated); empty when unset. */
  apiKeys: string[];
  db: IntellifyDbConfig;
}

type Env = Record<string, string | undefined>;

function port(value: string | undefined, fallback: number, name: string) {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
    throw new Error(`invalid ${name} "${value}" (expected 0-65535)`);
  }
  return parsed;
}

export function parseApiKeys(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean);
}

/** Reads the `INTELLIFY_*` variables, with the defaults of api.md 6.1. */
export function intellifyApiConfig(env: Env = process.env): IntellifyApiConfig {
  return {
    enabled: env.INTELLIFY_API?.trim().toLowerCase() !== 'off',
    host: env.INTELLIFY_API_HOST?.trim() || '127.0.0.1',
    port: port(
      env.INTELLIFY_API_PORT,
      DEFAULT_INTELLIFY_API_PORT,
      'INTELLIFY_API_PORT',
    ),
    apiKeys: parseApiKeys(env.INTELLIFY_API_KEY),
    db: {
      host: env.INTELLIFY_DB_HOST?.trim() || '127.0.0.1',
      port: port(
        env.INTELLIFY_DB_PORT || env.WORLD_CUP_DB_PORT,
        55432,
        'INTELLIFY_DB_PORT',
      ),
      database: env.INTELLIFY_DB_NAME?.trim() || 'intellify_mercer_demo',
      user: env.INTELLIFY_DB_USER?.trim() || 'world_cup',
      password: env.INTELLIFY_DB_PASSWORD ?? 'world_cup_dev',
      ssl: env.INTELLIFY_DB_SSL?.trim().toLowerCase() === 'true',
      schema: env.INTELLIFY_DB_SCHEMA?.trim() || 'intellify',
    },
  };
}

/**
 * The embedded API's key when `INTELLIFY_API_KEY` is unset: the one in
 * `<dataDir>/.intellify-api-key`, created (32 random bytes hex, mode 0600) on
 * first use, as `.app-secret` is.
 */
export function readOrCreateApiKey(dataDir: string): string {
  const keyPath = join(dataDir, INTELLIFY_API_KEY_FILE_NAME);
  try {
    if (existsSync(keyPath)) {
      const existing = readFileSync(keyPath, 'utf8').trim();
      if (existing) return existing;
    }
  } catch {
    // Unreadable: fall through and generate one.
  }
  const key = randomBytes(32).toString('hex');
  try {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(keyPath, key, { mode: 0o600 });
  } catch {
    // Not persisted: the key lives for this run, and registering the sample
    // again after a restart picks up the new one.
  }
  return key;
}
