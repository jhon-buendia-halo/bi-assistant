import { HttpClient, HttpParams, HttpResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../../../core/config/api.config';
import {
  AddMappingResult,
  AdminGroupsPage,
  AdminOverview,
  AdminUserDetail,
  AdminUsersPage,
  AdminUsersQuery,
  AssignRoleResult,
  AssignableRole,
  GroupRoleMapping,
  OkResult,
  RoleGrant,
  SaveRolesResult,
  TransferResult,
} from '../models/admin.models';

/** The admin API (api.md 2.15); every call needs `manage-users`. */
@Injectable({ providedIn: 'root' })
export class AdminApiService {
  private readonly http = inject(HttpClient);
  private readonly base = `${API_BASE_URL}/admin`;

  /** Tiles, Needs attention, weekly active users, recent activity (api 81). */
  overview(): Observable<AdminOverview> {
    return this.http.get<AdminOverview>(`${this.base}/overview`);
  }

  /** The overview as a CSV file, with its headers for the file name (api 82). */
  exportOverview(): Observable<HttpResponse<Blob>> {
    return this.http.get(`${this.base}/overview/export`, {
      observe: 'response',
      responseType: 'blob',
    });
  }

  /** Search, filter and page the users (api 83). */
  users(query: AdminUsersQuery = {}): Observable<AdminUsersPage> {
    let params = new HttpParams();
    const q = query.q?.trim();
    if (q) params = params.set('q', q);
    if (query.filter && query.filter !== 'all') {
      params = params.set('filter', query.filter);
    }
    if (query.page) params = params.set('page', query.page);
    if (query.pageSize) params = params.set('pageSize', query.pageSize);
    if (query.excludeDeactivated) params = params.set('excludeDeactivated', true);
    return this.http.get<AdminUsersPage>(`${this.base}/users`, { params });
  }

  /** One user's detail (api 84). */
  user(id: string): Observable<AdminUserDetail> {
    return this.http.get<AdminUserDetail>(
      `${this.base}/users/${encodeURIComponent(id)}`,
    );
  }

  /** Replaces the user's direct assignments, all or nothing (api 85). */
  saveRoles(id: string, roles: RoleGrant[]): Observable<SaveRolesResult> {
    return this.http.put<SaveRolesResult>(
      `${this.base}/users/${encodeURIComponent(id)}/roles`,
      { roles },
    );
  }

  /** Moves user agents to another owner, all or nothing (api 86). */
  transferAgents(agentIds: string[], toUserId: string): Observable<TransferResult> {
    return this.http.post<TransferResult>(`${this.base}/agents/transfer`, {
      agentIds,
      toUserId,
    });
  }

  /** Search and page the groups (api 87). */
  groups(
    query: { q?: string; page?: number; pageSize?: number } = {},
  ): Observable<AdminGroupsPage> {
    let params = new HttpParams();
    const q = query.q?.trim();
    if (q) params = params.set('q', q);
    if (query.page) params = params.set('page', query.page);
    if (query.pageSize) params = params.set('pageSize', query.pageSize);
    return this.http.get<AdminGroupsPage>(`${this.base}/groups`, { params });
  }

  /** Every group mapping (api 88). */
  roleMappings(): Observable<{ mappings: GroupRoleMapping[] }> {
    return this.http.get<{ mappings: GroupRoleMapping[] }>(
      `${this.base}/role-mappings`,
    );
  }

  /** Adds a group mapping: `201` added, `200` already there (api 89). */
  addRoleMapping(body: {
    groupId: string;
    role: AssignableRole;
    datasourceId?: string;
  }): Observable<HttpResponse<AddMappingResult>> {
    return this.http.post<AddMappingResult>(`${this.base}/role-mappings`, body, {
      observe: 'response',
    });
  }

  /** Removes a group mapping (api 90). */
  removeRoleMapping(id: string): Observable<OkResult> {
    return this.http.delete<OkResult>(
      `${this.base}/role-mappings/${encodeURIComponent(id)}`,
    );
  }

  /** Assigns a role: `201` assigned, `200` already held directly (api 79). */
  assignRole(body: {
    userId: string;
    role: AssignableRole;
    datasourceId?: string;
  }): Observable<HttpResponse<AssignRoleResult>> {
    return this.http.post<AssignRoleResult>(`${this.base}/role-assignments`, body, {
      observe: 'response',
    });
  }

  /** Removes a direct role assignment (api 80). */
  removeRoleAssignment(id: string): Observable<OkResult> {
    return this.http.delete<OkResult>(
      `${this.base}/role-assignments/${encodeURIComponent(id)}`,
    );
  }
}
