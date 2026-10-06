import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../../../core/config/api.config';
import {
  DeveloperSettings,
  DeveloperSettingsSaveResult,
  DeveloperSettingsView,
  EndpointProbeResult,
} from '../models/developer-settings.model';

@Injectable({ providedIn: 'root' })
export class DeveloperSettingsApiService {
  private readonly http = inject(HttpClient);

  getSettings(): Observable<DeveloperSettingsView> {
    return this.http.get<DeveloperSettingsView>(
      `${API_BASE_URL}/developer-settings`,
    );
  }

  saveSettings(
    settings: DeveloperSettings,
  ): Observable<DeveloperSettingsSaveResult> {
    return this.http.put<DeveloperSettingsSaveResult>(
      `${API_BASE_URL}/developer-settings`,
      settings,
    );
  }

  testEndpoint(endpoint: string): Observable<EndpointProbeResult> {
    return this.http.post<EndpointProbeResult>(
      `${API_BASE_URL}/developer-settings/test-endpoint`,
      { endpoint },
    );
  }
}
