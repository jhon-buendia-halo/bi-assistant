import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../../../core/config/api.config';
import {
  KnowledgeSnippet,
  KnowledgeSnippetInput,
  KnowledgeSnippetKind,
  KnowledgeSnippetSource,
} from '../models/knowledge.model';

export interface KnowledgeQuery {
  datasetId?: string;
  kind?: KnowledgeSnippetKind;
  source?: KnowledgeSnippetSource;
  enabled?: boolean;
}

export interface KnowledgeBootstrapResult {
  created: KnowledgeSnippet[];
}

@Injectable({ providedIn: 'root' })
export class KnowledgeApiService {
  private readonly http = inject(HttpClient);

  list(query: KnowledgeQuery = {}): Observable<KnowledgeSnippet[]> {
    let params = new HttpParams();
    if (query.datasetId) params = params.set('datasetId', query.datasetId);
    if (query.kind) params = params.set('kind', query.kind);
    if (query.source) params = params.set('source', query.source);
    if (query.enabled !== undefined) {
      params = params.set('enabled', String(query.enabled));
    }
    return this.http.get<KnowledgeSnippet[]>(`${API_BASE_URL}/knowledge`, {
      params,
    });
  }

  create(input: KnowledgeSnippetInput): Observable<KnowledgeSnippet> {
    return this.http.post<KnowledgeSnippet>(`${API_BASE_URL}/knowledge`, input);
  }

  update(
    id: string,
    input: Partial<KnowledgeSnippetInput>,
  ): Observable<KnowledgeSnippet> {
    return this.http.patch<KnowledgeSnippet>(
      `${API_BASE_URL}/knowledge/${encodeURIComponent(id)}`,
      input,
    );
  }

  delete(id: string): Observable<unknown> {
    return this.http.delete(
      `${API_BASE_URL}/knowledge/${encodeURIComponent(id)}`,
    );
  }

  bootstrap(datasetId: string): Observable<KnowledgeBootstrapResult> {
    return this.http.post<KnowledgeBootstrapResult>(
      `${API_BASE_URL}/knowledge/bootstrap`,
      { datasetId },
    );
  }
}
