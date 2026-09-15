import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../../../core/config/api.config';
import {
  DatabricksConnectionConfig,
  InventoryResult,
  TestConnectionResult,
} from '../models/databricks.model';

@Injectable({ providedIn: 'root' })
export class DatabricksApiService {
  private readonly http = inject(HttpClient);

  testConnection(
    config: DatabricksConnectionConfig,
  ): Observable<TestConnectionResult> {
    return this.http.post<TestConnectionResult>(
      `${API_BASE_URL}/databricks/test-connection`,
      config,
    );
  }

  getInventory(): Observable<InventoryResult> {
    return this.http.get<InventoryResult>(
      `${API_BASE_URL}/databricks/inventory`,
    );
  }

  getConnection(): Observable<DatabricksConnectionConfig | null> {
    return this.http.get<DatabricksConnectionConfig | null>(
      `${API_BASE_URL}/databricks/connection`,
    );
  }

  saveConnection(
    config: DatabricksConnectionConfig,
  ): Observable<TestConnectionResult> {
    return this.http.post<TestConnectionResult>(
      `${API_BASE_URL}/databricks/connection`,
      config,
    );
  }
}
