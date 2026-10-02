import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../../../core/config/api.config';

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

export interface AgentEvalCheck {
  id: string;
  name: string;
  description: string;
}

export interface AgentEvalCase {
  id: string;
  question: string;
  /** What the question probes for. */
  intent: string;
  checks: AgentEvalCheck[];
}

/** A named group of eval questions sharing one fixture. */
export interface AgentEvalSet {
  id: string;
  name: string;
  /** What the set covers and what it needs to run. */
  description: string;
  cases: AgentEvalCase[];
}

export interface EvalToolCall {
  name: string;
  input?: string;
  output?: string;
  error?: string;
}

export interface EvalCheckResult {
  id: string;
  description: string;
  score: number;
  passed: boolean;
  /** Why the check failed, when the scorer reports it. */
  reason?: string;
}

export interface AgentEvalCaseResult {
  id: string;
  question: string;
  /** Score per scorer id, 0..1. */
  scores: Record<string, number>;
  checkResults: EvalCheckResult[];
  /** The agent's final answer. */
  answer: string;
  /** The tool calls the agent made, in order. */
  toolCalls: EvalToolCall[];
  passed: boolean;
  error?: string;
  durationMs: number;
}

export interface EvalRunView {
  jobId: string;
  agentKey: string;
  datasourceId: string;
  datasets: string[];
  caseIds: string[];
  status: 'running' | 'completed' | 'failed';
  results: AgentEvalCaseResult[];
  totalCases: number;
  currentQuestion?: string;
  error?: string;
  startedAt: string;
  finishedAt?: string;
  /**
   * Which path this run exercised (ADR-0007, roadmap 1.2.2): `model` (the
   * current logical-query-layer assistant) or `legacy` (the pre-change
   * SQL-writing assistant, for comparison). Absent on a run persisted before
   * this field existed — treat as `model`.
   */
  path?: 'model' | 'legacy';
  /** How many finished cases called `run_raw_sql` (the flagged last resort —
   * the question could not be expressed as a logical query). */
  outsideModelCount?: number;
}

export interface EvalRunStartResult {
  ok: boolean;
  message: string;
  jobId?: string;
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

  getAgentEvals(key: string): Observable<{ sets: AgentEvalSet[] }> {
    return this.http.get<{ sets: AgentEvalSet[] }>(
      `${API_BASE_URL}/agents/${encodeURIComponent(key)}/evals`,
    );
  }

  startEvalRun(
    key: string,
    datasourceId: string,
    caseIds: string[],
    path?: 'model' | 'legacy',
  ): Observable<EvalRunStartResult> {
    return this.http.post<EvalRunStartResult>(
      `${API_BASE_URL}/agents/${encodeURIComponent(key)}/evals/run`,
      { datasourceId, caseIds, ...(path ? { path } : {}) },
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
