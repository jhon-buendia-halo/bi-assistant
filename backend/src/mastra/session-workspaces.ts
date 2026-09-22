import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  watch,
  type FSWatcher,
} from 'fs';
import { rm } from 'fs/promises';
import { join } from 'path';
import type { Mastra } from '@mastra/core';
import {
  LocalFilesystem,
  Workspace,
  WORKSPACE_TOOLS,
} from '@mastra/core/workspace';
import { mastraDataDir } from './storage';

export const SESSION_WORKSPACE_CONTEXT_KEY = 'session-workspace-id';
const WORKSPACE_PREFIX = 'session-';
const workspacesDir = join(mastraDataDir, 'workspaces');
const initialization = new Map<string, Promise<Workspace>>();
const interactiveVisualSkillCandidates = [
  // Mastra Studio serves from src/mastra/public, beside src/mastra/skills.
  join(process.cwd(), '..', 'skills', 'interactive-visuals', 'SKILL.md'),
  // Electron's backend cwd is dist/; standalone builds commonly run at the
  // backend root; Mastra Studio runs from source at that same root.
  join(process.cwd(), 'mastra', 'skills', 'interactive-visuals', 'SKILL.md'),
  join(
    process.cwd(),
    'dist',
    'mastra',
    'skills',
    'interactive-visuals',
    'SKILL.md',
  ),
  join(
    process.cwd(),
    'src',
    'mastra',
    'skills',
    'interactive-visuals',
    'SKILL.md',
  ),
];

mkdirSync(workspacesDir, { recursive: true });
renameLegacyWorkspaceDirectories();

/**
 * Workspace directories created before the `projects` → `sessions` rename use
 * the `project-` prefix. Without this the discovery scan below skips them and
 * every existing session loses its visuals and reports.
 */
function renameLegacyWorkspaceDirectories(): void {
  const legacyPrefix = 'project-';
  for (const entry of readdirSync(workspacesDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith(legacyPrefix)) continue;
    const renamed = `${WORKSPACE_PREFIX}${entry.name.slice(legacyPrefix.length)}`;
    const target = join(workspacesDir, renamed);
    if (existsSync(target)) continue;
    try {
      renameSync(join(workspacesDir, entry.name), target);
    } catch (error) {
      console.error(`[workspace] failed to migrate ${entry.name}`, error);
    }
  }
}

function assertSessionId(sessionId: string): void {
  if (!/^[a-zA-Z0-9_-]+$/.test(sessionId)) {
    throw new Error(`Invalid session workspace ID: ${sessionId}`);
  }
}

export function sessionWorkspaceId(sessionId: string): string {
  assertSessionId(sessionId);
  return `${WORKSPACE_PREFIX}${sessionId}`;
}

export function sessionWorkspacePath(sessionId: string): string {
  return join(workspacesDir, sessionWorkspaceId(sessionId));
}

/** Create the persistent filesystem-backed Mastra workspace for a session. */
export function createSessionWorkspace(
  sessionId: string,
  sessionName?: string,
): Workspace {
  const id = sessionWorkspaceId(sessionId);
  const basePath = sessionWorkspacePath(sessionId);
  mkdirSync(basePath, { recursive: true });
  seedInteractiveVisualSkill(basePath);

  return new Workspace({
    id,
    name: sessionName ? `${sessionName} Workspace` : id,
    filesystem: new LocalFilesystem({
      id: `${id}-filesystem`,
      basePath,
      contained: true,
    }),
    skills: ['.agents/skills'],
    tools: {
      // A session workspace is persistent; agents may create and edit artifacts,
      // but should not be able to remove them implicitly.
      [WORKSPACE_TOOLS.FILESYSTEM.DELETE]: { enabled: false },
    },
  });
}

/**
 * Copy app-owned reusable skills into each persistent session workspace.
 * Best-effort: this runs on every session load (including at module-load
 * time, restoring workspaces from earlier processes), so a locked target —
 * enterprise antivirus or roaming-profile sync holding SKILL.md — must never
 * abort session creation.
 */
function seedInteractiveVisualSkill(basePath: string): void {
  try {
    const source = interactiveVisualSkillCandidates.find(existsSync);
    if (!source) {
      console.warn('[workspace] interactive-visuals skill asset not found');
      return;
    }
    const targetDir = join(
      basePath,
      '.agents',
      'skills',
      'interactive-visuals',
    );
    mkdirSync(targetDir, { recursive: true });
    const target = join(targetDir, 'SKILL.md');

    // Skip the rewrite when the file is already current: avoids re-touching
    // (and re-locking) it on every startup for the common case.
    if (
      existsSync(target) &&
      readFileSync(source).equals(readFileSync(target))
    ) {
      return;
    }

    copySkillFile(source, target);
  } catch (error) {
    console.warn('[workspace] failed to seed interactive-visuals skill', error);
  }
}

/**
 * Copy via a temp file + rename so a reader never sees a half-written
 * SKILL.md, retrying a few times since a lock from antivirus/roaming-profile
 * sync is usually momentary. Runs at synchronous module load, so retries are
 * immediate rather than backed off with an async sleep.
 */
function copySkillFile(source: string, target: string): void {
  const tmpPath = `${target}.tmp-${process.pid}`;
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      copyFileSync(source, tmpPath);
      renameSync(tmpPath, target);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const retryable =
        code === 'EBUSY' || code === 'EPERM' || code === 'EACCES';
      try {
        unlinkSync(tmpPath);
      } catch {
        // Best-effort cleanup only; a leftover tmp file is harmless.
      }
      if (!retryable || attempt === maxAttempts) throw error;
    }
  }
}

/** Permanently remove the contained filesystem owned by a deleted session. */
export async function deleteSessionWorkspaceDirectory(
  sessionId: string,
): Promise<void> {
  await rm(sessionWorkspacePath(sessionId), { recursive: true, force: true });
}

/** Restore filesystem workspaces that were created by earlier app processes. */
export function discoverSessionWorkspaces(): Workspace[] {
  return readdirSync(workspacesDir, { withFileTypes: true })
    .filter(
      (entry) => entry.isDirectory() && entry.name.startsWith(WORKSPACE_PREFIX),
    )
    .flatMap((entry) => {
      // One unreadable/corrupt workspace directory must not abort discovery
      // for every other session.
      try {
        return [
          createSessionWorkspace(entry.name.slice(WORKSPACE_PREFIX.length)),
        ];
      } catch (error) {
        console.error(`[workspace] failed to restore ${entry.name}`, error);
        return [];
      }
    });
}

/**
 * Keep a Mastra process (the app backend or Studio) aligned with the shared
 * session workspace directory. Session creation/deletion can happen in the
 * other process, so a startup-only scan leaves Studio with stale entries.
 */
export function syncSessionWorkspaceRegistry(mastra: Mastra): void {
  const sessionIds = readdirSync(workspacesDir, { withFileTypes: true })
    .filter(
      (entry) => entry.isDirectory() && entry.name.startsWith(WORKSPACE_PREFIX),
    )
    .map((entry) => entry.name.slice(WORKSPACE_PREFIX.length));
  const diskWorkspaceIds = new Set(
    sessionIds.map((sessionId) => sessionWorkspaceId(sessionId)),
  );
  const registered = mastra.listWorkspaces();

  for (const sessionId of sessionIds) {
    const workspaceId = sessionWorkspaceId(sessionId);
    if (registered[workspaceId]) continue;

    const workspace = createSessionWorkspace(sessionId);
    mastra.addWorkspace(workspace);
    void initializeSessionWorkspace(workspace).catch((error: unknown) => {
      console.error(`[workspace] failed to initialize ${workspace.id}`, error);
    });
  }

  for (const workspaceId of Object.keys(registered)) {
    if (
      workspaceId.startsWith(WORKSPACE_PREFIX) &&
      !diskWorkspaceIds.has(workspaceId)
    ) {
      void mastra.removeWorkspace(workspaceId).catch((error: unknown) => {
        console.error(`[workspace] failed to unregister ${workspaceId}`, error);
      });
    }
  }
}

/** Watch for sessions created or deleted by another Mastra process. */
export function watchSessionWorkspaceRegistry(mastra: Mastra): FSWatcher {
  syncSessionWorkspaceRegistry(mastra);

  let debounce: ReturnType<typeof setTimeout> | undefined;
  const watcher = watch(workspacesDir, () => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => syncSessionWorkspaceRegistry(mastra), 75);
  });
  watcher.on('error', (error) => {
    console.error('[workspace] directory watcher failed', error);
  });
  watcher.unref();
  return watcher;
}

/** Initialize each workspace once even when startup and a request overlap. */
export async function initializeSessionWorkspace(
  workspace: Workspace,
): Promise<Workspace> {
  if (workspace.status === 'ready') return workspace;
  const existing = initialization.get(workspace.id);
  if (existing) return existing;

  const pending = workspace
    .init()
    .then(() => workspace)
    .finally(() => initialization.delete(workspace.id));
  initialization.set(workspace.id, pending);
  return pending;
}
