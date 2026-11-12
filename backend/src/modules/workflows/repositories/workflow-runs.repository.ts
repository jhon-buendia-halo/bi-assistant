import { Inject, Injectable } from '@nestjs/common';
import { SUPER_ADMIN } from '../../../common/super-admin';
import {
  WORKFLOW_RUNS_STORE,
  type DocStore,
} from '../../../infrastructure/database/doc-store';
import type { WorkflowRunDoc } from '../workflow-run-steps';

/**
 * Stored workflow runs, collection `workflow_runs` (data-model 3.16): one
 * document per run, written when it starts and updated when it ends.
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

  /** The runs still `running`: at start-up, the ones the app stopped in. */
  listRunning(): Promise<WorkflowRunDoc[]> {
    return this.store.find({ status: 'running' });
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
