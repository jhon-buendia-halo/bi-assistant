import { Injectable, inject } from '@angular/core';
import { Observable, map, tap, throwError } from 'rxjs';
import {
  QueryEvidenceApi,
  QueryRerunResult,
} from '../../../shared/query-evidence/query-evidence.model';
import { WorkflowRun } from '../models/workflow.model';
import { WorkflowDesigner } from './workflow-designer.service';
import { WorkflowRunsApiService } from './workflow-runs-api.service';

/**
 * The query inspector's host adapter for the Run panel: it calls the run's
 * evidence endpoints (api.md 139 to 143) for the run the designer shows, and
 * hands each updated run back to the designer so the answer view redraws.
 */
@Injectable()
export class RunQueryEvidenceApi implements QueryEvidenceApi {
  private readonly designer = inject(WorkflowDesigner);
  private readonly runs = inject(WorkflowRunsApiService);

  prepare(): Observable<void> {
    return this.withRun((id) =>
      this.runs.prepareEvidence(id).pipe(this.apply()),
    );
  }

  explain(index: number): Observable<void> {
    return this.withRun((id) =>
      this.runs.explainQuery(id, index).pipe(this.apply()),
    );
  }

  countStages(index: number): Observable<void> {
    return this.withRun((id) =>
      this.runs.countQueryStages(id, index).pipe(this.apply()),
    );
  }

  rerun(index: number): Observable<QueryRerunResult> {
    return this.withRun((id) =>
      this.runs.rerunQuery(id, index).pipe(map((response) => response.result)),
    );
  }

  downloadCsv(index: number): Observable<Blob> {
    return this.withRun((id) => this.runs.queryCsv(id, index));
  }

  private withRun<T>(call: (id: string) => Observable<T>): Observable<T> {
    const id = this.designer.run()?.id;
    return id === undefined
      ? throwError(() => new Error('The run is not stored yet'))
      : call(id);
  }

  /** Show the run the call answered; the caller needs nothing else. */
  private apply() {
    return (source: Observable<{ run: WorkflowRun }>): Observable<void> =>
      source.pipe(
        tap((response) => this.designer.applyRun(response.run)),
        map(() => undefined),
      );
  }
}
