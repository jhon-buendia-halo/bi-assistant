import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../../../core/config/api.config';

/** The conversation export's download (api.md 167). */
@Injectable({ providedIn: 'root' })
export class ConversationExportApiService {
  private readonly http = inject(HttpClient);

  /** One file of an export, as a blob. */
  download(id: string, format: 'pdf' | 'pptx'): Observable<Blob> {
    return this.http.get(
      `${API_BASE_URL}/conversation-exports/${encodeURIComponent(id)}/download`,
      { responseType: 'blob', params: { format } },
    );
  }
}
