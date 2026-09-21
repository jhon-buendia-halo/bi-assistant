import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../../../core/config/api.config';

export interface PostgresConnectionConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
}

/** What the connection currently points at — never carries the password. */
export type TestingDataConnectionSummary = Omit<
  PostgresConnectionConfig,
  'password'
>;

export interface TestingDataFixtureStatus {
  loaded: boolean;
  datasourceId?: string;
  datasourceName?: string;
  datasetName?: string;
  entityCount?: number;
  requiredCount: number;
  connection?: TestingDataConnectionSummary;
}

export interface TestingDataFixture {
  id: string;
  name: string;
  description: string;
  /** false = this fixture can only be registered against an existing database, never seeded. */
  seedable: boolean;
  schema: string;
  defaults: PostgresConnectionConfig;
  status: TestingDataFixtureStatus;
}

export interface TestingDataListResponse {
  fixtures: TestingDataFixture[];
}

export interface TestingDataLoadResult {
  ok: boolean;
  message: string;
  datasourceId?: string;
  datasetName?: string;
  entityCount?: number;
  createdDatabase?: boolean;
  seeded?: boolean;
}

export interface TestingDataRemoveResult {
  ok: boolean;
  message: string;
}

@Injectable({ providedIn: 'root' })
export class TestingDataApiService {
  private readonly http = inject(HttpClient);

  getStatus(): Observable<TestingDataListResponse> {
    return this.http.get<TestingDataListResponse>(
      `${API_BASE_URL}/testing-data`,
    );
  }

  load(
    fixtureId: string,
    config: PostgresConnectionConfig,
  ): Observable<TestingDataLoadResult> {
    return this.http.post<TestingDataLoadResult>(
      `${API_BASE_URL}/testing-data/${encodeURIComponent(fixtureId)}/load`,
      config,
    );
  }

  remove(fixtureId: string): Observable<TestingDataRemoveResult> {
    return this.http.delete<TestingDataRemoveResult>(
      `${API_BASE_URL}/testing-data/${encodeURIComponent(fixtureId)}`,
    );
  }
}
