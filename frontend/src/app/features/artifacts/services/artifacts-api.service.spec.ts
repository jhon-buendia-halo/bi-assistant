import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { API_BASE_URL } from '../../../core/config/api.config';
import { ArtifactSummary } from '../models/artifact.model';
import { ArtifactsApiService } from './artifacts-api.service';

const SUMMARY: ArtifactSummary = {
  id: 'a-1',
  kind: 'dashboard',
  name: 'Sales',
  description: '',
  widgetCount: 3,
  filterCount: 1,
  hasImage: true,
  createdAt: '2026-11-15T10:00:00.000Z',
  updatedAt: '2026-11-15T10:00:00.000Z',
};

describe('ArtifactsApiService', () => {
  let service: ArtifactsApiService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(ArtifactsApiService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('lists the artifacts', () => {
    let result: ArtifactSummary[] = [];
    service.list().subscribe((artifacts) => (result = artifacts));
    const req = http.expectOne(`${API_BASE_URL}/artifacts`);
    expect(req.request.method).toBe('GET');
    req.flush([SUMMARY]);
    expect(result).toEqual([SUMMARY]);
  });

  it('gets one artifact, its id encoded', () => {
    service.get('a/1').subscribe();
    const req = http.expectOne(`${API_BASE_URL}/artifacts/a%2F1`);
    expect(req.request.method).toBe('GET');
    req.flush({ ...SUMMARY, blueprint: {}, document: '<html></html>' });
  });

  it('saves a version with a POST to /save (api.md 166)', () => {
    service.save('a/1', 3).subscribe();
    const req = http.expectOne(`${API_BASE_URL}/artifacts/a%2F1/save`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ version: 3 });
    req.flush({ ...SUMMARY, blueprint: {}, document: '' });
  });

  it('saves the latest version when none is given', () => {
    service.save('a-1').subscribe();
    const req = http.expectOne(`${API_BASE_URL}/artifacts/a-1/save`);
    expect(req.request.body).toEqual({});
    req.flush({ ...SUMMARY, blueprint: {}, document: '' });
  });

  it('renames with a PATCH of the name', () => {
    service.rename('a-1', 'New').subscribe();
    const req = http.expectOne(`${API_BASE_URL}/artifacts/a-1`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ name: 'New' });
    req.flush({ ...SUMMARY, name: 'New' });
  });

  it('deletes an artifact', () => {
    service.delete('a-1').subscribe();
    const req = http.expectOne(`${API_BASE_URL}/artifacts/a-1`);
    expect(req.request.method).toBe('DELETE');
    req.flush(null, { status: 204, statusText: 'No Content' });
  });

  it('builds the image URL', () => {
    expect(service.imageUrl('a-1')).toBe(`${API_BASE_URL}/artifacts/a-1/image`);
  });
});
