import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { API_BASE_URL } from '../../../../core/config/api.config';
import { ShellState } from '../../../../core/shell/shell-state';
import { ArtifactsNavState } from '../../../artifacts/services/artifacts-nav-state';
import { DashboardRef } from '../../../sessions/models/session.model';
import { RunDashboardState } from '../../services/run-dashboard-state';
import { RunDashboardCard } from './run-dashboard-card';

const REF: DashboardRef = {
  artifactId: 'a-1234567890',
  version: 2,
  title: 'Sales by region',
  action: 'updated',
  widgetCount: 6,
  filterCount: 2,
  rowCount: 1234,
  saved: true,
};
const DRAFT: DashboardRef = { ...REF, saved: false };

describe('RunDashboardCard', () => {
  let http: HttpTestingController;

  function render(ref: DashboardRef = REF) {
    TestBed.configureTestingModule({
      imports: [RunDashboardCard],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(RunDashboardCard);
    fixture.componentRef.setInput('dashboard', ref);
    fixture.detectChanges();
    current = fixture;
    return fixture.nativeElement as HTMLElement;
  }
  let current: { detectChanges(): void };
  const q = (el: HTMLElement, id: string) =>
    el.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

  afterEach(() => http.verify());

  it('shows the title, version, counts and the Live data chip', () => {
    const el = render();
    expect(q(el, 'run-dashboard-title')?.textContent?.trim()).toBe(
      'Sales by region',
    );
    expect(q(el, 'run-dashboard-version')?.textContent?.trim()).toBe(
      'Updated · Version 2',
    );
    expect(q(el, 'run-dashboard-meta')?.textContent?.trim()).toBe(
      '6 widgets · 2 filters · 1,234 rows',
    );
    expect(q(el, 'run-dashboard-live')?.textContent?.trim()).toBe('Live data');
  });

  it('says Created for a first version, with singular counts', () => {
    const el = render({
      ...REF,
      version: 1,
      action: 'created',
      widgetCount: 1,
      filterCount: 1,
      rowCount: 1,
    });
    expect(q(el, 'run-dashboard-version')?.textContent?.trim()).toBe(
      'Created · Version 1',
    );
    expect(q(el, 'run-dashboard-meta')?.textContent?.trim()).toBe(
      '1 widget · 1 filter · 1 row',
    );
  });

  it('Open shows the Artifacts page at that version', () => {
    const el = render();
    q(el, 'run-dashboard-open')!.click();
    const nav = TestBed.inject(ArtifactsNavState);
    expect(nav.activeArtifactId()).toBe('a-1234567890');
    expect(nav.activeArtifactVersion()).toBe(2);
    expect(TestBed.inject(ShellState).mainView()).toBe('artifact-detail');
  });

  it('Download asks for that version as a blob', () => {
    const el = render();
    q(el, 'run-dashboard-download')!.click();
    const req = http.expectOne(
      (r) => r.url === `${API_BASE_URL}/artifacts/a-1234567890/download`,
    );
    expect(req.request.params.get('version')).toBe('2');
    expect(req.request.responseType).toBe('blob');
    req.flush(new Blob(['zip']));
  });

  it('a saved version shows the Saved chip, Open and Download, no Save', () => {
    const el = render();
    expect(q(el, 'run-dashboard-status')?.textContent?.trim()).toBe(
      '✓ Saved to Artifacts',
    );
    expect(q(el, 'run-dashboard-save')).toBeNull();
    expect(q(el, 'run-dashboard-show')).toBeNull();
  });

  it('a draft shows the Draft chip, Show in panel and Save, no Open or Download', () => {
    const el = render(DRAFT);
    expect(q(el, 'run-dashboard-status')?.textContent?.trim()).toBe('Draft');
    expect(q(el, 'run-dashboard-show')?.textContent?.trim()).toBe(
      'Show in panel',
    );
    expect(q(el, 'run-dashboard-save')?.textContent?.trim()).toBe(
      'Save to Artifacts',
    );
    expect(q(el, 'run-dashboard-open')).toBeNull();
    expect(q(el, 'run-dashboard-download')).toBeNull();
  });

  it('a ref stored before drafts existed (no saved flag) is a draft', () => {
    const legacy: Partial<DashboardRef> = { ...REF };
    delete legacy.saved;
    const el = render(legacy as DashboardRef);
    expect(q(el, 'run-dashboard-status')?.textContent?.trim()).toBe('Draft');
  });

  it('Show in panel opens that version in the shared panel state', () => {
    const el = render(DRAFT);
    q(el, 'run-dashboard-show')!.click();
    const state = TestBed.inject(RunDashboardState);
    expect(state.shown()?.artifactId).toBe('a-1234567890');
    expect(state.shown()?.version).toBe(2);
    http
      .expectOne((r) => r.url === `${API_BASE_URL}/artifacts/a-1234567890`)
      .flush({});
  });

  it('Save to Artifacts saves that version (api.md 166) and turns the card Saved', () => {
    const el = render(DRAFT);
    q(el, 'run-dashboard-save')!.click();
    const req = http.expectOne(`${API_BASE_URL}/artifacts/a-1234567890/save`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ version: 2 });
    req.flush({ id: 'a-1234567890', version: 2, savedVersions: [2] });
    current.detectChanges();
    expect(q(el, 'run-dashboard-status')?.textContent?.trim()).toBe(
      '✓ Saved to Artifacts',
    );
    expect(q(el, 'run-dashboard-download')).not.toBeNull();
    expect(q(el, 'run-dashboard-save')).toBeNull();
  });
});
