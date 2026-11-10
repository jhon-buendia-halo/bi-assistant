import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { API_BASE_URL } from '../../../core/config/api.config';
import { PersonaInput, UserPersona } from '../models/persona.model';
import { PersonasApiService } from './personas-api.service';

const INPUT: PersonaInput = {
  name: 'Finance lead',
  role: 'CFO',
  description: '',
  goals: '',
  typicalQuestions: ['What is our burn?'],
  expertise: 'intermediate',
  answerStyle: '',
};

const PERSONA: UserPersona = {
  ...INPUT,
  id: 'p1',
  createdAt: '2026-11-09T00:00:00.000Z',
  updatedAt: '2026-11-09T00:00:00.000Z',
};

describe('PersonasApiService', () => {
  let service: PersonasApiService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(PersonasApiService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('lists with GET /personas', () => {
    let result: UserPersona[] | undefined;
    service.list().subscribe((r) => (result = r));
    const req = http.expectOne(`${API_BASE_URL}/personas`);
    expect(req.request.method).toBe('GET');
    req.flush([PERSONA]);
    expect(result).toEqual([PERSONA]);
  });

  it('creates with POST /personas and the input as body', () => {
    service.create(INPUT).subscribe();
    const req = http.expectOne(`${API_BASE_URL}/personas`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(INPUT);
    req.flush(PERSONA);
  });

  it('updates with PATCH /personas/:id and the patch as body', () => {
    service.update('p 1', { role: 'CEO' }).subscribe();
    const req = http.expectOne(`${API_BASE_URL}/personas/p%201`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ role: 'CEO' });
    req.flush(PERSONA);
  });

  it('removes with DELETE /personas/:id', () => {
    let done = false;
    service.remove('p1').subscribe({ complete: () => (done = true) });
    const req = http.expectOne(`${API_BASE_URL}/personas/p1`);
    expect(req.request.method).toBe('DELETE');
    req.flush(null, { status: 204, statusText: 'No Content' });
    expect(done).toBeTrue();
  });

  it('passes the backend message through on a conflict', () => {
    let message = '';
    service.create(INPUT).subscribe({
      error: (err) => (message = err.error.message),
    });
    http
      .expectOne(`${API_BASE_URL}/personas`)
      .flush(
        { message: 'A persona named "Finance lead" already exists' },
        { status: 409, statusText: 'Conflict' },
      );
    expect(message).toBe('A persona named "Finance lead" already exists');
  });
});
