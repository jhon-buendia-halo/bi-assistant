import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../../../core/config/api.config';

/** `official` = the assistant, `system` = the five helpers, `user` = built in the hub. */
export type AgentKind = 'official' | 'system' | 'user';
export type AgentStatus = 'builtin' | 'draft' | 'live';
export type AgentOwner = 'Official' | 'System' | 'You';

/** A user agent's stored configuration (draft or Live version). */
export interface AgentConfig {
  name: string;
  description: string;
  instructions: string;
  datasets: string[];
  starterQuestions: string[];
  model?: string;
  reasoningEffort?: 'low' | 'medium' | 'high';
}

export interface Agent {
  /** Registry key of a built-in agent, or a user agent's id. */
  key: string;
  id: string;
  name: string;
  description: string;
  tools: string[];
  kind?: AgentKind;
  status?: AgentStatus;
  pinned?: boolean;
  owner?: AgentOwner;
  hasUnpublishedChanges?: boolean;
  /** Dataset names in the effective configuration that no longer exist. */
  missingDatasets?: string[];
  datasets?: string[];
  starterQuestions?: string[];
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
  /** User agents only: the working copy and the published copy. */
  draft?: AgentConfig;
  live?: AgentConfig;
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

/** Which half of a set a question belongs to (data-model 4.8). */
export type AgentEvalSplit = 'dev' | 'held-out';

export interface AgentEvalCase {
  id: string;
  question: string;
  /** What the question probes for. */
  intent: string;
  checks: AgentEvalCheck[];
  /** The one primary kind of question it is, e.g. `lookup`. */
  category?: string;
  split?: AgentEvalSplit;
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

/**
 * How a check or a question came out. `not-scored` is a judge check on a run
 * with the judge off, or a question whose only unsettled checks are those.
 */
export type EvalStatus = 'passed' | 'failed' | 'not-scored';

export interface EvalCheckResult {
  id: string;
  description: string;
  score: number;
  /** True only when `status` is `passed`. */
  passed: boolean;
  /** Absent on runs stored before statuses existed: read `passed`. */
  status?: EvalStatus;
  /** The BA-9 criterion the check measures (D1…, G1…, I1…, C1…). */
  criterion?: string;
  /** Why the check failed or was not scored, when known. */
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
  /** True only when `status` is `passed`. */
  passed: boolean;
  /** Absent on runs stored before statuses existed: read `passed`. */
  status?: EvalStatus;
  category?: string;
  error?: string;
  durationMs: number;
}

/** What the run button sends; the API also takes `categories`. */
export type EvalJudgeChoice = 'off' | 'on';
export type EvalJudgeMode = EvalJudgeChoice | 'categories';

export interface EvalCategoryTally {
  category: string;
  passed: number;
  failed: number;
  notScored: number;
  total: number;
}

export interface EvalCriterionTally {
  criterion: string;
  passed: number;
  failed: number;
  total: number;
}

/** A finished run's counts, by question and by criterion. */
export interface EvalRunSummary {
  passed: number;
  failed: number;
  notScored: number;
  byCategory: EvalCategoryTally[];
  byCriterion: EvalCriterionTally[];
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
  /** Absent on runs stored before the judge could be switched off. */
  judge?: { mode: EvalJudgeMode; categories?: string[] };
  /** Absent on older runs; derive it with `evalRunSummary`. */
  summary?: EvalRunSummary;
}

/** Body of `POST /agents` and `PUT /agents/:id/draft` (api.md 41, 42). */
export type SaveAgentInput = Partial<AgentConfig> & { name: string };

/** Style A answer of the agent definition endpoints (api.md 41-45). */
export interface AgentMutationResult {
  ok: boolean;
  message: string;
  agent?: Agent;
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

  /** Create a user agent as a draft. */
  createAgent(input: SaveAgentInput): Observable<AgentMutationResult> {
    return this.http.post<AgentMutationResult>(`${API_BASE_URL}/agents`, input);
  }

  /** Replace a user agent's draft; its Live version is untouched. */
  saveDraft(
    id: string,
    input: SaveAgentInput,
  ): Observable<AgentMutationResult> {
    return this.http.put<AgentMutationResult>(
      `${API_BASE_URL}/agents/${encodeURIComponent(id)}/draft`,
      input,
    );
  }

  /** Copy a user agent's draft to its Live version. */
  publish(id: string): Observable<AgentMutationResult> {
    return this.http.post<AgentMutationResult>(
      `${API_BASE_URL}/agents/${encodeURIComponent(id)}/publish`,
      {},
    );
  }

  /** Delete a user agent; sessions that used it keep their transcripts. */
  deleteAgent(id: string): Observable<AgentMutationResult> {
    return this.http.delete<AgentMutationResult>(
      `${API_BASE_URL}/agents/${encodeURIComponent(id)}`,
    );
  }

  /** Pin or unpin any agent, built-in or user-built. */
  setPinned(key: string, pinned: boolean): Observable<AgentMutationResult> {
    return this.http.put<AgentMutationResult>(
      `${API_BASE_URL}/agents/${encodeURIComponent(key)}/pin`,
      { pinned },
    );
  }

  getAgentEvals(key: string): Observable<{ sets: AgentEvalSet[] }> {
    return this.http.get<{ sets: AgentEvalSet[] }>(
      `${API_BASE_URL}/agents/${encodeURIComponent(key)}/evals`,
    );
  }

  /** Start a run of the given questions; the judge is off unless asked. */
  startEvalRun(
    key: string,
    datasourceId: string,
    caseIds: string[],
    judge: EvalJudgeChoice = 'off',
  ): Observable<EvalRunStartResult> {
    return this.http.post<EvalRunStartResult>(
      `${API_BASE_URL}/agents/${encodeURIComponent(key)}/evals/run`,
      { datasourceId, caseIds, judge },
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
