import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../../../core/config/api.config';
import {
  ReadinessReport,
  ReadinessReportSummary,
} from '../../sessions/models/readiness.model';

/** Saved data readiness assessments (api.md 109 and 110). */
@Injectable({ providedIn: 'root' })
export class ReadinessApiService {
  private readonly http = inject(HttpClient);

  /** A datasource's saved reports, newest first. */
  list(
    datasourceId: string,
  ): Observable<{ reports: ReadinessReportSummary[] }> {
    return this.http.get<{ reports: ReadinessReportSummary[] }>(
      `${API_BASE_URL}/data-readiness/assessments`,
      { params: { datasourceId } },
    );
  }

  /** One saved report in full. */
  get(id: string): Observable<ReadinessReport> {
    return this.http.get<ReadinessReport>(
      `${API_BASE_URL}/data-readiness/assessments/${encodeURIComponent(id)}`,
    );
  }
}
