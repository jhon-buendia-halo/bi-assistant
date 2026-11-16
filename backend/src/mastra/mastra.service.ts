import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Agent } from '@mastra/core/agent';
import {
  agentThreadId,
  copiedThreadId,
  exchangeMessages,
  type AgentExchange,
} from './agent-threads';
import { mastra } from './index';
import type { Workspace } from '@mastra/core/workspace';
import type { RequestContext } from '@mastra/core/request-context';
import { explainQueryWithModel } from './agents/query-explainer.agent';
import { interpretResultWithModel } from './agents/result-explorer.agent';
import {
  checkDataQualityWithModel,
  planWithModel,
  writeAnswerWithModel,
} from './workflows/answer-business-question.agents';
import {
  mapDataWithModel,
  readDashboardWithModel,
} from './workflows/recreate-dashboard.agents';
import {
  createSessionWorkspace,
  deleteSessionWorkspaceDirectory,
  initializeSessionWorkspace,
  sessionWorkspaceId,
} from './session-workspaces';

/** A workflow run event, as the session code reads it (agents.md 5.11). */
export interface WorkflowRunEvent {
  type: string;
  payload?: {
    id?: string;
    status?: string;
    output?: unknown;
    error?: unknown;
    /** `workflow-step-suspended`: what the step suspended with. */
    suspendPayload?: unknown;
  };
}

/**
 * A streamed workflow run's outcome: `failed` carries the step's error;
 * `suspended` the path of each waiting step, from the top-level workflow
 * down (`suspended`), to hand back unchanged when resuming, and each
 * top-level step's result (`steps`, a waiting one with its
 * `suspendPayload`).
 */
export interface WorkflowStreamOutcome {
  status: string;
  error?: unknown;
  result?: unknown;
  suspended?: string[][];
  steps?: Record<string, { suspendPayload?: unknown } | undefined>;
}

/**
 * A streamed workflow run. A suspended run (ADR-0043) is resumed with
 * `resume` (a new stream of the same run, from the waiting step), and a
 * suspended run that will never resume is discarded with `discard` (its
 * snapshot deleted). Stand-ins may leave both out.
 */
export interface WorkflowRunStream {
  fullStream: AsyncIterable<WorkflowRunEvent>;
  result: Promise<WorkflowStreamOutcome>;
  resume?: (args: {
    step: string[];
    resumeData: unknown;
    requestContext?: RequestContext;
  }) => WorkflowRunStream;
  discard?: () => Promise<void>;
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
   * Insights Analyst's Plan step model call (agents.md 5.11): the
   * agent's model, no tools, the plan read from its reply.
   */
  planAnalysis(
    ...args: Parameters<typeof planWithModel>
  ): ReturnType<typeof planWithModel> {
    return planWithModel(...args);
  }

  /**
   * Insights Analyst's Write answer step model call (agents.md
   * 5.11): the agent's model, no tools, the answer streamed to `onText`.
   */
  writeAnswer(
    ...args: Parameters<typeof writeAnswerWithModel>
  ): ReturnType<typeof writeAnswerWithModel> {
    return writeAnswerWithModel(...args);
  }

  /**
   * The query inspector's explanation of one stored query (api.md 140): the
   * `query-explainer` agent's model, no tools, the steps read from her reply.
   */
  explainQuery(
    ...args: Parameters<typeof explainQueryWithModel>
  ): ReturnType<typeof explainQueryWithModel> {
    return explainQueryWithModel(...args);
  }

  /**
   * A user's words read as a view of a query's result (api.md 153, 155;
   * agents.md 2.15): one `result-explorer` call, no tools, the reply turned
   * into `{ action, query, interpretation }` by `specOf`.
   */
  interpretResult(
    ...args: Parameters<typeof interpretResultWithModel>
  ): ReturnType<typeof interpretResultWithModel> {
    return interpretResultWithModel(...args);
  }

  /**
   * Insights Analyst's optional Check data quality step model call
   * (agents.md 5.11): Sarah's model, no tools, the issues read from her
   * reply.
   */
  checkDataQuality(
    ...args: Parameters<typeof checkDataQualityWithModel>
  ): ReturnType<typeof checkDataQualityWithModel> {
    return checkDataQualityWithModel(...args);
  }

  /**
   * Dashboard Image to Artifact's Read dashboard step model call (agents.md
   * 5.17): the Dashboard Reader over the image, the blueprint read from
   * its reply.
   */
  readDashboard(
    ...args: Parameters<typeof readDashboardWithModel>
  ): ReturnType<typeof readDashboardWithModel> {
    return readDashboardWithModel(...args);
  }

  /**
   * Dashboard Image to Artifact's Map data step model call (agents.md 5.17): the
   * Data Mapper over the blueprint and the catalog, the mapping read from
   * its reply and checked against the catalog.
   */
  mapData(
    ...args: Parameters<typeof mapDataWithModel>
  ): ReturnType<typeof mapDataWithModel> {
    return mapDataWithModel(...args);
  }

  /** Every registered agent, keyed by its registry name. */
  listAgents(): Record<string, Agent> {
    return this.mastra.listAgents();
  }

  /**
   * Start a run of a registered workflow and stream it (agents.md 5.11,
   * 5.14): its step events on `fullStream`, its outcome on `result`. A
   * code-only run workflow needs no `requestContext`. A run that suspends
   * (ADR-0043) is resumed with the stream's `resume` (the same Mastra run,
   * from its snapshot) or dropped with `discard`.
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
    const wrap = (output: {
      fullStream: unknown;
      result: Promise<unknown>;
    }): WorkflowRunStream => ({
      fullStream: output.fullStream as AsyncIterable<WorkflowRunEvent>,
      result: output.result as Promise<WorkflowStreamOutcome>,
      resume: ({ step, resumeData, requestContext: context }) =>
        wrap(
          run.resumeStream({
            step,
            resumeData: resumeData as never,
            ...(context ? { requestContext: context } : {}),
          }),
        ),
      discard: () => workflow.deleteWorkflowRunById(run.runId),
    });
    return wrap(
      run.stream({
        // The key is widened to string, so the registered workflows' input
        // types intersect; the caller passes the input of the workflow it
        // names.
        inputData: inputData as never,
        requestContext,
      }),
    );
  }

  /**
   * Delete every suspended run snapshot of a registered workflow (ADR-0043):
   * at start-up nothing can resume them, as their runtime lived in memory.
   * Answers how many were deleted.
   */
  async discardSuspendedWorkflowRuns(key: string): Promise<number> {
    const workflow = this.mastra.getWorkflow(
      key as Parameters<typeof mastra.getWorkflow>[0],
    );
    const listed = (await workflow.listWorkflowRuns({
      status: 'suspended',
    })) as { runs: { runId: string }[] };
    for (const run of listed.runs) {
      await workflow.deleteWorkflowRunById(run.runId);
    }
    return listed.runs.length;
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

  /** The ids of every memory thread whose resource is `resourceId`. */
  private async threadIdsOf(resourceId: string): Promise<string[]> {
    const memory = await this.getAgent('assistant').getMemory();
    if (!memory) return [];
    const listed = await memory.listThreads({
      filter: { resourceId },
      perPage: false,
    });
    return listed.threads.map((thread) => thread.id);
  }

  /**
   * Delete every memory thread of one session or run host (data-model 5):
   * its own and its step agents' (`agentThreadId`), all with the host id as
   * their resource.
   */
  async deleteMemoryResource(resourceId: string): Promise<void> {
    const memory = await this.getAgent('assistant').getMemory();
    if (!memory) return;
    const ids = new Set([resourceId, ...(await this.threadIdsOf(resourceId))]);
    for (const id of ids) await memory.deleteThread(id);
  }

  /**
   * Copy every memory thread of host `from` to host `to` (a follow-up run,
   * agents.md 5.14): the same suffix (`copiedThreadId`), `to` as the
   * resource. The copies are `to`'s own, so deleting `from` keeps them.
   * Returns how many threads were copied.
   */
  async copyMemoryResource(from: string, to: string): Promise<number> {
    const memory = await this.getAgent('assistant').getMemory();
    if (!memory) return 0;
    let copied = 0;
    for (const sourceThreadId of await this.threadIdsOf(from)) {
      const newThreadId = copiedThreadId(sourceThreadId, from, to);
      if (!newThreadId) continue;
      if (await memory.getThreadById({ threadId: newThreadId })) continue;
      await memory.cloneThread({ sourceThreadId, newThreadId, resourceId: to });
      copied += 1;
    }
    return copied;
  }

  /**
   * Copy one thread to a new id and resource (a node chat that starts from
   * its step's thread, agents.md 5.16). False when there is nothing to copy
   * or the target exists.
   */
  async copyMemoryThread(
    sourceThreadId: string,
    newThreadId: string,
  ): Promise<boolean> {
    const memory = await this.getAgent('assistant').getMemory();
    if (!memory) return false;
    if (!(await memory.getThreadById({ threadId: sourceThreadId }))) {
      return false;
    }
    if (await memory.getThreadById({ threadId: newThreadId })) return false;
    await memory.cloneThread({
      sourceThreadId,
      newThreadId,
      resourceId: newThreadId,
    });
    return true;
  }

  /**
   * Record one exchange of a step agent that runs without memory (Plan,
   * Check data quality, Write answer; agents.md 5.11) in its thread on the
   * host (`agentThreadId`): the request and the reply as two text messages.
   * The call itself is unchanged; the thread is created on first use.
   */
  async recordAgentExchange(
    hostId: string,
    agentKey: string,
    exchange: AgentExchange,
  ): Promise<void> {
    const memory = await this.getAgent('assistant').getMemory();
    if (!memory) return;
    const threadId = agentThreadId(hostId, agentKey);
    if (!(await memory.getThreadById({ threadId }))) {
      await memory.createThread({
        threadId,
        resourceId: hostId,
        title: agentKey,
      });
    }
    await memory.saveMessages({
      messages: exchangeMessages(
        exchange,
        { threadId, resourceId: hostId },
        [randomUUID(), randomUUID()],
        new Date(),
      ),
    });
  }

  /** Remove the session's agent memory, registry entry, and workspace files. */
  async deleteSessionResources(sessionId: string): Promise<void> {
    await this.deleteMemoryResource(sessionId);
    await this.deleteSessionWorkspace(sessionId);
  }

  /** Remove the session's workspace only; its memory threads stay. */
  async deleteSessionWorkspace(sessionId: string): Promise<void> {
    const workspaceId = sessionWorkspaceId(sessionId);
    await this.mastra.removeWorkspace(workspaceId, { destroy: true });
    await deleteSessionWorkspaceDirectory(sessionId);
  }
}
