import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { API_BASE_URL } from '../../../core/config/api.config';
import { ReadinessApiService } from './readiness-api.service';

describe('ReadinessApiService', () => {
  let service: ReadinessApiService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(ReadinessApiService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('lists the reports of a datasource', () => {
    let result: unknown;
    service.list('ds-1').subscribe((r) => (result = r));
    const req = http.expectOne(
      (r) => r.url === `${API_BASE_URL}/data-readiness/assessments`,
    );
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('datasourceId')).toBe('ds-1');
    req.flush({ reports: [] });
    expect(result).toEqual({ reports: [] });
  });

  it('gets one report by id', () => {
    service.get('r 1').subscribe();
    const req = http.expectOne(
      `${API_BASE_URL}/data-readiness/assessments/r%201`,
    );
    expect(req.request.method).toBe('GET');
    req.flush({});
  });
});
