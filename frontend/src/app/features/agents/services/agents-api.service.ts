import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../../../core/config/api.config';

/** `official` = the assistant, `system` = the five helpers, `user` = built in the hub. */
export type AgentKind = 'official' | 'system' | 'user';
export type AgentStatus = 'builtin' | 'draft' | 'live';
export type AgentOwner = 'Official' | 'System' | 'You';

/** The tools an agent's author can switch on or off (agents-evals R55). */
export type AgentToolId = 'sample_rows' | 'ask_clarification' | 'visuals';

/** A user agent's stored configuration (draft or Live version). */
export interface AgentConfig {
  name: string;
  description: string;
  instructions: string;
  datasets: string[];
  starterQuestions: string[];
  /** Absent on a draft saved before tools could be chosen: all three. */
  tools?: AgentToolId[];
  /** Ids of the in-app skills the agent uses (R43); absent: none. */
  skills?: string[];
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

/** Where a library tool is linked from, for a user agent (api.md 34). */
export type ToolLinkStatus = 'always-on' | 'linked' | 'not-linked';

export interface AgentToolLink {
  name: string;
  status: ToolLinkStatus;
  linkedVia: { instructions: boolean; skills: string[] };
}

/** The LLM the agent runs on; the key is never sent, only whether it is set. */
export interface AgentLlm {
  provider: string | null;
  providerName: string | null;
  model: string | null;
  apiKeyConfigured: boolean;
  maxOutputTokens: number | null;
  reasoningEffort: string | null;
}

/** A built-in agent's editable system prompt (api.md 34, BA-224). */
export interface AgentPromptView {
  /** As served: the override, else the shipped text. */
  editable: string;
  shipped: string;
  modified: boolean;
  builtInChanged: boolean;
  /** True for the assistant: `[[tool:…]]` links are allowed. */
  linksAllowed: boolean;
  updatedAt: string | null;
}

export interface AgentDetail extends Agent {
  /** Built-in agents only: the editable system prompt and its override state. */
  prompt?: AgentPromptView;
  /** User agents only: each library tool with its link status. */
  toolLinks?: AgentToolLink[];
  /** The LLM configuration the agent uses (LLM Config tab). */
  llm?: AgentLlm;
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
}

export interface AgentSkillFileEntry {
  /** Relative to the skill's folder, '/'-separated. */
  path: string;
  size: number;
}

export interface AgentSkill {
  name: string;
  description: string;
  loading: 'on-demand' | 'harness';
  /** Every file in the folder, `SKILL.md` first, then sorted. */
  files: AgentSkillFileEntry[];
  /** `in-app` only for a user agent's own skills (api.md 34a). */
  level: 'built-in' | 'in-app';
  /** A built-in skill replaced by an app-wide override (R63). */
  modified?: boolean;
}

/** `GET /agents/:key/skills` (api.md 34a). */
export interface AgentSkillsView {
  skills: AgentSkill[];
}

/** `GET /agents/:key/skills/:name/file` (api.md 34b). */
export interface AgentSkillFile {
  path: string;
  size: number;
  /** Null when the file is larger than 256 KB or isn't text. */
  content: string | null;
}

/** Body of `POST /agents` and `PUT /agents/:id/draft` (api.md 41, 42). */
export type SaveAgentInput = Partial<AgentConfig> & { name: string };

/** Style A answer of the agent definition endpoints (api.md 41-45). */
export interface AgentMutationResult {
  ok: boolean;
  message: string;
  agent?: Agent;
}

/** Answer of `PUT`/`DELETE /agents/:key/prompt` (api.md 103, 104). */
export interface AgentPromptResult {
  ok: boolean;
  message: string;
  agent?: AgentDetail;
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

  /** Save a built-in agent's shared system prompt (`edit-policies`). */
  savePrompt(key: string, prompt: string): Observable<AgentPromptResult> {
    return this.http.put<AgentPromptResult>(
      `${API_BASE_URL}/agents/${encodeURIComponent(key)}/prompt`,
      { prompt },
    );
  }

  /** Restore a built-in agent's shipped system prompt. */
  resetPrompt(key: string): Observable<AgentPromptResult> {
    return this.http.delete<AgentPromptResult>(
      `${API_BASE_URL}/agents/${encodeURIComponent(key)}/prompt`,
    );
  }

  /** The skills the agent gets; a user agent answers with the assistant's. */
  skills(key: string): Observable<AgentSkillsView> {
    return this.http.get<AgentSkillsView>(
      `${API_BASE_URL}/agents/${encodeURIComponent(key)}/skills`,
    );
  }

  /** One file of a skill; `path` is relative to the skill's folder. */
  skillFile(
    key: string,
    name: string,
    path: string,
  ): Observable<AgentSkillFile> {
    return this.http.get<AgentSkillFile>(
      `${API_BASE_URL}/agents/${encodeURIComponent(key)}/skills/${encodeURIComponent(name)}/file?path=${encodeURIComponent(path)}`,
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
  ): Observable<EvalRunStartResult> {
    return this.http.post<EvalRunStartResult>(
      `${API_BASE_URL}/agents/${encodeURIComponent(key)}/evals/run`,
      { datasourceId, caseIds },
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
