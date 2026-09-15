import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../../../core/config/api.config';

export interface SandboxEntitySnapshot {
  key: string;
  columns: { name: string; type: string; nullable: boolean }[];
}

export interface Sandbox {
  name: string;
  datasourceId?: string;
  datasourceKind?: 'databricks' | 'postgres';
  tables: string[];
  entities?: SandboxEntitySnapshot[];
  createdAt?: string;
  updatedAt?: string;
}

export interface SandboxActionResult {
  ok: boolean;
  message: string;
}

@Injectable({ providedIn: 'root' })
export class SandboxApiService {
  private readonly http = inject(HttpClient);

  getSandboxes(): Observable<{ sandboxes: Sandbox[] }> {
    return this.http.get<{ sandboxes: Sandbox[] }>(`${API_BASE_URL}/sandbox`);
  }

  createSandbox(
    name: string,
    tables: string[],
    entities: SandboxEntitySnapshot[],
    datasource: { id: string; kind: 'databricks' | 'postgres' },
  ): Observable<SandboxActionResult> {
    return this.http.post<SandboxActionResult>(`${API_BASE_URL}/sandbox`, {
      name,
      tables,
      entities,
      datasourceId: datasource.id,
      datasourceKind: datasource.kind,
    });
  }

  deleteSandbox(name: string): Observable<SandboxActionResult> {
    return this.http.delete<SandboxActionResult>(
      `${API_BASE_URL}/sandbox/${encodeURIComponent(name)}`,
    );
  }
}
