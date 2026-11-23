import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { API_BASE_URL } from '../../../../core/config/api.config';
import { Artifact } from '../../models/artifact.model';
import { ArtifactDetail } from './artifact-detail';

function artifact(version: number, over: Partial<Artifact> = {}): Artifact {
  return {
    id: 'a-1',
    kind: 'dashboard',
    name: 'Sales by region',
    description: '',
    widgetCount: 4,
    filterCount: 1,
    hasImage: false,
    hasData: true,
    createdAt: '2026-11-20T10:00:00.000Z',
    updatedAt: '2026-11-22T10:00:00.000Z',
    blueprint: {},
    document: `<html>v${version}</html>`,
    version,
    versions: [
      {
        version: 1,
        createdAt: '2026-11-20T10:00:00.000Z',
        instruction: 'First cut',
        rowCount: 10,
        widgetCount: 3,
        filterCount: 1,
      },
      {
        version: 2,
        createdAt: '2026-11-22T10:00:00.000Z',
        instruction: 'Add a region filter',
        rowCount: 12,
        widgetCount: 4,
        filterCount: 1,
      },
    ],
    ...over,
  };
}

describe('ArtifactDetail, versions', () => {
  let http: HttpTestingController;

  function render(version: number | null = null) {
    TestBed.configureTestingModule({
      imports: [ArtifactDetail],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(ArtifactDetail);
    fixture.componentRef.setInput('artifactId', 'a-1');
    fixture.componentRef.setInput('version', version);
    fixture.detectChanges();
    return fixture;
  }
  const q = (root: HTMLElement, id: string) =>
    root.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
  const detailReq = () =>
    http.expectOne((r) => r.url === `${API_BASE_URL}/artifacts/a-1`);

  afterEach(() => http.verify());

  it('opens at the asked version and shows its instruction, Live data and Download', () => {
    const fixture = render(1);
    const req = detailReq();
    expect(req.request.params.get('version')).toBe('1');
    req.flush(artifact(1));
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(q(el, 'artifact-version-instruction')?.textContent).toContain(
      'First cut',
    );
    expect(q(el, 'artifact-detail-live')?.textContent).toContain('Live data');
    expect(q(el, 'artifact-download')).not.toBeNull();
    expect(q(el, 'artifact-data-missing')).toBeNull();
    const options = Array.from(
      el.querySelectorAll('[data-testid="artifact-version-select"] option'),
    ).map((o) => o.textContent?.trim());
    expect(options).toEqual([
      'Version 2 · 22 Nov 2026',
      'Version 1 · 20 Nov 2026',
    ]);
  });

  it('reloads the frame at the version picked', () => {
    const fixture = render();
    detailReq().flush(artifact(2));
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const select = q(el, 'artifact-version-select') as HTMLSelectElement;
    select.value = '1';
    select.dispatchEvent(new Event('change'));
    const req = detailReq();
    expect(req.request.params.get('version')).toBe('1');
    req.flush(artifact(1));
    fixture.detectChanges();
    expect(q(el, 'artifact-version-instruction')?.textContent).toContain(
      'First cut',
    );
  });

  it('says so when the version has no data saved', () => {
    const fixture = render();
    detailReq().flush(artifact(1, { dataMissing: true, hasData: false }));
    fixture.detectChanges();
    expect(q(fixture.nativeElement, 'artifact-data-missing')).not.toBeNull();
  });

  it('downloads the shown version', () => {
    const fixture = render();
    detailReq().flush(artifact(2));
    fixture.detectChanges();
    q(fixture.nativeElement, 'artifact-download')!.click();
    const req = http.expectOne(
      (r) => r.url === `${API_BASE_URL}/artifacts/a-1/download`,
    );
    expect(req.request.params.get('version')).toBe('2');
    req.flush(new Blob(['zip']));
  });
});
