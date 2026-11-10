import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '../../../core/config/api.config';
import { PersonaInput, UserPersona } from '../models/persona.model';

/**
 * CRUD for user personas. Failures surface as HttpErrorResponse whose
 * `error.message` carries the backend's reason (400/404/409).
 */
@Injectable({ providedIn: 'root' })
export class PersonasApiService {
  private readonly http = inject(HttpClient);

  list(): Observable<UserPersona[]> {
    return this.http.get<UserPersona[]>(`${API_BASE_URL}/personas`);
  }

  create(input: PersonaInput): Observable<UserPersona> {
    return this.http.post<UserPersona>(`${API_BASE_URL}/personas`, input);
  }

  update(id: string, patch: Partial<PersonaInput>): Observable<UserPersona> {
    return this.http.patch<UserPersona>(
      `${API_BASE_URL}/personas/${encodeURIComponent(id)}`,
      patch,
    );
  }

  remove(id: string): Observable<void> {
    return this.http.delete<void>(
      `${API_BASE_URL}/personas/${encodeURIComponent(id)}`,
    );
  }
}
