import { Injectable, computed, signal } from '@angular/core';
import { Observable, catchError, throwError } from 'rxjs';
import {
  QueryRerunResult,
} from '../../../shared/query-evidence/query-evidence.model';
import {
  QueryOpener,
  queryOpenerOf,
} from '../../../shared/query-evidence/query-opener';
import { WorkflowRun } from '../../workflows/models/workflow.model';
import { RunEvidenceApi } from '../../workflows/services/run-query-evidence-api';

/** What the sheet says in place of the inspector once the backend forgot the draft (plan m1-25 section 5). */
export const PREVIEW_GONE_MESSAGE =
  'This preview is no longer available. Run it again.';

/**
 * The query inspector's state for Try it (ui.md 4.5.1): the draft run's id
 * (from the stream's `run` event), its finished run as the evidence calls
 * update it, the question that was run and the query open in the sheet. The
 * sheet lives in the app's main column, not in the Details panel where Try it
 * is, so both read this one object. It is also the inspector's adapter over
 * the draft run (api.md 139 to 143).
 */
@Injectable({ providedIn: 'root' })
export class TryItInspector extends RunEvidenceApi {
  readonly question = signal<string | null>(null);
  /** The finished draft run, updated by each evidence call. */
  readonly run = signal<WorkflowRun | null>(null);
  /** The query open in the sheet (an index into the answer's `data`). */
  readonly openIndex = signal<number | null>(null);
  /** A call answered 404: the backend no longer holds the draft. */
  readonly expired = signal(false);

  private readonly runId = signal<string | null>(null);
  private opener: QueryOpener | null = null;

  readonly answer = computed(() => this.run()?.answer ?? null);
  /** The query to show in the sheet, when the answer holds it. */
  readonly open = computed(() => {
    const index = this.openIndex();
    const answer = this.answer();
    return index !== null && answer !== null && answer.data?.[index] !== undefined
      ? { index, answer }
      : null;
  });

  /** A new run starts: forget the old run, its question and the open query. */
  begin(question: string): void {
    this.forget();
    this.question.set(question);
  }

  /** The stream's `run` event: the draft's id. */
  setRunId(id: string): void {
    this.runId.set(id);
  }

  /** The stream ended with a run: keep it, and build its evidence in the background. */
  finish(run: WorkflowRun): void {
    if (this.runId() === null) this.runId.set(run.id);
    this.run.set(run);
    if (run.answer?.data?.length) {
      this.prepare().subscribe({ error: () => undefined });
    }
  }

  /** Drop the run, the question and the open query. */
  forget(): void {
    this.question.set(null);
    this.run.set(null);
    this.runId.set(null);
    this.openIndex.set(null);
    this.expired.set(false);
    this.opener = null;
  }

  /** A chip or a row opened a query; the focus goes back to it on close. */
  inspect(index: number): void {
    if (this.openIndex() === null) {
      const active = window.document.activeElement;
      this.opener = active === null ? null : queryOpenerOf(active);
    }
    this.openIndex.set(index);
  }

  /** Close the sheet; answers what opened it, to focus again. */
  close(): QueryOpener | null {
    const opener = this.opener;
    this.opener = null;
    this.openIndex.set(null);
    return opener;
  }

  protected shownRun(): WorkflowRun | null {
    const run = this.run();
    const id = this.runId();
    return run === null || id === null ? null : { ...run, id };
  }

  protected showRun(run: WorkflowRun): void {
    if (run.id === this.runId()) this.run.set(run);
  }

  override prepare(): Observable<void> {
    return super.prepare().pipe(this.noteGone());
  }

  override explain(index: number): Observable<void> {
    return super.explain(index).pipe(this.noteGone());
  }

  override countStages(index: number): Observable<void> {
    return super.countStages(index).pipe(this.noteGone());
  }

  override rerun(index: number): Observable<QueryRerunResult> {
    return super.rerun(index).pipe(this.noteGone());
  }

  override downloadCsv(index: number): Observable<Blob> {
    return super.downloadCsv(index).pipe(this.noteGone());
  }

  /** A 404 means the draft was dropped (30 minutes, or the backend restarted). */
  private noteGone<T>() {
    return (source: Observable<T>): Observable<T> =>
      source.pipe(
        catchError((err: unknown) => {
          if ((err as { status?: number } | null)?.status === 404) {
            this.expired.set(true);
          }
          return throwError(() => err);
        }),
      );
  }
}
