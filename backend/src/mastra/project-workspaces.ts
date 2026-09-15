import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
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

export const PROJECT_WORKSPACE_CONTEXT_KEY = 'project-workspace-id';
const WORKSPACE_PREFIX = 'project-';
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

function assertProjectId(projectId: string): void {
  if (!/^[a-zA-Z0-9_-]+$/.test(projectId)) {
    throw new Error(`Invalid project workspace ID: ${projectId}`);
  }
}

export function projectWorkspaceId(projectId: string): string {
  assertProjectId(projectId);
  return `${WORKSPACE_PREFIX}${projectId}`;
}

export function projectWorkspacePath(projectId: string): string {
  return join(workspacesDir, projectWorkspaceId(projectId));
}

/** Create the persistent filesystem-backed Mastra workspace for a project. */
export function createProjectWorkspace(
  projectId: string,
  projectName?: string,
): Workspace {
  const id = projectWorkspaceId(projectId);
  const basePath = projectWorkspacePath(projectId);
  mkdirSync(basePath, { recursive: true });
  seedInteractiveVisualSkill(basePath);

  return new Workspace({
    id,
    name: projectName ? `${projectName} Workspace` : id,
    filesystem: new LocalFilesystem({
      id: `${id}-filesystem`,
      basePath,
      contained: true,
    }),
    skills: ['.agents/skills'],
    tools: {
      // A project workspace is persistent; agents may create and edit artifacts,
      // but should not be able to remove them implicitly.
      [WORKSPACE_TOOLS.FILESYSTEM.DELETE]: { enabled: false },
    },
  });
}

/** Copy app-owned reusable skills into each persistent project workspace. */
function seedInteractiveVisualSkill(basePath: string): void {
  const source = interactiveVisualSkillCandidates.find(existsSync);
  if (!source) {
    console.warn('[workspace] interactive-visuals skill asset not found');
    return;
  }
  const targetDir = join(basePath, '.agents', 'skills', 'interactive-visuals');
  mkdirSync(targetDir, { recursive: true });
  copyFileSync(source, join(targetDir, 'SKILL.md'));
}

/** Permanently remove the contained filesystem owned by a deleted project. */
export async function deleteProjectWorkspaceDirectory(
  projectId: string,
): Promise<void> {
  await rm(projectWorkspacePath(projectId), { recursive: true, force: true });
}

/** Restore filesystem workspaces that were created by earlier app processes. */
export function discoverProjectWorkspaces(): Workspace[] {
  return readdirSync(workspacesDir, { withFileTypes: true })
    .filter(
      (entry) => entry.isDirectory() && entry.name.startsWith(WORKSPACE_PREFIX),
    )
    .map((entry) =>
      createProjectWorkspace(entry.name.slice(WORKSPACE_PREFIX.length)),
    );
}

/**
 * Keep a Mastra process (the app backend or Studio) aligned with the shared
 * project workspace directory. Project creation/deletion can happen in the
 * other process, so a startup-only scan leaves Studio with stale entries.
 */
export function syncProjectWorkspaceRegistry(mastra: Mastra): void {
  const projectIds = readdirSync(workspacesDir, { withFileTypes: true })
    .filter(
      (entry) => entry.isDirectory() && entry.name.startsWith(WORKSPACE_PREFIX),
    )
    .map((entry) => entry.name.slice(WORKSPACE_PREFIX.length));
  const diskWorkspaceIds = new Set(
    projectIds.map((projectId) => projectWorkspaceId(projectId)),
  );
  const registered = mastra.listWorkspaces();

  for (const projectId of projectIds) {
    const workspaceId = projectWorkspaceId(projectId);
    if (registered[workspaceId]) continue;

    const workspace = createProjectWorkspace(projectId);
    mastra.addWorkspace(workspace);
    void initializeProjectWorkspace(workspace).catch((error: unknown) => {
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

/** Watch for projects created or deleted by another Mastra process. */
export function watchProjectWorkspaceRegistry(mastra: Mastra): FSWatcher {
  syncProjectWorkspaceRegistry(mastra);

  let debounce: ReturnType<typeof setTimeout> | undefined;
  const watcher = watch(workspacesDir, () => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => syncProjectWorkspaceRegistry(mastra), 75);
  });
  watcher.on('error', (error) => {
    console.error('[workspace] directory watcher failed', error);
  });
  watcher.unref();
  return watcher;
}

/** Initialize each workspace once even when startup and a request overlap. */
export async function initializeProjectWorkspace(
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
