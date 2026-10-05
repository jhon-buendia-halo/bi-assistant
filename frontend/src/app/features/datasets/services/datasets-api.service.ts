import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../../../core/config/api.config';
import { DatasourceKind } from '../../datasources/models/datasource.model';

/**
 * Save-time statistics for one column, computed over the whole table where
 * the datasource allows (`COUNT(*)` → `sampledRows` is exact). Mirrors
 * `ColumnProfile` in `backend/src/modules/datasets/repositories/datasets.repository.ts`.
 */
export interface ColumnProfile {
  /** Rows the statistics were computed over. */
  sampledRows: number;
  /** Share of NULLs, 0..1. */
  nullRate: number;
  distinctCount: number;
  /** One distinct non-null value (or none) — a column that cannot vary. */
  constant: boolean;
  min?: string;
  max?: string;
  /** Most frequent values with counts; only when `distinctCount ≤ 25`. */
  topValues?: { value: string; count: number }[];
  /** Heuristic reading of the numbers' scale, when one is evident. */
  magnitude?: 'cents-like' | 'fraction' | 'count' | 'large-integer';
  /** ISO timestamp of the profiling run. */
  profiledAt: string;
}

/** How rows on each side of a reference relate, when profiles can tell. */
export type ReferenceCardinality =
  | 'one-to-many'
  | 'many-to-one'
  | 'one-to-one'
  | 'unknown';

export interface DatasetColumnSnapshot {
  name: string;
  type: string;
  nullable: boolean;
  /** Distinct values observed in a save-time sample. */
  sampleValues?: string[];
  /** Catalog comment for the column, when the datasource exposes one. */
  description?: string;
  /** Where this column joins, when it is a key into another dataset entity. */
  references?: {
    entity: string;
    column: string;
    source: 'declared' | 'inferred';
    /** From this column's side; absent on datasets saved before profiling. */
    cardinality?: ReferenceCardinality;
  };
  /** Column statistics; absent on datasets saved before profiling. */
  profile?: ColumnProfile;
}

export interface DatasetEntitySnapshot {
  key: string;
  columns: DatasetColumnSnapshot[];
}

export interface Dataset {
  name: string;
  datasourceId?: string;
  datasourceKind?: DatasourceKind;
  tables: string[];
  entities?: DatasetEntitySnapshot[];
  /** Operator-written: what questions this dataset answers. Shown to the assistant. */
  description?: string;
  /** When the column profiles in `entities` were last computed. */
  profiledAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface DatasetActionResult {
  ok: boolean;
  message: string;
  dataset?: Dataset;
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

  /** Recompute column profiles (null rate, distinct count, top values, …). */
  reprofile(name: string): Observable<DatasetActionResult> {
    return this.http.post<DatasetActionResult>(
      `${API_BASE_URL}/datasets/${encodeURIComponent(name)}/profile`,
      {},
    );
  }

  /** Empty string clears the description. */
  updateDescription(
    name: string,
    description: string,
  ): Observable<DatasetActionResult> {
    return this.http.patch<DatasetActionResult>(
      `${API_BASE_URL}/datasets/${encodeURIComponent(name)}`,
      { description },
    );
  }
}
