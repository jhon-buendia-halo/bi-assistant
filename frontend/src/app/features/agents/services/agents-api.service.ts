import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../../../core/config/api.config';
import type {
  AgentEvalCatalog,
  EvalRunStartResult,
  EvalRunView,
} from '../models/eval.model';

// The eval models moved to `../models/eval.model` (matching the other
// features' `models/` folders); they are re-exported here so existing import
// paths keep working.
export type {
  AgentEvalCase,
  AgentEvalCaseResult,
  AgentEvalCatalog,
  AgentEvalCheck,
  AgentEvalSet,
  CategoryRate,
  CategoryTally,
  EvalCaseDelta,
  EvalCheckResult,
  EvalCostState,
  EvalRegressionSummary,
  EvalRunStartResult,
  EvalRunView,
  EvalToolCall,
  TokenUsage,
} from '../models/eval.model';

export interface Agent {
  /** Registry key the agent is registered under in the harness. */
  key: string;
  id: string;
  name: string;
  description: string;
  tools: string[];
}

export interface AgentToolDetail {
  name: string;
  description: string;
  inputs: string[];
}

export interface AgentMemoryDetail {
  storage: string | null;
  lastMessages: number | false | null;
  semanticRecall: boolean;
  workingMemory: boolean;
  generateTitle: boolean;
}

export interface AgentDetail extends Agent {
  /** The agent's prompt template, flattened to text. */
  instructions: string;
  toolDetails: AgentToolDetail[];
  memory: AgentMemoryDetail | null;
  model: { id: string; provider: string } | null;
}

@Injectable({ providedIn: 'root' })
export class AgentsApiService {
  private readonly http = inject(HttpClient);

  getAgents(): Observable<{ agents: Agent[] }> {
    return this.http.get<{ agents: Agent[] }>(`${API_BASE_URL}/agents`);
  }

  getAgent(key: string): Observable<AgentDetail> {
    return this.http.get<AgentDetail>(
      `${API_BASE_URL}/agents/${encodeURIComponent(key)}`,
    );
  }

  /** The agent's eval catalog: every question set with its questions. */
  getAgentEvals(key: string): Observable<AgentEvalCatalog> {
    return this.http.get<AgentEvalCatalog>(
      `${API_BASE_URL}/agents/${encodeURIComponent(key)}/evals`,
    );
  }

  startEvalRun(
    key: string,
    datasourceId: string,
    caseIds: string[],
    suiteId?: string,
  ): Observable<EvalRunStartResult> {
    return this.http.post<EvalRunStartResult>(
      `${API_BASE_URL}/agents/${encodeURIComponent(key)}/evals/run`,
      suiteId ? { datasourceId, caseIds, suiteId } : { datasourceId, caseIds },
    );
  }

  listEvalRuns(key: string): Observable<{ runs: EvalRunView[] }> {
    return this.http.get<{ runs: EvalRunView[] }>(
      `${API_BASE_URL}/agents/${encodeURIComponent(key)}/evals/runs`,
    );
  }

  downloadEvalRun(key: string, jobId: string): Observable<Blob> {
    return this.http.get(
      `${API_BASE_URL}/agents/${encodeURIComponent(key)}/evals/runs/${encodeURIComponent(jobId)}/download`,
      { responseType: 'blob' },
    );
  }

  deleteEvalRun(
    key: string,
    jobId: string,
  ): Observable<{ ok: boolean; message: string }> {
    return this.http.delete<{ ok: boolean; message: string }>(
      `${API_BASE_URL}/agents/${encodeURIComponent(key)}/evals/runs/${encodeURIComponent(jobId)}`,
    );
  }

  getEvalRun(
    key: string,
    jobId: string,
  ): Observable<{ ok: boolean; message: string } & Partial<EvalRunView>> {
    return this.http.get<
      { ok: boolean; message: string } & Partial<EvalRunView>
    >(
      `${API_BASE_URL}/agents/${encodeURIComponent(key)}/evals/runs/${encodeURIComponent(jobId)}`,
    );
  }
}
