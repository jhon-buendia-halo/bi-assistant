import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { API_BASE_URL } from '../../../core/config/api.config';
import { Dataset, DatasetsApiService } from './datasets-api.service';

describe('DatasetsApiService', () => {
  let service: DatasetsApiService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(DatasetsApiService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('lists datasets', () => {
    service.getDatasets().subscribe();
    const req = http.expectOne(`${API_BASE_URL}/datasets`);
    expect(req.request.method).toBe('GET');
    req.flush({ datasets: [] });
  });

  it('creates a dataset with the schema snapshot and datasource', () => {
    const entities = [
      {
        key: 'main.health.claims',
        columns: [{ name: 'id', type: 'text', nullable: false }],
      },
    ];
    service
      .createDataset('health-insurance', ['main.health.claims'], entities, {
        id: 'ds-1',
        kind: 'postgres',
      })
      .subscribe();

    const req = http.expectOne(`${API_BASE_URL}/datasets`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      name: 'health-insurance',
      tables: ['main.health.claims'],
      entities,
      datasourceId: 'ds-1',
      datasourceKind: 'postgres',
    });
    req.flush({ ok: true, message: 'Saved' });
  });

  it('deletes a dataset by name', () => {
    service.deleteDataset('health-insurance').subscribe();
    const req = http.expectOne(`${API_BASE_URL}/datasets/health-insurance`);
    expect(req.request.method).toBe('DELETE');
    req.flush({ ok: true, message: 'Deleted' });
  });

  it('posts a re-profile request and returns the refreshed dataset', () => {
    const updated: Dataset = {
      name: 'health-insurance',
      tables: ['main.health.claims'],
      profiledAt: '2026-09-23T00:00:00.000Z',
    };
    service.reprofile('health-insurance').subscribe((res) => {
      expect(res.dataset).toEqual(updated);
    });

    const req = http.expectOne(
      `${API_BASE_URL}/datasets/health-insurance/profile`,
    );
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({});
    req.flush({ ok: true, message: 'Re-profiled', dataset: updated });
  });

  it('encodes the dataset name when re-profiling', () => {
    service.reprofile('health insurance').subscribe();
    const req = http.expectOne(
      `${API_BASE_URL}/datasets/health%20insurance/profile`,
    );
    req.flush({ ok: true, message: 'Re-profiled' });
    expect(req.request.method).toBe('POST');
  });

  it('patches the description', () => {
    service
      .updateDescription('health-insurance', 'Claims and denials.')
      .subscribe();

    const req = http.expectOne(`${API_BASE_URL}/datasets/health-insurance`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ description: 'Claims and denials.' });
    req.flush({ ok: true, message: 'Updated' });
  });

  it('sends an empty string to clear the description', () => {
    service.updateDescription('health-insurance', '').subscribe();
    const req = http.expectOne(`${API_BASE_URL}/datasets/health-insurance`);
    expect(req.request.body).toEqual({ description: '' });
    req.flush({ ok: true, message: 'Updated' });
  });
});
