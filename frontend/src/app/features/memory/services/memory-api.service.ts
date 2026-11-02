import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../../../core/config/api.config';
import {
  MemorySettingsFailure,
  MemorySettingsView,
} from '../models/memory-settings.model';

@Injectable({ providedIn: 'root' })
export class MemoryApiService {
  private readonly http = inject(HttpClient);

  getSettings(): Observable<MemorySettingsView> {
    return this.http.get<MemorySettingsView>(`${API_BASE_URL}/memory/settings`);
  }

  saveSettings(
    enabled: boolean,
  ): Observable<MemorySettingsView | MemorySettingsFailure> {
    return this.http.put<MemorySettingsView | MemorySettingsFailure>(
      `${API_BASE_URL}/memory/settings`,
      { enabled },
    );
  }
}
