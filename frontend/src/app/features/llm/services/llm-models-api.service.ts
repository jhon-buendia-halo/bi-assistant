import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../../../core/config/api.config';
import { ListModelsRequest, ListModelsResult } from '../models/llm.model';

/** `POST /llm/models` (api.md 32b): a custom endpoint's or the Copilot seat's model ids, unsaved. */
@Injectable({ providedIn: 'root' })
export class LlmModelsApiService {
  private readonly http = inject(HttpClient);

  listModels(request: ListModelsRequest): Observable<ListModelsResult> {
    return this.http.post<ListModelsResult>(
      `${API_BASE_URL}/llm/models`,
      request,
    );
  }
}
