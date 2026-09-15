import { Injectable } from '@nestjs/common';
import type { Agent } from '@mastra/core/agent';
import { mastra } from './index';
import type { Workspace } from '@mastra/core/workspace';
import {
  createProjectWorkspace,
  deleteProjectWorkspaceDirectory,
  initializeProjectWorkspace,
  projectWorkspaceId,
} from './project-workspaces';

// Thin DI wrapper around the standalone Mastra instance. Keeps the rest of
// the backend Mastra-agnostic and localises the blast radius of a breaking
// Mastra upgrade.
@Injectable()
export class MastraService {
  readonly mastra = mastra;

  getAgent(id: string): Agent {
    // Mastra types getAgent to the registered keys for DX; this wrapper is a
    // generic accessor, so widen the arg. Unknown ids throw at runtime.
    return this.mastra.getAgent(id as Parameters<typeof mastra.getAgent>[0]);
  }

  /** Create or restore a project-scoped workspace and register it with Mastra. */
  async ensureProjectWorkspace(
    projectId: string,
    projectName?: string,
  ): Promise<Workspace> {
    const workspaceId = projectWorkspaceId(projectId);
    const registered = this.mastra.listWorkspaces()[workspaceId]?.workspace;
    if (registered) return initializeProjectWorkspace(registered);

    const workspace = createProjectWorkspace(projectId, projectName);
    this.mastra.addWorkspace(workspace);
    return initializeProjectWorkspace(workspace);
  }

  /** Remove the project's agent memory, registry entry, and workspace files. */
  async deleteProjectResources(projectId: string): Promise<void> {
    const memory = await this.getAgent('assistant').getMemory();
    await memory?.deleteThread(projectId);

    const workspaceId = projectWorkspaceId(projectId);
    await this.mastra.removeWorkspace(workspaceId, { destroy: true });
    await deleteProjectWorkspaceDirectory(projectId);
  }
}
