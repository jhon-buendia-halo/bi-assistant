import { Injectable } from '@nestjs/common';
import type { Agent } from '@mastra/core/agent';
import { mastra } from './index';
import type { Workspace } from '@mastra/core/workspace';
import type { RequestContext } from '@mastra/core/request-context';
import {
  createSessionWorkspace,
  deleteSessionWorkspaceDirectory,
  initializeSessionWorkspace,
  sessionWorkspaceId,
} from './session-workspaces';

/** A workflow run event, as the session code reads it (agents.md 5.11). */
export interface WorkflowRunEvent {
  type: string;
  payload?: { id?: string; status?: string };
}

/** A workflow run's outcome: `failed` carries the step's error. */
export interface WorkflowRunResult {
  status: string;
  error?: unknown;
  result?: unknown;
}

/** A streamed workflow run. */
export interface WorkflowRunStream {
  fullStream: AsyncIterable<WorkflowRunEvent>;
  result: Promise<WorkflowRunResult>;
}

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

  /** Every registered agent, keyed by its registry name. */
  listAgents(): Record<string, Agent> {
    return this.mastra.listAgents();
  }

  /**
   * Start a run of a registered workflow and stream it (agents.md 5.11): its
   * step events on `fullStream`, its outcome on `result`.
   */
  async streamWorkflow(
    key: string,
    inputData: unknown,
    requestContext: RequestContext,
  ): Promise<WorkflowRunStream> {
    const workflow = this.mastra.getWorkflow(
      key as Parameters<typeof mastra.getWorkflow>[0],
    );
    const run = await workflow.createRun();
    const output = run.stream({
      inputData: inputData as Parameters<typeof run.stream>[0]['inputData'],
      requestContext,
    });
    return {
      fullStream: output.fullStream as AsyncIterable<WorkflowRunEvent>,
      result: output.result,
    };
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
