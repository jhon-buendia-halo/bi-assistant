import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../../../core/config/api.config';
import {
  WorkflowDetail,
  WorkflowRunResult,
  WorkflowSummary,
} from '../models/workflow.model';

export type {
  WorkflowDetail,
  WorkflowRunResult,
  WorkflowSummary,
} from '../models/workflow.model';

/** The workflow catalogue (api.md 2.6.2: 116, 117) and runs (118). */
@Injectable({ providedIn: 'root' })
export class WorkflowsApiService {
  private readonly http = inject(HttpClient);

  getWorkflows(): Observable<{ workflows: WorkflowSummary[] }> {
    return this.http.get<{ workflows: WorkflowSummary[] }>(
      `${API_BASE_URL}/workflows`,
    );
  }

  /** Ids contain `:` (`agent:rfp`), so they are always URL-encoded. */
  getWorkflow(id: string): Observable<WorkflowDetail> {
    return this.http.get<WorkflowDetail>(
      `${API_BASE_URL}/workflows/${encodeURIComponent(id)}`,
    );
  }

  /** Run a run workflow once on its input; nothing is stored (api.md 118). */
  runWorkflow(
    id: string,
    input: Record<string, string>,
  ): Observable<WorkflowRunResult> {
    return this.http.post<WorkflowRunResult>(
      `${API_BASE_URL}/workflows/${encodeURIComponent(id)}/runs`,
      { input },
    );
  }
}
