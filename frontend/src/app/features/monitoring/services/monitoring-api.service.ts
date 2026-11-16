import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../../../core/config/api.config';
import {
  LlmCallDetail,
  LlmCallPage,
  LlmCallQuery,
} from '../models/llm-call.model';
import {
  SessionDetail,
  SessionPage,
  SessionQuery,
  TraceDetail,
} from '../models/session-flow.model';

/** The query's set values as HTTP parameters. */
function paramsOf(query: object): HttpParams {
  let params = new HttpParams();
  for (const [name, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') {
      params = params.set(name, String(value));
    }
  }
  return params;
}

/**
 * The Monitoring API (roadmap 1.21.14–1.21.16). Failures surface as
 * HttpErrorResponse whose `error.message` carries the backend's reason.
 */
@Injectable({ providedIn: 'root' })
export class MonitoringApiService {
  private readonly http = inject(HttpClient);

  list(query: LlmCallQuery): Observable<LlmCallPage> {
    return this.http.get<LlmCallPage>(`${API_BASE_URL}/monitoring/llm-calls`, {
      params: paramsOf(query),
    });
  }

  get(id: string): Observable<LlmCallDetail> {
    return this.http.get<LlmCallDetail>(
      `${API_BASE_URL}/monitoring/llm-calls/${encodeURIComponent(id)}`,
    );
  }

  listSessions(query: SessionQuery): Observable<SessionPage> {
    return this.http.get<SessionPage>(`${API_BASE_URL}/monitoring/sessions`, {
      params: paramsOf(query),
    });
  }

  getSession(id: string): Observable<SessionDetail> {
    return this.http.get<SessionDetail>(
      `${API_BASE_URL}/monitoring/sessions/${encodeURIComponent(id)}`,
    );
  }

  /** One turn's spans; framework spans only when `framework` is true. */
  getTrace(traceId: string, framework: boolean): Observable<TraceDetail> {
    return this.http.get<TraceDetail>(
      `${API_BASE_URL}/monitoring/traces/${encodeURIComponent(traceId)}`,
      { params: paramsOf({ framework }) },
    );
  }
}
