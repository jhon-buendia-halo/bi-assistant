import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../../../core/config/api.config';

export interface DatasetEntitySnapshot {
  key: string;
  columns: { name: string; type: string; nullable: boolean }[];
}

export interface Dataset {
  name: string;
  datasourceId?: string;
  datasourceKind?: 'databricks' | 'postgres';
  tables: string[];
  entities?: DatasetEntitySnapshot[];
  createdAt?: string;
  updatedAt?: string;
}

export interface DatasetActionResult {
  ok: boolean;
  message: string;
}

@Injectable({ providedIn: 'root' })
export class DatasetsApiService {
  private readonly http = inject(HttpClient);

  getDatasets(): Observable<{ datasets: Dataset[] }> {
    return this.http.get<{ datasets: Dataset[] }>(`${API_BASE_URL}/datasets`);
  }

  createDataset(
    name: string,
    tables: string[],
    entities: DatasetEntitySnapshot[],
    datasource: { id: string; kind: 'databricks' | 'postgres' },
  ): Observable<DatasetActionResult> {
    return this.http.post<DatasetActionResult>(`${API_BASE_URL}/datasets`, {
      name,
      tables,
      entities,
      datasourceId: datasource.id,
      datasourceKind: datasource.kind,
    });
  }

  deleteDataset(name: string): Observable<DatasetActionResult> {
    return this.http.delete<DatasetActionResult>(
      `${API_BASE_URL}/datasets/${encodeURIComponent(name)}`,
    );
  }
}
