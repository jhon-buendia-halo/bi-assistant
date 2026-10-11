import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../../../core/config/api.config';
import {
  DataModel,
  DataModelVersion,
  DriftReport,
  Metric,
  ModelResponse,
  ModelSaveResult,
  MetricCandidate,
  ResolveResult,
} from '../models/data-model.model';

const modelPath = (name: string) =>
  `${API_BASE_URL}/datasets/${encodeURIComponent(name)}/model`;

/**
 * `World Cup Core` -> `world-cup-core`, mirroring the backend's own
 * `slugifyDatasetName` (`data-models.controller.ts`) exactly. The export
 * filename is built from this on the client (review finding 4) rather than
 * read off the response's `Content-Disposition` header: the Electron
 * renderer calls the backend cross-origin (`file://` -> `http://localhost:3000`),
 * and `app.enableCors()` exposes no custom headers by default, so that
 * header is invisible to renderer JS even though the request itself
 * succeeds.
 */
export function slugifyDatasetName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'dataset';
}

/**
 * Typed client for the Data model API (roadmap 1.2.1/BA-85's read/version
 * endpoints plus 1.2.3/BA-87's export, import, serialize and model-scoped
 * metrics). One service for the whole feature — every component under
 * `features/data-model/` injects this rather than talking to `HttpClient`
 * directly.
 */
@Injectable({ providedIn: 'root' })
export class DataModelApiService {
  private readonly http = inject(HttpClient);

  get(datasetName: string): Observable<ModelResponse> {
    return this.http.get<ModelResponse>(modelPath(datasetName));
  }

  getVersion(
    datasetName: string,
    version: number,
  ): Observable<DataModelVersion> {
    return this.http.get<DataModelVersion>(
      `${modelPath(datasetName)}/versions/${version}`,
    );
  }

  /** Every stored version (the Versions tab's list + diff source). */
  listVersions(
    datasetName: string,
  ): Observable<{ versions: DataModelVersion[] }> {
    return this.http.get<{ versions: DataModelVersion[] }>(
      `${modelPath(datasetName)}/versions`,
    );
  }

  putYaml(datasetName: string, yaml: string): Observable<ModelSaveResult> {
    return this.http.put<ModelSaveResult>(modelPath(datasetName), { yaml });
  }

  revert(
    datasetName: string,
    version: number,
  ): Observable<ModelSaveResult> {
    return this.http.post<ModelSaveResult>(
      `${modelPath(datasetName)}/revert`,
      { version },
    );
  }

  /** Rebuilds a fresh version from the dataset's physical snapshot, keeping
   * the current version's metrics (the "Bootstrap from snapshot" button). */
  bootstrap(datasetName: string): Observable<ModelSaveResult> {
    return this.http.post<ModelSaveResult>(
      `${modelPath(datasetName)}/bootstrap`,
      {},
    );
  }

  drift(datasetName: string): Observable<DriftReport> {
    return this.http.get<DriftReport>(`${modelPath(datasetName)}/drift`);
  }

  resolve(
    datasetName: string,
    refs: string[],
    version?: number,
  ): Observable<{ results: ResolveResult[] }> {
    return this.http.post<{ results: ResolveResult[] }>(
      `${modelPath(datasetName)}/resolve`,
      { refs, ...(version !== undefined ? { version } : {}) },
    );
  }

  /** Downloads a version's YAML as a Blob (current version by default) —
   * Electron's `file://` renderer triggers the save via a Blob URL, never
   * an absolute asset path. The filename is built by the caller
   * (`slugifyDatasetName` above), not read from this response — see that
   * function's doc for why. */
  exportYaml(datasetName: string, version?: number): Observable<Blob> {
    return this.http.get(`${modelPath(datasetName)}/export`, {
      params: version !== undefined ? { version } : {},
      responseType: 'blob',
    });
  }

  importYaml(datasetName: string, yaml: string): Observable<ModelSaveResult> {
    return this.http.post<ModelSaveResult>(
      `${modelPath(datasetName)}/import`,
      { yaml },
    );
  }

  /** The one YAML writer, exposed so structured edits never need their own
   * serializer — the client always builds a plain `DataModel` object and
   * asks the backend to render it the same way `saveYaml`/`exportYaml` do. */
  serialize(
    datasetName: string,
    model: Partial<DataModel>,
  ): Observable<{ yaml: string }> {
    return this.http.post<{ yaml: string }>(
      `${modelPath(datasetName)}/serialize`,
      { model },
    );
  }

  listModelMetrics(datasetName: string): Observable<{ metrics: Metric[] }> {
    return this.http.get<{ metrics: Metric[] }>(
      `${modelPath(datasetName)}/metrics`,
    );
  }

  createModelMetric(
    datasetName: string,
    metric: Metric,
  ): Observable<ModelSaveResult> {
    return this.http.post<ModelSaveResult>(
      `${modelPath(datasetName)}/metrics`,
      metric,
    );
  }

  updateModelMetric(
    datasetName: string,
    metricName: string,
    metric: Metric,
  ): Observable<ModelSaveResult> {
    return this.http.put<ModelSaveResult>(
      `${modelPath(datasetName)}/metrics/${encodeURIComponent(metricName)}`,
      metric,
    );
  }

  deleteModelMetric(
    datasetName: string,
    metricName: string,
  ): Observable<ModelSaveResult> {
    return this.http.delete<ModelSaveResult>(
      `${modelPath(datasetName)}/metrics/${encodeURIComponent(metricName)}`,
    );
  }

  modelMetricCandidates(
    datasetName: string,
  ): Observable<{ candidates: MetricCandidate[] }> {
    return this.http.get<{ candidates: MetricCandidate[] }>(
      `${modelPath(datasetName)}/metrics/candidates`,
    );
  }
}
