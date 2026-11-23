import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { API_BASE_URL } from '../../../core/config/api.config';
import { ShellState } from '../../../core/shell/shell-state';
import { Artifact } from '../../artifacts/models/artifact.model';
import { ArtifactsNavState } from '../../artifacts/services/artifacts-nav-state';
import { DashboardRef } from '../../sessions/models/session.model';
import { RunDashboardState } from './run-dashboard-state';

const DASHBOARD_REF: DashboardRef = {
  artifactId: 'a-1',
  version: 2,
  title: 'Penetration by client',
  action: 'updated',
  widgetCount: 11,
  filterCount: 5,
  rowCount: 418,
  saved: false,
};

function dashboardArtifact(
  version: number,
  savedVersions: number[] = [],
): Artifact {
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
    document: `<html><body>v${version}</body></html>`,
    version,
    status: savedVersions.length > 0 ? 'saved' : 'draft',
    savedVersions,
    versions: [1, 2, 3].map((v) => ({
      version: v,
      createdAt: '2026-11-20T10:00:00.000Z',
      rowCount: 418,
      widgetCount: 11,
      filterCount: 5,
      saved: savedVersions.includes(v),
    })),
  };
}

describe('RunDashboardState', () => {
  let state: RunDashboardState;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    state = TestBed.inject(RunDashboardState);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  const getReq = () =>
    http.expectOne((r) => r.url === `${API_BASE_URL}/artifacts/a-1`);

  it('open shows the version and loads it (api.md 145)', () => {
    state.open(DASHBOARD_REF);
    expect(state.shown()?.version).toBe(2);
    expect(state.shown()?.saved).toBeFalse();
    expect(state.loading()).toBeTrue();
    const req = getReq();
    expect(req.request.params.get('version')).toBe('2');
    req.flush(dashboardArtifact(2));
    expect(state.loading()).toBeFalse();
    expect(state.artifact()?.document).toContain('v2');
  });

  it('a version the server lists as saved shows as saved', () => {
    state.open(DASHBOARD_REF);
    getReq().flush(dashboardArtifact(2, [2]));
    expect(state.shown()?.saved).toBeTrue();
    expect(state.isSaved(DASHBOARD_REF)).toBeTrue();
    expect(state.isSaved({ ...DASHBOARD_REF, version: 3 })).toBeFalse();
  });

  it('follow opens a run answer’s dashboard once per version', () => {
    state.follow(DASHBOARD_REF);
    getReq().flush(dashboardArtifact(2));
    state.close();
    // The same version again (the run re-read): the closed panel stays closed.
    state.follow({ ...DASHBOARD_REF });
    expect(state.shown()).toBeNull();
    http.expectNone((r) => r.url === `${API_BASE_URL}/artifacts/a-1`);
    // A later run's newer version opens it again, on that version.
    state.follow({ ...DASHBOARD_REF, version: 3 });
    expect(state.shown()?.version).toBe(3);
    getReq().flush(dashboardArtifact(3));
    // No dashboard on a run: nothing changes.
    state.follow(null);
    expect(state.shown()?.version).toBe(3);
  });

  it('reset forgets what it followed', () => {
    state.follow(DASHBOARD_REF);
    getReq().flush(dashboardArtifact(2));
    state.reset();
    expect(state.shown()).toBeNull();
    state.follow(DASHBOARD_REF);
    expect(state.shown()?.version).toBe(2);
    getReq().flush(dashboardArtifact(2));
  });

  it('save publishes the shown version (api.md 164) and flips it to saved', () => {
    state.open(DASHBOARD_REF);
    getReq().flush(dashboardArtifact(2));
    state.save();
    expect(state.saving()).toBe('a-1@2');
    const req = http.expectOne(`${API_BASE_URL}/artifacts/a-1/save`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ version: 2 });
    req.flush(dashboardArtifact(2, [2]));
    expect(state.saving()).toBeNull();
    expect(state.shown()?.saved).toBeTrue();
    expect(state.isSaved({ ...DASHBOARD_REF, saved: false })).toBeTrue();
  });

  it('download asks for the zip only once the version is saved (api.md 163)', () => {
    state.open(DASHBOARD_REF);
    getReq().flush(dashboardArtifact(2));
    state.download();
    http.expectNone((r) => r.url.endsWith('/download'));
    state.save();
    http
      .expectOne(`${API_BASE_URL}/artifacts/a-1/save`)
      .flush(dashboardArtifact(2, [2]));
    spyOn(URL, 'createObjectURL').and.returnValue('blob:x');
    spyOn(HTMLAnchorElement.prototype, 'click');
    state.download();
    const req = http.expectOne(
      (r) => r.url === `${API_BASE_URL}/artifacts/a-1/download`,
    );
    expect(req.request.params.get('version')).toBe('2');
    req.flush(new Blob(['zip']));
    expect(state.downloading()).toBeNull();
  });

  it('openInArtifacts opens the artifact page at that version', () => {
    state.open({ ...DASHBOARD_REF, saved: true });
    getReq().flush(dashboardArtifact(2, [2]));
    state.openInArtifacts();
    const nav = TestBed.inject(ArtifactsNavState);
    expect(nav.activeArtifactId()).toBe('a-1');
    expect(nav.activeArtifactVersion()).toBe(2);
    expect(TestBed.inject(ShellState).mainView()).toBe('artifact-detail');
  });

  it('a late answer for a version no longer shown is ignored', () => {
    state.open(DASHBOARD_REF);
    const first = getReq();
    state.open({ ...DASHBOARD_REF, version: 3 });
    const second = http.match((r) => r.url === `${API_BASE_URL}/artifacts/a-1`);
    first.flush(dashboardArtifact(2));
    expect(state.artifact()).toBeNull();
    second[0].flush(dashboardArtifact(3));
    expect(state.artifact()?.version).toBe(3);
  });
});
