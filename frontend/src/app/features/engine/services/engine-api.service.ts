import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../../../core/config/api.config';
import {
  EngineSettingsSaveRequest,
  EngineSettingsView,
} from '../models/engine.model';

export interface EngineSettingsSaveResult {
  ok: boolean;
  message: string;
  /** Echoed back on success, so the form can re-sync without a second fetch. */
  settings?: EngineSettingsView;
}

@Injectable({ providedIn: 'root' })
export class EngineApiService {
  private readonly http = inject(HttpClient);

  getSettings(): Observable<EngineSettingsView> {
    return this.http.get<EngineSettingsView>(`${API_BASE_URL}/engine/settings`);
  }

  saveSettings(
    body: EngineSettingsSaveRequest,
  ): Observable<EngineSettingsSaveResult> {
    return this.http.put<EngineSettingsSaveResult>(
      `${API_BASE_URL}/engine/settings`,
      body,
    );
  }
}
