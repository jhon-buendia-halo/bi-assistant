import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../../../core/config/api.config';
import {
  Datasource,
  DatasourceActionResult,
  DatasourceConfig,
  DatasourceKind,
  InventoryResult,
} from '../models/datasource.model';

@Injectable({ providedIn: 'root' })
export class DatasourcesApiService {
  private readonly http = inject(HttpClient);

  list(): Observable<{ datasources: Datasource[] }> {
    return this.http.get<{ datasources: Datasource[] }>(
      `${API_BASE_URL}/datasources`,
    );
  }

  testConnection(
    kind: DatasourceKind,
    config: DatasourceConfig,
    id?: string,
  ): Observable<DatasourceActionResult> {
    return this.http.post<DatasourceActionResult>(
      `${API_BASE_URL}/datasources/test-connection`,
      { kind, config, id },
    );
  }

  save(input: {
    id?: string;
    name: string;
    kind: DatasourceKind;
    config: DatasourceConfig;
  }): Observable<DatasourceActionResult> {
    return this.http.post<DatasourceActionResult>(
      `${API_BASE_URL}/datasources`,
      input,
    );
  }

  delete(id: string): Observable<DatasourceActionResult> {
    return this.http.delete<DatasourceActionResult>(
      `${API_BASE_URL}/datasources/${encodeURIComponent(id)}`,
    );
  }

  /** Served from the backend snapshot unless `refresh` forces a live walk. */
  getInventory(
    id: string,
    opts?: { refresh?: boolean },
  ): Observable<InventoryResult> {
    const query = opts?.refresh ? '?refresh=true' : '';
    return this.http.get<InventoryResult>(
      `${API_BASE_URL}/datasources/${encodeURIComponent(id)}/inventory${query}`,
    );
  }
}
