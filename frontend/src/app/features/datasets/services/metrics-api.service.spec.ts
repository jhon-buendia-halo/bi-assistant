import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { API_BASE_URL } from '../../../core/config/api.config';
import { MetricsApiService } from './metrics-api.service';

describe('MetricsApiService', () => {
  let service: MetricsApiService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(MetricsApiService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('scopes the list to the entities in hand', () => {
    service.list(['main.health.claims', 'main.health.members']).subscribe();

    const req = http.expectOne(
      `${API_BASE_URL}/metrics?entities=main.health.claims,main.health.members`,
    );
    expect(req.request.method).toBe('GET');
    req.flush({ metrics: [] });
  });

  it('omits the scope when no entity is included', () => {
    service.list([]).subscribe();

    const req = http.expectOne(`${API_BASE_URL}/metrics`);
    expect(req.request.params.has('entities')).toBe(false);
    req.flush({ metrics: [] });
  });

  it('reads the promotion candidates', () => {
    service.candidates(['main.health.claims']).subscribe();

    const req = http.expectOne(
      `${API_BASE_URL}/metrics/candidates?entities=main.health.claims`,
    );
    expect(req.request.method).toBe('GET');
    req.flush({ candidates: [] });
  });

  it('posts a new definition', () => {
    const input = {
      name: 'denial_rate',
      label: 'Denial rate',
      entity: 'main.health.claims',
      expression: 'COUNT(*)',
    };

    service.create(input).subscribe();

    const req = http.expectOne(`${API_BASE_URL}/metrics`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(input);
    req.flush({ ok: true, message: 'Saved' });
  });

  it('puts an edit and deletes by id', () => {
    service
      .update('metric 1', {
        name: 'denial_rate',
        label: 'Denial rate',
        entity: 'main.health.claims',
        expression: 'COUNT(*)',
      })
      .subscribe();
    const put = http.expectOne(`${API_BASE_URL}/metrics/metric%201`);
    expect(put.request.method).toBe('PUT');
    put.flush({ ok: true, message: 'Updated' });

    service.delete('metric 1').subscribe();
    const del = http.expectOne(`${API_BASE_URL}/metrics/metric%201`);
    expect(del.request.method).toBe('DELETE');
    del.flush({ ok: true, message: 'Deleted' });
  });
});
