import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../../../core/config/api.config';
import { ProfileRequest, SampledProfile } from '../models/synthetic-data.model';

@Injectable({ providedIn: 'root' })
export class SyntheticDataApiService {
  private readonly http = inject(HttpClient);

  /** POST /synthetic-data/profiles (#111). Unsubscribing aborts the request. */
  profile(request: ProfileRequest): Observable<SampledProfile> {
    return this.http.post<SampledProfile>(
      `${API_BASE_URL}/synthetic-data/profiles`,
      request,
    );
  }
}
