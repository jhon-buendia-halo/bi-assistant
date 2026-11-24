import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { API_BASE_URL } from '../../../core/config/api.config';
import { ArtifactsApiService } from './artifacts-api.service';

describe('ArtifactsApiService, versions and download', () => {
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

  it('gets one version with ?version', () => {
    service.get('a-1', 2).subscribe();
    const req = http.expectOne(
      (r) => r.url === `${API_BASE_URL}/artifacts/a-1`,
    );
    expect(req.request.params.get('version')).toBe('2');
    req.flush({});
  });

  it('gets the current version without a query', () => {
    service.get('a-1').subscribe();
    const req = http.expectOne(`${API_BASE_URL}/artifacts/a-1`);
    expect(req.request.params.keys()).toEqual([]);
    req.flush({});
  });

  it('downloads a version as a blob', () => {
    let blob: Blob | undefined;
    service.download('a-1', 3).subscribe((b) => (blob = b));
    const req = http.expectOne(
      (r) => r.url === `${API_BASE_URL}/artifacts/a-1/download`,
    );
    expect(req.request.responseType).toBe('blob');
    expect(req.request.params.get('version')).toBe('3');
    req.flush(new Blob(['zip']));
    expect(blob?.size).toBe(3);
  });
});
