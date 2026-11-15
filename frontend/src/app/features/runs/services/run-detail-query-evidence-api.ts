import { Injectable, inject } from '@angular/core';
import { WorkflowRun } from '../../workflows/models/workflow.model';
import { RunEvidenceApi } from '../../workflows/services/run-query-evidence-api';
import { RunsState } from './runs-state';

/** The run detail page's host of the query inspector: the run is the one reopened. */
@Injectable()
export class RunDetailQueryEvidenceApi extends RunEvidenceApi {
  private readonly state = inject(RunsState);

  protected shownRun(): WorkflowRun | null {
    return this.state.activeRun();
  }

  protected showRun(run: WorkflowRun): void {
    if (this.state.activeRun()?.id === run.id) this.state.activeRun.set(run);
  }
}
