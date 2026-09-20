import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../../../core/config/api.config';
import {
  Metric,
  MetricActionResult,
  MetricCandidate,
  MetricInput,
} from '../models/metric.model';

@Injectable({ providedIn: 'root' })
export class MetricsApiService {
  private readonly http = inject(HttpClient);

  /** All metrics, or only those defined over `entities` when given. */
  list(entities?: string[]): Observable<{ metrics: Metric[] }> {
    return this.http.get<{ metrics: Metric[] }>(`${API_BASE_URL}/metrics`, {
      params: entityParams(entities),
    });
  }

  /** Verified queries prefilled as metric drafts, scoped like `list`. */
  candidates(
    entities?: string[],
  ): Observable<{ candidates: MetricCandidate[] }> {
    return this.http.get<{ candidates: MetricCandidate[] }>(
      `${API_BASE_URL}/metrics/candidates`,
      { params: entityParams(entities) },
    );
  }

  create(input: MetricInput): Observable<MetricActionResult> {
    return this.http.post<MetricActionResult>(`${API_BASE_URL}/metrics`, input);
  }

  update(id: string, input: MetricInput): Observable<MetricActionResult> {
    return this.http.put<MetricActionResult>(
      `${API_BASE_URL}/metrics/${encodeURIComponent(id)}`,
      input,
    );
  }

  delete(id: string): Observable<MetricActionResult> {
    return this.http.delete<MetricActionResult>(
      `${API_BASE_URL}/metrics/${encodeURIComponent(id)}`,
    );
  }
}

/** `?entities=a.b.c,d.e.f`, omitted when nothing is in scope. */
function entityParams(entities?: string[]): HttpParams {
  const scope = (entities ?? []).filter(Boolean);
  return scope.length
    ? new HttpParams().set('entities', scope.join(','))
    : new HttpParams();
}
