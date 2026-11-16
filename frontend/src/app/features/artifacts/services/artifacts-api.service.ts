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

  get(id: string): Observable<Artifact> {
    return this.http.get<Artifact>(
      `${API_BASE_URL}/artifacts/${encodeURIComponent(id)}`,
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
