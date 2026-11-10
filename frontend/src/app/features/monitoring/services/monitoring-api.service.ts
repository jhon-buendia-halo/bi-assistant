import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../../../core/config/api.config';
import {
  LlmCallDetail,
  LlmCallPage,
  LlmCallQuery,
} from '../models/llm-call.model';

/**
 * The Monitoring API (roadmap 1.21.14, 1.21.15). Failures surface as
 * HttpErrorResponse whose `error.message` carries the backend's reason.
 */
@Injectable({ providedIn: 'root' })
export class MonitoringApiService {
  private readonly http = inject(HttpClient);

  list(query: LlmCallQuery): Observable<LlmCallPage> {
    let params = new HttpParams();
    for (const [name, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') {
        params = params.set(name, String(value));
      }
    }
    return this.http.get<LlmCallPage>(`${API_BASE_URL}/monitoring/llm-calls`, {
      params,
    });
  }

  get(id: string): Observable<LlmCallDetail> {
    return this.http.get<LlmCallDetail>(
      `${API_BASE_URL}/monitoring/llm-calls/${encodeURIComponent(id)}`,
    );
  }
}
