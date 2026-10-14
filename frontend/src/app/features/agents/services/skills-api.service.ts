import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../../../core/config/api.config';

/** One row of the skills library (api.md 94). */
export interface SkillSummary {
  id: string;
  name: string;
  description: string;
  fileCount: number;
  /** Names of the caller's agents that use the skill, sorted. */
  agents: string[];
  /** The tools its body links, sorted and distinct. */
  tools: string[];
  updatedAt: string;
}

export interface SkillFile {
  path: string;
  content: string;
}

/** One skill in full (api.md 95). */
export interface Skill extends SkillSummary {
  body: string;
  files: SkillFile[];
}

/** Body of `POST /skills` and `PUT /skills/:id` (api.md 96, 97). */
export interface SaveSkillInput {
  name: string;
  description: string;
  body: string;
  files?: SkillFile[];
}

/** Style A answer of the skill write endpoints (api.md 96-98). */
export interface SkillMutationResult {
  ok: boolean;
  message: string;
  skill?: Skill;
}

/** One built-in skill row (api.md 99). */
export interface BuiltInSkillSummary {
  name: string;
  description: string;
  loading: 'on-demand' | 'harness';
  agents: string[];
  /** The tools the served body links; left out when none (api.md 99). */
  tools?: string[];
  modified: boolean;
  /** Modified, and the shipped version changed since the override (R79). */
  builtInChanged: boolean;
  updatedAt: string | null;
}

/** One built-in skill in full, as served and as shipped (api.md 100). */
export interface BuiltInSkill extends BuiltInSkillSummary {
  body: string;
  files: SkillFile[];
  builtIn: { description: string; body: string; files: SkillFile[] };
}

/** Body of `PUT /skills/built-in/:name` (api.md 101). */
export interface SaveBuiltInSkillInput {
  description: string;
  body: string;
  files: SkillFile[];
}

/** Style A answer of the built-in write endpoints (api.md 101, 102). */
export interface BuiltInSkillMutationResult {
  ok: boolean;
  message: string;
  skill?: BuiltInSkill;
}

@Injectable({ providedIn: 'root' })
export class SkillsApiService {
  private readonly http = inject(HttpClient);

  list(): Observable<{ skills: SkillSummary[] }> {
    return this.http.get<{ skills: SkillSummary[] }>(`${API_BASE_URL}/skills`);
  }

  get(id: string): Observable<Skill> {
    return this.http.get<Skill>(
      `${API_BASE_URL}/skills/${encodeURIComponent(id)}`,
    );
  }

  create(input: SaveSkillInput): Observable<SkillMutationResult> {
    return this.http.post<SkillMutationResult>(`${API_BASE_URL}/skills`, input);
  }

  save(id: string, input: SaveSkillInput): Observable<SkillMutationResult> {
    return this.http.put<SkillMutationResult>(
      `${API_BASE_URL}/skills/${encodeURIComponent(id)}`,
      input,
    );
  }

  delete(id: string): Observable<SkillMutationResult> {
    return this.http.delete<SkillMutationResult>(
      `${API_BASE_URL}/skills/${encodeURIComponent(id)}`,
    );
  }

  listBuiltIn(): Observable<{ skills: BuiltInSkillSummary[] }> {
    return this.http.get<{ skills: BuiltInSkillSummary[] }>(
      `${API_BASE_URL}/skills/built-in`,
    );
  }

  getBuiltIn(name: string): Observable<BuiltInSkill> {
    return this.http.get<BuiltInSkill>(
      `${API_BASE_URL}/skills/built-in/${encodeURIComponent(name)}`,
    );
  }

  saveBuiltIn(
    name: string,
    input: SaveBuiltInSkillInput,
  ): Observable<BuiltInSkillMutationResult> {
    return this.http.put<BuiltInSkillMutationResult>(
      `${API_BASE_URL}/skills/built-in/${encodeURIComponent(name)}`,
      input,
    );
  }

  resetBuiltIn(name: string): Observable<BuiltInSkillMutationResult> {
    return this.http.delete<BuiltInSkillMutationResult>(
      `${API_BASE_URL}/skills/built-in/${encodeURIComponent(name)}`,
    );
  }
}
