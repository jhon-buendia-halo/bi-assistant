import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../../../core/config/api.config';
import { VisualChart, VisualChartInput } from '../models/visual-chart.model';

/**
 * CRUD for the Visuals library. Failures surface as HttpErrorResponse whose
 * `error.message` carries the backend's reason (400/404/409).
 */
@Injectable({ providedIn: 'root' })
export class VisualsApiService {
  private readonly http = inject(HttpClient);

  list(): Observable<VisualChart[]> {
    return this.http.get<VisualChart[]>(`${API_BASE_URL}/visuals`);
  }

  create(input: VisualChartInput): Observable<VisualChart> {
    return this.http.post<VisualChart>(`${API_BASE_URL}/visuals`, input);
  }

  update(
    id: string,
    patch: Partial<VisualChartInput>,
  ): Observable<VisualChart> {
    return this.http.patch<VisualChart>(
      `${API_BASE_URL}/visuals/${encodeURIComponent(id)}`,
      patch,
    );
  }

  remove(id: string): Observable<void> {
    return this.http.delete<void>(
      `${API_BASE_URL}/visuals/${encodeURIComponent(id)}`,
    );
  }
}
