import { Injectable, inject } from '@angular/core';
import {
  PageRequest,
  PageResult,
  QueryEvidenceApi,
  QueryRerunResult,
} from '../../../shared/query-evidence/query-evidence.model';
import { queryEvidenceApiOver } from '../../../shared/query-evidence/evidence-calls';
import { Observable, map } from 'rxjs';
import { ChatMessage } from '../models/session.model';
import { SessionsApiService } from './sessions-api.service';

/** One message of a stored session: `message` is its index among all messages. */
export interface SessionMessageRef {
  sessionId: string;
  message: number;
}

/**
 * The query inspector's adapter over one assistant message of a past chat
 * (api.md 144 to 148). The chat says which message is open (`bind`) and how
 * to show the message a call answered; the calls themselves are the shared
 * adapter's.
 */
@Injectable()
export class SessionQueryEvidenceApi implements QueryEvidenceApi {
  private readonly sessions = inject(SessionsApiService);

  private target: SessionMessageRef | null = null;
  private show: (ref: SessionMessageRef, message: ChatMessage) => void = () =>
    undefined;

  /** Point the adapter at the open message; `null` when none is open. */
  bind(
    target: SessionMessageRef | null,
    show: (ref: SessionMessageRef, message: ChatMessage) => void,
  ): void {
    this.target = target;
    this.show = show;
  }

  private readonly api = queryEvidenceApiOver<
    SessionMessageRef,
    { ref: SessionMessageRef; message: ChatMessage }
  >(
    () => this.target,
    ({ ref, message }) => this.show(ref, message),
    {
      prepare: (t) => this.withRef(t, this.sessions.prepareEvidence(t.sessionId, t.message)),
      explain: (t, i) =>
        this.withRef(t, this.sessions.explainQuery(t.sessionId, t.message, i)),
      countStages: (t, i) =>
        this.withRef(
          t,
          this.sessions.countQueryStages(t.sessionId, t.message, i),
        ),
      rerun: (t, i) => this.sessions.rerunQuery(t.sessionId, t.message, i),
      downloadCsv: (t, i) => this.sessions.queryCsv(t.sessionId, t.message, i),
      page: (t, i, request) =>
        this.sessions.pageQuery(t.sessionId, t.message, i, request),
    },
  );

  prepare = (): Observable<void> => this.api.prepare();
  explain = (index: number): Observable<void> => this.api.explain(index);
  countStages = (index: number): Observable<void> =>
    this.api.countStages(index);
  rerun = (index: number): Observable<QueryRerunResult> =>
    this.api.rerun(index);
  downloadCsv = (index: number): Observable<Blob> =>
    this.api.downloadCsv(index);

  page = (index: number, request: PageRequest): Observable<PageResult> =>
    this.api.page(index, request);

  private withRef(
    ref: SessionMessageRef,
    call: Observable<{ message: ChatMessage }>,
  ) {
    return call.pipe(map((response) => ({ ref, message: response.message })));
  }
}
