import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../../../core/config/api.config';
import type {
  AgentEvalCatalog,
  EvalLoopRequest,
  EvalLoopView,
  EvalRunLogRecordV2,
  EvalRunRequest,
  EvalRunStartResult,
  EvalRunView,
  RunLogDiff,
  RunLogSummary,
  TrendPoint,
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
  AnswerReview,
  AnswerReviewCode,
  AnswerReviewFinding,
  CategoryRate,
  CategoryTally,
  EvalCaseDelta,
  EvalCheckLog,
  EvalCheckResult,
  EvalCostState,
  EvalHarness,
  EvalLoopRequest,
  EvalLoopSummaryRow,
  EvalLoopView,
  EvalRegressionSummary,
  EvalRepeat,
  EvalRunLogAttempt,
  EvalRunLogCaseV2,
  EvalRunLogRecordV2,
  EvalRunRequest,
  EvalRunStartResult,
  EvalRunSummary,
  EvalRunTally,
  EvalRunView,
  EvalSqlLog,
  EvalToolCall,
  EvalVerdict,
  FailureLabel,
  LoopStatus,
  RunLogCaseDelta,
  RunLogCheckDelta,
  RunLogDiff,
  RunLogDiffSide,
  RunLogSummary,
  SidePass,
  SqlRepairKind,
  SqlRepairRecord,
  TokenUsage,
  TrendPoint,
  TrendSeries,
  TrendSeriesPoint,
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

  /** Positional form kept for existing callers (`agent-detail.ts`). */
  startEvalRun(
    key: string,
    datasourceId: string,
    caseIds: string[],
    suiteId?: string,
    datasets?: string[],
  ): Observable<EvalRunStartResult>;
  /** Object form — repeat, label, arm and engine overrides (§2.6). */
  startEvalRun(
    key: string,
    request: EvalRunRequest,
  ): Observable<EvalRunStartResult>;
  startEvalRun(
    key: string,
    datasourceIdOrRequest: string | EvalRunRequest,
    caseIds?: string[],
    suiteId?: string,
    datasets?: string[],
  ): Observable<EvalRunStartResult> {
    const body: EvalRunRequest =
      typeof datasourceIdOrRequest === 'string'
        ? {
            datasourceId: datasourceIdOrRequest,
            caseIds,
            ...(suiteId ? { suiteId } : {}),
            ...(datasets?.length ? { datasets } : {}),
          }
        : datasourceIdOrRequest;
    return this.http.post<EvalRunStartResult>(
      `${API_BASE_URL}/agents/${encodeURIComponent(key)}/evals/run`,
      body,
    );
  }

  /** Queues one run per suite × arm; jobs drain sequentially on the backend. */
  startLoop(
    key: string,
    body: EvalLoopRequest,
  ): Observable<{
    ok: boolean;
    message: string;
    loopId?: string;
    jobIds?: string[];
  }> {
    return this.http.post<{
      ok: boolean;
      message: string;
      loopId?: string;
      jobIds?: string[];
    }>(`${API_BASE_URL}/agents/${encodeURIComponent(key)}/evals/loop`, body);
  }

  /** Poll target for a loop's jobs and its suite × arm summary matrix. */
  getLoop(
    key: string,
    loopId: string,
  ): Observable<{ ok: boolean; message?: string } & Partial<EvalLoopView>> {
    return this.http.get<
      { ok: boolean; message?: string } & Partial<EvalLoopView>
    >(
      `${API_BASE_URL}/agents/${encodeURIComponent(key)}/evals/loops/${encodeURIComponent(loopId)}`,
    );
  }

  /** Aborts an in-flight run; its log is still written with `status: 'aborted'`. */
  stopEvalRun(
    key: string,
    jobId: string,
  ): Observable<{ ok: boolean; message: string }> {
    return this.http.post<{ ok: boolean; message: string }>(
      `${API_BASE_URL}/agents/${encodeURIComponent(key)}/evals/runs/${encodeURIComponent(jobId)}/stop`,
      {},
    );
  }

  /** The run-log v2 history index, across every log directory the backend found. */
  listRunLogs(
    key: string,
    suite?: string,
    limit?: number,
  ): Observable<{ logs: RunLogSummary[]; dirs: string[] }> {
    let params = new HttpParams();
    if (suite) params = params.set('suite', suite);
    if (limit !== undefined) params = params.set('limit', String(limit));
    return this.http.get<{ logs: RunLogSummary[]; dirs: string[] }>(
      `${API_BASE_URL}/agents/${encodeURIComponent(key)}/evals/logs`,
      { params },
    );
  }

  /** One full run-log v2 record, by its file name (as `listRunLogs` reports it). */
  getRunLog(
    key: string,
    file: string,
  ): Observable<{
    ok: boolean;
    message?: string;
    record?: EvalRunLogRecordV2;
  }> {
    return this.http.get<{
      ok: boolean;
      message?: string;
      record?: EvalRunLogRecordV2;
    }>(
      `${API_BASE_URL}/agents/${encodeURIComponent(key)}/evals/logs/${encodeURIComponent(file)}`,
    );
  }

  /**
   * Diffs two run-log files. The backend must route `evals/logs/compare`
   * ahead of `evals/logs/:file`, or `compare` is swallowed as a file name —
   * flagged for whichever unit wires the controller (plan §2.6).
   */
  compareRunLogs(
    key: string,
    a: string,
    b: string,
  ): Observable<{
    ok: boolean;
    message?: string;
    diff?: RunLogDiff;
    markdown?: string;
  }> {
    return this.http.get<{
      ok: boolean;
      message?: string;
      diff?: RunLogDiff;
      markdown?: string;
    }>(`${API_BASE_URL}/agents/${encodeURIComponent(key)}/evals/logs/compare`, {
      params: new HttpParams().set('a', a).set('b', b),
    });
  }

  /** `passKRate`-over-time points, optionally narrowed to a suite and/or arm. */
  getTrend(
    key: string,
    suite?: string,
    arm?: string,
  ): Observable<{ points: TrendPoint[] }> {
    let params = new HttpParams();
    if (suite) params = params.set('suite', suite);
    if (arm) params = params.set('arm', arm);
    return this.http.get<{ points: TrendPoint[] }>(
      `${API_BASE_URL}/agents/${encodeURIComponent(key)}/evals/trend`,
      { params },
    );
  }

  /** Drafts (and optionally appends) a `docs/evals/change-log.md` entry from a diff. */
  draftChangeLog(
    key: string,
    body: {
      a: string;
      b: string;
      lever: string;
      change: string;
      why: string;
      append?: boolean;
    },
  ): Observable<{
    ok: boolean;
    message?: string;
    markdown?: string;
    appendedTo?: string;
  }> {
    return this.http.post<{
      ok: boolean;
      message?: string;
      markdown?: string;
      appendedTo?: string;
    }>(
      `${API_BASE_URL}/agents/${encodeURIComponent(key)}/evals/logs/changelog-draft`,
      body,
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
