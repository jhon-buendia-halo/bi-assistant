import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { API_BASE_URL } from '../../../../core/config/api.config';
import { Artifact } from '../../../artifacts/models/artifact.model';
import { DashboardRef } from '../../../sessions/models/session.model';
import { RunDashboardState } from '../../services/run-dashboard-state';
import { RunDashboardPanel } from './run-dashboard-panel';

const REF: DashboardRef = {
  artifactId: 'a-1',
  version: 2,
  title: 'Penetration by client',
  action: 'updated',
  widgetCount: 11,
  filterCount: 5,
  rowCount: 418,
  saved: false,
};

function artifact(version: number, savedVersions: number[] = []): Artifact {
  return {
    id: 'a-1',
    kind: 'dashboard',
    name: 'Penetration by client',
    description: '',
    widgetCount: 11,
    filterCount: 5,
    hasImage: false,
    createdAt: '2026-11-20T10:00:00.000Z',
    updatedAt: '2026-11-22T10:00:00.000Z',
    blueprint: {},
    document: `<html><body>dashboard v${version}</body></html>`,
    version,
    status: savedVersions.length > 0 ? 'saved' : 'draft',
    savedVersions,
    versions: [1, 2].map((v) => ({
      version: v,
      createdAt: '2026-11-20T10:00:00.000Z',
      rowCount: 418,
      widgetCount: 11,
      filterCount: 5,
      saved: savedVersions.includes(v),
    })),
  };
}

describe('RunDashboardPanel', () => {
  let http: HttpTestingController;
  let state: RunDashboardState;
  let fixture: ComponentFixture<RunDashboardPanel>;
  let el: HTMLElement;

  function render(ref: DashboardRef = REF, savedVersions: number[] = []) {
    TestBed.configureTestingModule({
      imports: [RunDashboardPanel],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    state = TestBed.inject(RunDashboardState);
    fixture = TestBed.createComponent(RunDashboardPanel);
    el = fixture.nativeElement as HTMLElement;
    state.open(ref);
    http
      .expectOne((r) => r.url === `${API_BASE_URL}/artifacts/a-1`)
      .flush(artifact(ref.version, savedVersions));
    fixture.detectChanges();
  }
  const q = (id: string) =>
    el.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
  const text = (id: string) => q(id)?.textContent?.replace(/\s+/g, ' ').trim();

  afterEach(() => http.verify());

  it('is a complementary region named Dashboard', () => {
    render();
    const panel = q('run-dashboard-panel')!;
    expect(panel.getAttribute('role')).toBe('complementary');
    expect(panel.getAttribute('aria-label')).toBe('Dashboard');
  });

  it('a draft: Draft chip, meta, the draft note and Save to Artifacts only', () => {
    render();
    expect(text('run-dashboard-panel-title')).toBe('Penetration by client');
    expect(text('run-dashboard-panel-status')).toBe('Draft');
    expect(text('run-dashboard-panel-meta')).toBe(
      'Version 2 · 11 widgets · 5 filters · 418 rows',
    );
    expect(el.textContent).toContain('Live data');
    expect(text('run-dashboard-panel-note')).toBe(
      'Ask Avery for changes in the chat: this panel updates with each version. Save it when you like it; then you can download it.',
    );
    expect(text('run-dashboard-save')).toBe('Save to Artifacts');
    expect(q('run-dashboard-save')!.classList).toContain('btn-primary');
    expect(q('run-dashboard-panel-download')).toBeNull();
    expect(q('run-dashboard-panel-open')).toBeNull();
  });

  it('a saved version: the Saved chip, its note, Open in Artifacts and Download', () => {
    render({ ...REF, saved: true }, [2]);
    expect(text('run-dashboard-panel-status')).toBe('✓ Saved to Artifacts');
    expect(text('run-dashboard-panel-note')).toBe(
      'Saved as version 2. Keep asking Avery for changes: they show here as a new draft until you save again.',
    );
    expect(text('run-dashboard-panel-open')).toBe('Open in Artifacts');
    expect(text('run-dashboard-panel-download')).toBe('Download');
    expect(q('run-dashboard-panel-download')!.classList).toContain(
      'btn-primary',
    );
    expect(q('run-dashboard-save')).toBeNull();
  });

  it('draws the version’s document in a scripts-only sandbox', () => {
    render();
    const frame = q('run-dashboard-frame') as HTMLIFrameElement;
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    expect(frame.srcdoc).toContain('dashboard v2');
  });

  it('Save to Artifacts calls 164 and flips the panel to saved', () => {
    render();
    q('run-dashboard-save')!.click();
    const req = http.expectOne(`${API_BASE_URL}/artifacts/a-1/save`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ version: 2 });
    req.flush(artifact(2, [2]));
    fixture.detectChanges();
    expect(text('run-dashboard-panel-status')).toBe('✓ Saved to Artifacts');
    expect(q('run-dashboard-save')).toBeNull();
    expect(q('run-dashboard-panel-download')).not.toBeNull();
  });

  it('Download asks for the saved version’s zip (api.md 163)', () => {
    render({ ...REF, saved: true }, [2]);
    spyOn(URL, 'createObjectURL').and.returnValue('blob:x');
    spyOn(HTMLAnchorElement.prototype, 'click');
    q('run-dashboard-panel-download')!.click();
    const req = http.expectOne(
      (r) => r.url === `${API_BASE_URL}/artifacts/a-1/download`,
    );
    expect(req.request.params.get('version')).toBe('2');
    req.flush(new Blob(['zip']));
  });

  it('Full screen toggles a modal over the window; Escape and the backdrop leave it', () => {
    render();
    const button = q('run-dashboard-full-screen')!;
    expect(button.getAttribute('aria-pressed')).toBe('false');
    button.click();
    fixture.detectChanges();
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(q('run-dashboard-panel')!.dataset['fullScreen']).toBe('true');
    expect(q('run-dashboard-panel')!.classList).toContain('fixed');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(q('run-dashboard-panel')!.dataset['fullScreen']).toBeUndefined();
    button.click();
    fixture.detectChanges();
    q('run-dashboard-backdrop')!.click();
    fixture.detectChanges();
    expect(button.getAttribute('aria-pressed')).toBe('false');
  });

  it('Close closes the panel', () => {
    render();
    q('run-dashboard-close')!.click();
    fixture.detectChanges();
    expect(state.shown()).toBeNull();
    expect(q('run-dashboard-panel')).toBeNull();
  });

  it('a newer version followed from a run replaces the shown one', () => {
    render();
    state.follow({ ...REF, version: 3, rowCount: 420 });
    http
      .expectOne((r) => r.url === `${API_BASE_URL}/artifacts/a-1`)
      .flush(artifact(3));
    fixture.detectChanges();
    expect(text('run-dashboard-panel-meta')).toBe(
      'Version 3 · 11 widgets · 5 filters · 420 rows',
    );
    expect((q('run-dashboard-frame') as HTMLIFrameElement).srcdoc).toContain(
      'dashboard v3',
    );
  });
});
