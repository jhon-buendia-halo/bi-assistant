import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../../../core/config/api.config';
import { DatasourceKind } from '../../datasources/models/datasource.model';

/** Data layer a schema plays in a dataset (BA-318). */
export type SchemaLayer = 'landing' | 'normalized' | 'consumption';

export const SCHEMA_LAYERS: { value: SchemaLayer; label: string }[] = [
  { value: 'landing', label: 'Landing' },
  { value: 'normalized', label: 'Normalized' },
  { value: 'consumption', label: 'Consumption' },
];

/** Same cap the backend applies. */
export const SCHEMA_DESCRIPTION_MAX = 500;

export function schemaLayerLabel(layer: SchemaLayer | undefined): string {
  return SCHEMA_LAYERS.find((l) => l.value === layer)?.label ?? '';
}

/** The user's note on one schema of a dataset; `key` is `catalog.schema`. */
export interface DatasetSchemaNote {
  key: string;
  layer?: SchemaLayer;
  description?: string;
}

export interface DatasetEntitySnapshot {
  key: string;
  columns: { name: string; type: string; nullable: boolean }[];
}

export interface Dataset {
  name: string;
  datasourceId?: string;
  datasourceKind?: DatasourceKind;
  tables: string[];
  entities?: DatasetEntitySnapshot[];
  schemas?: DatasetSchemaNote[];
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
    datasource: { id: string; kind: DatasourceKind },
    schemas?: DatasetSchemaNote[],
  ): Observable<DatasetActionResult> {
    return this.http.post<DatasetActionResult>(`${API_BASE_URL}/datasets`, {
      name,
      tables,
      entities,
      datasourceId: datasource.id,
      datasourceKind: datasource.kind,
      ...(schemas !== undefined ? { schemas } : {}),
    });
  }

  deleteDataset(name: string): Observable<DatasetActionResult> {
    return this.http.delete<DatasetActionResult>(
      `${API_BASE_URL}/datasets/${encodeURIComponent(name)}`,
    );
  }
}
