import { Injectable } from '@nestjs/common';
import type { Agent } from '@mastra/core/agent';
import { mastra } from './index';
import type { Workspace } from '@mastra/core/workspace';
import {
  createSessionWorkspace,
  deleteSessionWorkspaceDirectory,
  initializeSessionWorkspace,
  sessionWorkspaceId,
} from './session-workspaces';

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

  /** Create or restore a session-scoped workspace and register it with Mastra. */
  async ensureSessionWorkspace(
    sessionId: string,
    sessionName?: string,
  ): Promise<Workspace> {
    const workspaceId = sessionWorkspaceId(sessionId);
    const registered = this.mastra.listWorkspaces()[workspaceId]?.workspace;
    if (registered) return initializeSessionWorkspace(registered);

    const workspace = createSessionWorkspace(sessionId, sessionName);
    this.mastra.addWorkspace(workspace);
    return initializeSessionWorkspace(workspace);
  }

  /** Remove the session's agent memory, registry entry, and workspace files. */
  async deleteSessionResources(sessionId: string): Promise<void> {
    const memory = await this.getAgent('assistant').getMemory();
    await memory?.deleteThread(sessionId);

    const workspaceId = sessionWorkspaceId(sessionId);
    await this.mastra.removeWorkspace(workspaceId, { destroy: true });
    await deleteSessionWorkspaceDirectory(sessionId);
  }
}
