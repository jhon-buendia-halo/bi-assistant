import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../../../core/config/api.config';
import {
  OntologyItem,
  OntologyItemInput,
  OntologyItemPatch,
  OntologyKind,
  OntologySource,
} from '../models/ontology.model';

export interface OntologyQuery {
  kind?: OntologyKind;
  source?: OntologySource;
  enabled?: boolean;
}

function datasetBase(dataset: string): string {
  return `${API_BASE_URL}/datasets/${encodeURIComponent(dataset)}/ontology`;
}

@Injectable({ providedIn: 'root' })
export class OntologyApiService {
  private readonly http = inject(HttpClient);

  /** The dataset's own items plus the shared ones, newest first. */
  list(dataset: string, query: OntologyQuery = {}): Observable<OntologyItem[]> {
    let params = new HttpParams();
    if (query.kind) params = params.set('kind', query.kind);
    if (query.source) params = params.set('source', query.source);
    if (query.enabled !== undefined) {
      params = params.set('enabled', String(query.enabled));
    }
    return this.http.get<OntologyItem[]>(datasetBase(dataset), { params });
  }

  create(dataset: string, input: OntologyItemInput): Observable<OntologyItem> {
    return this.http.post<OntologyItem>(datasetBase(dataset), input);
  }

  update(id: string, patch: OntologyItemPatch): Observable<OntologyItem> {
    return this.http.patch<OntologyItem>(
      `${API_BASE_URL}/ontology/${encodeURIComponent(id)}`,
      patch,
    );
  }

  remove(id: string): Observable<unknown> {
    return this.http.delete(
      `${API_BASE_URL}/ontology/${encodeURIComponent(id)}`,
    );
  }
}
