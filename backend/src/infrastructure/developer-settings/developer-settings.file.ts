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

/**
 * The setting this process started with. The first call reads the file and
 * every later call returns that same copy, so saving never changes it.
 */
export function startupDeveloperSettings(
  dataDir: string = resolveDataDir(),
): DeveloperSettings {
  startupSettings ??= readDeveloperSettings(dataDir);
  return { ...startupSettings };
}

/** Test hook: forget the startup copy. */
export function resetStartupDeveloperSettings(): void {
  startupSettings = null;
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
