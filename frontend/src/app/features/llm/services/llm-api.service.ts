import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../../../core/config/api.config';
import {
  LlmActionResult,
  LlmSettings,
  LlmSettingsView,
  ReasoningEffort,
} from '../models/llm.model';

@Injectable({ providedIn: 'root' })
export class LlmApiService {
  private readonly http = inject(HttpClient);

  getSettings(): Observable<LlmSettingsView> {
    return this.http.get<LlmSettingsView>(`${API_BASE_URL}/llm/settings`);
  }

  saveSettings(settings: LlmSettings): Observable<LlmActionResult> {
    return this.http.put<LlmActionResult>(
      `${API_BASE_URL}/llm/settings`,
      settings,
    );
  }

  saveReasoning(effort: ReasoningEffort): Observable<LlmActionResult> {
    return this.http.put<LlmActionResult>(`${API_BASE_URL}/llm/reasoning`, {
      effort,
    });
  }

  testConnection(settings: LlmSettings): Observable<LlmActionResult> {
    return this.http.post<LlmActionResult>(
      `${API_BASE_URL}/llm/test-connection`,
      settings,
    );
  }
}
