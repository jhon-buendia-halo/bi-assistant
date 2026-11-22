import { Injectable, inject } from '@angular/core';
import { Observable, map, tap, throwError } from 'rxjs';
import {
  FilterInterpretation,
  PageRequest,
  PageResult,
  QueryEvidenceApi,
  QueryRerunResult,
  ResultView,
} from '../../../shared/query-evidence/query-evidence.model';
import { WorkflowRun } from '../models/workflow.model';
import { WorkflowDesigner } from './workflow-designer.service';
import { WorkflowRunsApiService } from './workflow-runs-api.service';

/**
 * The query inspector's adapter over a stored run: it calls the run's
 * evidence endpoints (api.md 139 to 143) for the run its host shows, and hands
 * each updated run back to the host so the answer view redraws. A host
 * (the Run panel, the run detail page) only says which run is shown and how to
 * show an updated one.
 */
export abstract class RunEvidenceApi implements QueryEvidenceApi {
  private readonly runs = inject(WorkflowRunsApiService);

  /** The run the host shows; null when none is stored yet. */
  protected abstract shownRun(): WorkflowRun | null;
  /** Show the run a call answered (when it is still the one shown). */
  protected abstract showRun(run: WorkflowRun): void;

  prepare(): Observable<void> {
    return this.withRun((id) =>
      this.runs.prepareEvidence(id).pipe(this.apply()),
    );
  }

  explain(index: number, refresh = false): Observable<void> {
    return this.withRun((id) =>
      this.runs.explainQuery(id, index, refresh).pipe(this.apply()),
    );
  }

  previewStep(index: number, step: number): Observable<void> {
    return this.withRun((id) =>
      this.runs.previewQueryStep(id, index, step).pipe(this.apply()),
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

  page(index: number, request: PageRequest): Observable<PageResult> {
    return this.withRun((id) =>
      this.runs
        .pageQuery(id, index, request)
        .pipe(map((response) => response.result)),
    );
  }

  interpretFilter(
    index: number,
    text: string,
    view: ResultView | null,
  ): Observable<FilterInterpretation> {
    return this.withRun((id) =>
      this.runs
        .interpretFilter(id, index, text, view)
        .pipe(map((response) => response.interpretation)),
    );
  }

  private withRun<T>(call: (id: string) => Observable<T>): Observable<T> {
    const id = this.shownRun()?.id;
    return id === undefined
      ? throwError(() => new Error('The run is not stored yet'))
      : call(id);
  }

  private apply() {
    return (source: Observable<{ run: WorkflowRun }>): Observable<void> =>
      source.pipe(
        tap((response) => this.showRun(response.run)),
        map(() => undefined),
      );
  }
}

/** The Run panel of a workflow's page: the run is the designer's. */
@Injectable()
export class RunQueryEvidenceApi extends RunEvidenceApi {
  private readonly designer = inject(WorkflowDesigner);

  /** The run whose query is open: an earlier conversation turn's, else the shown run. */
  protected shownRun(): WorkflowRun | null {
    return this.designer.queryRun() ?? this.designer.run();
  }

  protected showRun(run: WorkflowRun): void {
    this.designer.applyRun(run);
  }
}
