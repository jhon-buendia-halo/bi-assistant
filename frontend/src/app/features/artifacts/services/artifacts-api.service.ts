import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../../../core/config/api.config';
import { Artifact, ArtifactSummary } from '../models/artifact.model';

export type {
  Artifact,
  ArtifactKind,
  ArtifactSummary,
} from '../models/artifact.model';

/** The artifacts store: reusable context saved from workflow runs. */
@Injectable({ providedIn: 'root' })
export class ArtifactsApiService {
  private readonly http = inject(HttpClient);

  /** Newest first. */
  list(): Observable<ArtifactSummary[]> {
    return this.http.get<ArtifactSummary[]>(`${API_BASE_URL}/artifacts`);
  }

  /** The artifact at `version` (the current one when absent). */
  get(id: string, version?: number): Observable<Artifact> {
    return this.http.get<Artifact>(
      `${API_BASE_URL}/artifacts/${encodeURIComponent(id)}`,
      version === undefined ? {} : { params: { version } },
    );
  }

  /** The version's zip (index.html, data.js, app.js, query.sql). */
  download(id: string, version?: number): Observable<Blob> {
    return this.http.get(
      `${API_BASE_URL}/artifacts/${encodeURIComponent(id)}/download`,
      {
        responseType: 'blob',
        ...(version === undefined ? {} : { params: { version } }),
      },
    );
  }

  /**
   * Save a dashboard version to Artifacts (api.md 164): `version` defaults to
   * the latest. Answers the artifact at that version.
   */
  save(id: string, version?: number): Observable<Artifact> {
    return this.http.post<Artifact>(
      `${API_BASE_URL}/artifacts/${encodeURIComponent(id)}/save`,
      version === undefined ? {} : { version },
    );
  }

  rename(id: string, name: string): Observable<ArtifactSummary> {
    return this.http.patch<ArtifactSummary>(
      `${API_BASE_URL}/artifacts/${encodeURIComponent(id)}`,
      { name },
    );
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(
      `${API_BASE_URL}/artifacts/${encodeURIComponent(id)}`,
    );
  }

  /** The URL of the artifact's original image (only when `hasImage`). */
  imageUrl(id: string): string {
    return `${API_BASE_URL}/artifacts/${encodeURIComponent(id)}/image`;
  }
}
