import { Inject, Injectable } from '@nestjs/common';
import { SUPER_ADMIN } from '../../../common/super-admin';
import {
  WORKFLOW_RUNS_STORE,
  type DocStore,
} from '../../../infrastructure/database/doc-store';
import type { WorkflowRunDoc } from '../workflow-run-steps';

/**
 * Stored workflow runs, collection `workflow_runs` (data-model 3.16): one
 * document per run, written when it is accepted, its `steps` updated at each step
 * change while it runs, and the whole run updated when it ends.
 */
@Injectable()
export class WorkflowRunsRepository {
  constructor(
    @Inject(WORKFLOW_RUNS_STORE)
    private readonly store: DocStore<WorkflowRunDoc>,
  ) {}

  /** A new run, stamped with the legacy inert owner (data-model 3.14). */
  insert(run: WorkflowRunDoc): Promise<WorkflowRunDoc> {
    return this.store.insert({ ...run, ownerId: SUPER_ADMIN.id });
  }

  get(id: string): Promise<WorkflowRunDoc | null> {
    return this.store.findOne({ id });
  }

  /** Every run, or one workflow's, newest `startedAt` first. */
  list(workflowId?: string): Promise<WorkflowRunDoc[]> {
    return this.store.find(workflowId ? { workflowId } : {}, {
      sort: { startedAt: -1 },
    });
  }

  /** The runs of one conversation with Avery, oldest first (workflows R45). */
  listConversation(conversationId: string): Promise<WorkflowRunDoc[]> {
    return this.store.find({ conversationId }, { sort: { startedAt: 1 } });
  }

  /**
   * Every run of these workflows, whatever its status (M18: the runs of the
   * removed ones).
   */
  async listByWorkflowIds(
    workflowIds: readonly string[],
  ): Promise<WorkflowRunDoc[]> {
    const lists = await Promise.all(
      workflowIds.map((workflowId) => this.store.find({ workflowId })),
    );
    return lists.flat();
  }

  /** The runs still `running`: at start-up, the ones the app stopped in. */
  listRunning(): Promise<WorkflowRunDoc[]> {
    return this.store.find({ status: 'running' });
  }

  /** The runs waiting for a slot, in line: oldest `queuedAt` first. */
  listQueued(): Promise<WorkflowRunDoc[]> {
    return this.store.find({ status: 'queued' }, { sort: { queuedAt: 1 } });
  }

  /**
   * The runs still `suspended` (waiting for an answer): at start-up, the
   * ones that can no longer be resumed (ADR-0043).
   */
  listSuspended(): Promise<WorkflowRunDoc[]> {
    return this.store.find({ status: 'suspended' });
  }

  update(
    id: string,
    patch: Partial<WorkflowRunDoc>,
  ): Promise<WorkflowRunDoc | null> {
    return this.store.update({ id }, patch);
  }

  delete(id: string): Promise<number> {
    return this.store.deleteOne({ id });
  }
}
