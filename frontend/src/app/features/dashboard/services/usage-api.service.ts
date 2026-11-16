import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../../../core/config/api.config';
import { UsageSummary } from '../models/usage.model';

/** The Dashboard's API: `GET /monitoring/usage`. */
@Injectable({ providedIn: 'root' })
export class UsageApiService {
  private readonly http = inject(HttpClient);

  summary(query: {
    from: Date | null;
    timeZone: string;
  }): Observable<UsageSummary> {
    let params = new HttpParams().set('tz', query.timeZone);
    if (query.from) params = params.set('from', query.from.toISOString());
    return this.http.get<UsageSummary>(`${API_BASE_URL}/monitoring/usage`, {
      params,
    });
  }
}
