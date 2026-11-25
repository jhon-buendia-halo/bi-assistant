import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../../../core/config/api.config';
import { ConversationSummary } from '../models/conversation.model';

/** The conversations of a conversational binding (api.md 168). */
@Injectable({ providedIn: 'root' })
export class ConversationsApiService {
  private readonly http = inject(HttpClient);

  list(options: {
    workflowId: string;
    archived?: boolean;
    q?: string;
  }): Observable<{ conversations: ConversationSummary[] }> {
    let params = new HttpParams().set('workflowId', options.workflowId);
    if (options.archived === true) params = params.set('archived', 'true');
    const q = options.q?.trim();
    if (q) params = params.set('q', q);
    return this.http.get<{ conversations: ConversationSummary[] }>(
      `${API_BASE_URL}/conversations`,
      { params },
    );
  }
}
