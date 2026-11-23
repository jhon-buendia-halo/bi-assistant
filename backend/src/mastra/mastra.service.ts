import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
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
import { planWithModel, writeAnswerWithModel } from './workflows/step-agents';
import {
  mapDataWithModel,
  readDashboardWithModel,
} from './workflows/recreate-dashboard.agents';
import { readImagesWithModel } from './workflows/read-images.agents';
import {
  deriveRequirementsWithModel,
  mapRequirementsWithModel,
  recommendFixesWithModel,
  reviseRequirementsWithModel,
} from './workflows/consumption-gap-analysis.agents';
import { reviewTemplateWithModel } from './workflows/review-website.agents';
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
   * agents.md 2.17): one `result-explorer` call, no tools, the reply turned
   * into `{ action, query, interpretation }` by `specOf`.
   */
  interpretResult(
    ...args: Parameters<typeof interpretResultWithModel>
  ): ReturnType<typeof interpretResultWithModel> {
    return interpretResultWithModel(...args);
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
   * The Read images step model call of Answer a Business Question, Assess
   * Data Readiness and Map a Dashboard to Data (agents.md 2.15; workflows
   * R35): Zoe, the Image Reader, over every reference image of the run in
   * one call, her notes rendered from the reply. A model error rejects.
   */
  readImages(
    ...args: Parameters<typeof readImagesWithModel>
  ): ReturnType<typeof readImagesWithModel> {
    return readImagesWithModel(...args);
  }

  /**
   * The Review templates step model call of Review a Website (agents.md
   * 2.16, 5.19): Iris over one page template's screenshots, clean and
   * marked, in one call. A model error rejects.
   */
  reviewTemplate(
    ...args: Parameters<typeof reviewTemplateWithModel>
  ): ReturnType<typeof reviewTemplateWithModel> {
    return reviewTemplateWithModel(...args);
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

  /**
   * Consumption Gap Analysis's model calls (agents.md 2.18 to 2.20, 5.20):
   * the Requirements Analyst (Derive and Confirm requirements), the Layer
   * Mapper (Map requirements) and the Gap Advisor (Recommend fixes), each
   * reply read leniently and checked in code.
   */
  deriveRequirements(
    ...args: Parameters<typeof deriveRequirementsWithModel>
  ): ReturnType<typeof deriveRequirementsWithModel> {
    return deriveRequirementsWithModel(...args);
  }

  reviseRequirements(
    ...args: Parameters<typeof reviseRequirementsWithModel>
  ): ReturnType<typeof reviseRequirementsWithModel> {
    return reviseRequirementsWithModel(...args);
  }

  mapRequirements(
    ...args: Parameters<typeof mapRequirementsWithModel>
  ): ReturnType<typeof mapRequirementsWithModel> {
    return mapRequirementsWithModel(...args);
  }

  recommendFixes(
    ...args: Parameters<typeof recommendFixesWithModel>
  ): ReturnType<typeof recommendFixesWithModel> {
    return recommendFixesWithModel(...args);
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
      // The workflow's own delete removes the top row and drops the suspended
      // Run from its in-memory map; the nested rows share the run id.
      discard: async () => {
        try {
          await workflow.deleteWorkflowRunById(run.runId);
        } catch (failure) {
          new Logger(MastraService.name).warn(
            `Could not delete the run's snapshot: ${failure instanceof Error ? failure.message : String(failure)}`,
          );
        }
        await this.deleteSnapshotRows(undefined, run.runId);
      },
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
   * Delete the suspended run snapshots of a registered workflow, or with no
   * `key` of every one in the workflows store (ADR-0043; workflows R20): at
   * start-up nothing can resume them, as their runtime lived in memory. A
   * suspended run stores one row per nested workflow on its path, under the
   * nested workflow's own id, and `Mastra.listWorkflows` lists only the
   * top-level ones, so the keyless form lists the store directly. A keyed
   * call throws as before. Answers how many were deleted.
   */
  async discardSuspendedWorkflowRuns(key?: string): Promise<number> {
    if (key !== undefined) {
      type Discardable = {
        listWorkflowRuns(args: { status: 'suspended' }): Promise<unknown>;
        deleteWorkflowRunById(runId: string): Promise<unknown>;
      };
      const workflow = this.mastra.getWorkflow(
        key as Parameters<typeof mastra.getWorkflow>[0],
      ) as unknown as Discardable;
      const listed = (await workflow.listWorkflowRuns({
        status: 'suspended',
      })) as { runs: { runId: string }[] };
      for (const run of listed.runs) {
        await workflow.deleteWorkflowRunById(run.runId);
      }
      return listed.runs.length;
    }
    return this.deleteSnapshotRows('suspended');
  }

  /**
   * List the workflows store with no workflow name, page by page until a
   * short page, and delete the rows that match `status` and `runId` by their
   * run id and workflow name (workflows R20). The pages are read in full
   * before any delete, so a row that fails to delete (and stays) cannot make
   * the paging loop. A failing row or page is logged and the rest still go. A
   * storage with no workflows store, or a stand-in without the two methods,
   * deletes nothing and logs once. Answers how many rows were deleted.
   */
  private async deleteSnapshotRows(
    status?: 'suspended',
    runId?: string,
  ): Promise<number> {
    type Row = { runId: string; workflowName: string };
    type Store = {
      listWorkflowRuns(args: {
        status?: 'suspended';
        perPage: number;
        page: number;
      }): Promise<{ runs: Row[] }>;
      deleteWorkflowRunById(args: {
        runId: string;
        workflowName: string;
      }): Promise<void>;
    };
    const logger = new Logger(MastraService.name);
    const failed = (what: string, failure: unknown) =>
      logger.warn(
        `Could not ${what}: ${failure instanceof Error ? failure.message : String(failure)}`,
      );
    let store: Store | undefined;
    try {
      store = await this.mastra.getStorage()?.getStore('workflows');
    } catch (failure) {
      failed('open the workflows store', failure);
      return 0;
    }
    if (
      typeof store?.listWorkflowRuns !== 'function' ||
      typeof store.deleteWorkflowRunById !== 'function'
    ) {
      logger.warn('No workflows store to clean: no snapshots were deleted');
      return 0;
    }
    const perPage = 100;
    const rows: Row[] = [];
    try {
      for (let page = 0; ; page += 1) {
        const listed = await store.listWorkflowRuns({
          ...(status ? { status } : {}),
          perPage,
          page,
        });
        rows.push(...listed.runs);
        if (listed.runs.length < perPage) break;
      }
    } catch (failure) {
      failed('list the workflow snapshots', failure);
    }
    let deleted = 0;
    for (const row of rows) {
      if (runId !== undefined && row.runId !== runId) continue;
      try {
        await store.deleteWorkflowRunById({
          runId: row.runId,
          workflowName: row.workflowName,
        });
        deleted += 1;
      } catch (failure) {
        failed(
          `delete snapshot ${row.runId} of workflow ${row.workflowName}`,
          failure,
        );
      }
    }
    return deleted;
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
   * Exchanges of one thread are written one after the other, in the order
   * they finish (Grace's image reads run together, agents.md 5.20): two
   * first exchanges never both create the thread. A failed write rejects
   * its own call only; the next one still goes.
   */
  recordAgentExchange(
    hostId: string,
    agentKey: string,
    exchange: AgentExchange,
  ): Promise<void> {
    const threadId = agentThreadId(hostId, agentKey);
    const previous = this.threadWrites.get(threadId) ?? Promise.resolve();
    const write = previous.then(() =>
      this.writeAgentExchange(hostId, agentKey, threadId, exchange),
    );
    const settled = write.catch(() => undefined);
    this.threadWrites.set(threadId, settled);
    // The queue is dropped once its last write has settled.
    void settled.then(() => {
      if (this.threadWrites.get(threadId) === settled) {
        this.threadWrites.delete(threadId);
      }
    });
    return write;
  }

  /** The last write queued per thread (`recordAgentExchange`). */
  private readonly threadWrites = new Map<string, Promise<void>>();

  private async writeAgentExchange(
    hostId: string,
    agentKey: string,
    threadId: string,
    exchange: AgentExchange,
  ): Promise<void> {
    const memory = await this.getAgent('assistant').getMemory();
    if (!memory) return;
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
