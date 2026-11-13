import { Injectable } from '@nestjs/common';
import type { Agent } from '@mastra/core/agent';
import { mastra } from './index';
import type { Workspace } from '@mastra/core/workspace';
import type { RequestContext } from '@mastra/core/request-context';
import {
  planWithModel,
  writeAnswerWithModel,
} from './workflows/qti-v2-turn.agents';
import {
  createSessionWorkspace,
  deleteSessionWorkspaceDirectory,
  initializeSessionWorkspace,
  sessionWorkspaceId,
} from './session-workspaces';

/** A workflow run event, as the session code reads it (agents.md 5.11). */
export interface WorkflowRunEvent {
  type: string;
  payload?: { id?: string; status?: string; output?: unknown; error?: unknown };
}

/** A streamed workflow run's outcome: `failed` carries the step's error. */
export interface WorkflowStreamOutcome {
  status: string;
  error?: unknown;
  result?: unknown;
}

/** A streamed workflow run. */
export interface WorkflowRunStream {
  fullStream: AsyncIterable<WorkflowRunEvent>;
  result: Promise<WorkflowStreamOutcome>;
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

  /**
   * Questions to Insights v2's Plan step model call (agents.md 5.11): the
   * agent's model, no tools, the plan read from its reply.
   */
  planV2Turn(
    ...args: Parameters<typeof planWithModel>
  ): ReturnType<typeof planWithModel> {
    return planWithModel(...args);
  }

  /**
   * Questions to Insights v2's Write answer step model call (agents.md
   * 5.11): the agent's model, no tools, the answer streamed to `onText`.
   */
  writeV2Answer(
    ...args: Parameters<typeof writeAnswerWithModel>
  ): ReturnType<typeof writeAnswerWithModel> {
    return writeAnswerWithModel(...args);
  }

  /** Every registered agent, keyed by its registry name. */
  listAgents(): Record<string, Agent> {
    return this.mastra.listAgents();
  }

  /**
   * Start a run of a registered workflow and stream it (agents.md 5.11,
   * 5.14): its step events on `fullStream`, its outcome on `result`. A
   * code-only run workflow needs no `requestContext`.
   */
  async streamWorkflow(
    key: string,
    inputData: unknown,
    requestContext?: RequestContext,
  ): Promise<WorkflowRunStream> {
    const workflow = this.mastra.getWorkflow(
      key as Parameters<typeof mastra.getWorkflow>[0],
    );
    const run = await workflow.createRun();
    const output = run.stream({
      // The key is widened to string, so the registered workflows' input
      // types intersect; the caller passes the input of the workflow it names.
      inputData: inputData as never,
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

  /**
   * Delete one agent memory thread (a run host's, agents.md 5.14). Every
   * agent shares the app's one memory store, so the assistant's handle
   * reaches any agent's thread.
   */
  async deleteMemoryThread(threadId: string): Promise<void> {
    const memory = await this.getAgent('assistant').getMemory();
    await memory?.deleteThread(threadId);
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
