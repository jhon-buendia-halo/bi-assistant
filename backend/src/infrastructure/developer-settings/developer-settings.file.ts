/**
 * The developer setting (developer observability on/off and its two
 * endpoints) lives in `<APP_DATA_DIR>/developer-settings.json`, not in the
 * document store: the backend entry points must be able to read it
 * synchronously before any app module is imported (ADR-0006). Keep this file
 * free of Nest and database imports for that reason.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

export interface DeveloperSettings {
  observabilityEnabled: boolean;
  phoenixEndpoint: string;
  otlpEndpoint: string;
}

export const DEVELOPER_SETTINGS_FILE = 'developer-settings.json';

export const DEFAULT_DEVELOPER_SETTINGS: Readonly<DeveloperSettings> =
  Object.freeze({
    observabilityEnabled: false,
    phoenixEndpoint: 'http://localhost:6006',
    otlpEndpoint: 'http://localhost:4318',
  });

/** Same resolution as the database module, but evaluated at call time. */
export function resolveDataDir(): string {
  return process.env.APP_DATA_DIR ?? join(process.cwd(), 'data');
}

/**
 * Trims, drops trailing slashes and checks for an absolute http(s) URL.
 * Returns null when the value is not one.
 */
export function normalizeEndpoint(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!url.hostname) return null;
  } catch {
    return null;
  }
  return trimmed;
}

/**
 * Never throws: a missing, unreadable or malformed file gives the defaults,
 * and each invalid value falls back to its own default.
 */
export function readDeveloperSettings(
  dataDir: string = resolveDataDir(),
): DeveloperSettings {
  const path = join(dataDir, DEVELOPER_SETTINGS_FILE);
  let raw: unknown = null;
  try {
    if (existsSync(path)) raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    raw = null;
  }
  const doc = (raw && typeof raw === 'object' ? raw : {}) as Record<
    string,
    unknown
  >;
  return {
    observabilityEnabled: doc.observabilityEnabled === true,
    phoenixEndpoint:
      normalizeEndpoint(doc.phoenixEndpoint) ??
      DEFAULT_DEVELOPER_SETTINGS.phoenixEndpoint,
    otlpEndpoint:
      normalizeEndpoint(doc.otlpEndpoint) ??
      DEFAULT_DEVELOPER_SETTINGS.otlpEndpoint,
  };
}

/** Writes through a temporary file and a rename, so a reader never sees half a file. */
export function writeDeveloperSettings(
  settings: DeveloperSettings,
  dataDir: string = resolveDataDir(),
): void {
  const path = join(dataDir, DEVELOPER_SETTINGS_FILE);
  const temporary = `${path}.${process.pid}.tmp`;
  const doc = { ...settings, updatedAt: new Date().toISOString() };
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(temporary, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
  renameSync(temporary, path);
}

let startupSettings: DeveloperSettings | null = null;
let startupForced = false;

/**
 * Environment variable that forces developer observability on for one
 * process (developer-settings R28). The CLI's `--dev-observability` sets it.
 */
export const DEV_OBSERVABILITY_ENV = 'QTI_DEV_OBSERVABILITY';

/** `1` or `true` (any case) forces it on; anything else doesn't. */
export function observabilityForcedByEnv(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const value = env[DEV_OBSERVABILITY_ENV]?.trim().toLowerCase();
  return value === '1' || value === 'true';
}

/**
 * The setting this process started with. The first call reads the file (and
 * the force variable) and every later call returns that same copy, so saving
 * never changes it. When forced, observability is on with the saved endpoints.
 */
export function startupDeveloperSettings(
  dataDir: string = resolveDataDir(),
): DeveloperSettings {
  if (!startupSettings) {
    startupForced = observabilityForcedByEnv();
    const saved = readDeveloperSettings(dataDir);
    startupSettings = startupForced
      ? { ...saved, observabilityEnabled: true }
      : saved;
  }
  return { ...startupSettings };
}

/** Whether the startup copy was forced on by the environment. */
export function startupObservabilityForced(): boolean {
  startupDeveloperSettings();
  return startupForced;
}

/** Test hook: forget the startup copy. */
export function resetStartupDeveloperSettings(): void {
  startupSettings = null;
  startupForced = false;
}

export function sameDeveloperSettings(
  a: DeveloperSettings,
  b: DeveloperSettings,
): boolean {
  return (
    a.observabilityEnabled === b.observabilityEnabled &&
    a.phoenixEndpoint === b.phoenixEndpoint &&
    a.otlpEndpoint === b.otlpEndpoint
  );
}
