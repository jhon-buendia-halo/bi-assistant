import { Observable, map, tap, throwError } from 'rxjs';
import { QueryEvidenceApi, QueryRerunResult } from './query-evidence.model';

/**
 * The five calls of one kind of answer host (a stored run: api.md 139 to 143;
 * a session's message: 144 to 148), each for a target `T` (the run id, the
 * session and message) and answering the updated answer `U`.
 */
export interface EvidenceCalls<T, U> {
  prepare(target: T): Observable<U>;
  explain(target: T, index: number): Observable<U>;
  countStages(target: T, index: number): Observable<U>;
  rerun(target: T, index: number): Observable<{ result: QueryRerunResult }>;
  downloadCsv(target: T, index: number): Observable<Blob>;
}

/**
 * The inspector's adapter over any host that has these five calls: every call
 * that stores something hands the updated answer to `show`; a host with no
 * stored answer yet (`target()` is null) fails the call.
 */
export function queryEvidenceApiOver<T, U>(
  target: () => T | null,
  show: (updated: U) => void,
  calls: EvidenceCalls<T, U>,
): QueryEvidenceApi {
  const withTarget = <R>(call: (t: T) => Observable<R>): Observable<R> => {
    const t = target();
    return t === null
      ? throwError(() => new Error('The answer is not stored yet'))
      : call(t);
  };
  const apply =
    () =>
    (source: Observable<U>): Observable<void> =>
      source.pipe(
        tap(show),
        map(() => undefined),
      );
  return {
    prepare: () => withTarget((t) => calls.prepare(t).pipe(apply())),
    explain: (i) => withTarget((t) => calls.explain(t, i).pipe(apply())),
    countStages: (i) =>
      withTarget((t) => calls.countStages(t, i).pipe(apply())),
    rerun: (i) =>
      withTarget((t) =>
        calls.rerun(t, i).pipe(map((response) => response.result)),
      ),
    downloadCsv: (i) => withTarget((t) => calls.downloadCsv(t, i)),
  };
}
