import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { API_BASE_URL } from '../../../core/config/api.config';
import { VisualChart, VisualChartInput } from '../models/visual-chart.model';
import { VisualsApiService } from './visuals-api.service';

const INPUT: VisualChartInput = {
  name: 'Bar chart',
  category: 'Comparison',
  previewKey: 'bar',
  rendererForm: 'bar',
  description: '',
  whenToUse: '',
  whenToAvoid: '',
  dataShape: '1 category + 1 measure',
  enabled: true,
};

const CHART: VisualChart = {
  ...INPUT,
  id: 'v1',
  builtIn: false,
  createdAt: '2026-11-10T00:00:00.000Z',
  updatedAt: '2026-11-10T00:00:00.000Z',
};

describe('VisualsApiService', () => {
  let service: VisualsApiService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(VisualsApiService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('lists with GET /visuals', () => {
    let result: VisualChart[] | undefined;
    service.list().subscribe((r) => (result = r));
    const req = http.expectOne(`${API_BASE_URL}/visuals`);
    expect(req.request.method).toBe('GET');
    req.flush([CHART]);
    expect(result).toEqual([CHART]);
  });

  it('creates with POST /visuals and the input as body', () => {
    service.create(INPUT).subscribe();
    const req = http.expectOne(`${API_BASE_URL}/visuals`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(INPUT);
    req.flush(CHART);
  });

  it('updates with PATCH /visuals/:id and the patch as body', () => {
    service.update('v 1', { enabled: false }).subscribe();
    const req = http.expectOne(`${API_BASE_URL}/visuals/v%201`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ enabled: false });
    req.flush(CHART);
  });

  it('removes with DELETE /visuals/:id', () => {
    let done = false;
    service.remove('v1').subscribe({ complete: () => (done = true) });
    const req = http.expectOne(`${API_BASE_URL}/visuals/v1`);
    expect(req.request.method).toBe('DELETE');
    req.flush(null, { status: 204, statusText: 'No Content' });
    expect(done).toBeTrue();
  });
});
