import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { API_BASE_URL } from '../../../core/config/api.config';
import { DataModelApiService, slugifyDatasetName } from './data-model-api.service';

describe('slugifyDatasetName', () => {
  it('lowercases and dashes a readable dataset name', () => {
    expect(slugifyDatasetName('World Cup Core')).toBe('world-cup-core');
  });

  it('collapses punctuation and trims leading/trailing dashes', () => {
    expect(slugifyDatasetName('  My -- Dataset!! ')).toBe('my-dataset');
  });

  it('falls back to "dataset" when nothing slug-like survives', () => {
    expect(slugifyDatasetName('???')).toBe('dataset');
  });
});

describe('DataModelApiService', () => {
  let service: DataModelApiService;
  let http: HttpTestingController;

  const base = `${API_BASE_URL}/datasets/World%20Cup%20Core/model`;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(DataModelApiService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('gets the current model', () => {
    service.get('World Cup Core').subscribe();
    const req = http.expectOne(base);
    expect(req.request.method).toBe('GET');
    req.flush({ dataset: 'World Cup Core', currentVersion: 1, version: {} });
  });

  it('gets a specific version', () => {
    service.getVersion('World Cup Core', 2).subscribe();
    const req = http.expectOne(`${base}/versions/2`);
    expect(req.request.method).toBe('GET');
    req.flush({ version: 2 });
  });

  it('lists every version', () => {
    service.listVersions('World Cup Core').subscribe();
    const req = http.expectOne(`${base}/versions`);
    expect(req.request.method).toBe('GET');
    req.flush({ versions: [] });
  });

  it('puts yaml to save a new version', () => {
    service.putYaml('World Cup Core', 'model: x').subscribe();
    const req = http.expectOne(base);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ yaml: 'model: x' });
    req.flush({ ok: true, version: 2 });
  });

  it('reverts to a given version', () => {
    service.revert('World Cup Core', 1).subscribe();
    const req = http.expectOne(`${base}/revert`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ version: 1 });
    req.flush({ ok: true, currentVersion: 1 });
  });

  it('triggers a rebootstrap from the snapshot', () => {
    service.bootstrap('World Cup Core').subscribe();
    const req = http.expectOne(`${base}/bootstrap`);
    expect(req.request.method).toBe('POST');
    req.flush({ ok: true, currentVersion: 2 });
  });

  it('reads the drift report', () => {
    service.drift('World Cup Core').subscribe();
    const req = http.expectOne(`${base}/drift`);
    expect(req.request.method).toBe('GET');
    req.flush({ checkedAt: '', snapshotOf: 1, added: [], removed: [], changed: [], entitiesAdded: [], entitiesRemoved: [] });
  });

  it('resolves references', () => {
    service.resolve('World Cup Core', ['matches']).subscribe();
    const req = http.expectOne(`${base}/resolve`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ refs: ['matches'] });
    req.flush({ results: [] });
  });

  it('exports a version as a Blob (filename is built client-side, review finding 4)', (done) => {
    service.exportYaml('World Cup Core', 1).subscribe((blob) => {
      expect(blob).toBeInstanceOf(Blob);
      done();
    });
    const req = http.expectOne(
      (r) => r.url === `${base}/export` && r.params.get('version') === '1',
    );
    expect(req.request.method).toBe('GET');
    req.flush(new Blob(['model: x']));
  });

  it('exports the current version when none is given', (done) => {
    service.exportYaml('World Cup Core').subscribe((blob) => {
      expect(blob).toBeInstanceOf(Blob);
      done();
    });
    const req = http.expectOne(`${base}/export`);
    req.flush(new Blob(['model: x']));
  });

  it('imports a yaml file as a new version', () => {
    service.importYaml('World Cup Core', 'model: x').subscribe();
    const req = http.expectOne(`${base}/import`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ yaml: 'model: x' });
    req.flush({ ok: true, version: 2 });
  });

  it('serializes a structured model to yaml', () => {
    const model = { model: 'x', version: 1, entities: [], relationships: [], metrics: [] };
    service.serialize('World Cup Core', model).subscribe();
    const req = http.expectOne(`${base}/serialize`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ model });
    req.flush({ yaml: 'model: x' });
  });

  it('lists model-scoped metrics', () => {
    service.listModelMetrics('World Cup Core').subscribe();
    const req = http.expectOne(`${base}/metrics`);
    expect(req.request.method).toBe('GET');
    req.flush({ metrics: [] });
  });

  it('creates, updates and deletes a model-scoped metric', () => {
    const metric = { name: 'goals', label: 'Goals', entity: 'matches', agg: 'count' as const };
    service.createModelMetric('World Cup Core', metric).subscribe();
    const create = http.expectOne(`${base}/metrics`);
    expect(create.request.method).toBe('POST');
    expect(create.request.body).toEqual(metric);
    create.flush({ ok: true, version: 2 });

    service.updateModelMetric('World Cup Core', 'goals', metric).subscribe();
    const update = http.expectOne(`${base}/metrics/goals`);
    expect(update.request.method).toBe('PUT');
    update.flush({ ok: true, version: 3 });

    service.deleteModelMetric('World Cup Core', 'goals').subscribe();
    const del = http.expectOne(`${base}/metrics/goals`);
    expect(del.request.method).toBe('DELETE');
    del.flush({ ok: true, version: 4 });
  });

  it('reads model-metric candidates', () => {
    service.modelMetricCandidates('World Cup Core').subscribe();
    const req = http.expectOne(`${base}/metrics/candidates`);
    expect(req.request.method).toBe('GET');
    req.flush({ candidates: [] });
  });
});
