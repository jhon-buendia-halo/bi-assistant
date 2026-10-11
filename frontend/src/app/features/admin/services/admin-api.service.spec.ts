import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { AdminApiService } from './admin-api.service';

describe('AdminApiService', () => {
  let api: AdminApiService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(AdminApiService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('reads the overview and its CSV export (api 81, 82)', () => {
    api.overview().subscribe();
    http.expectOne({ method: 'GET', url: '/admin/overview' }).flush({});

    api.exportOverview().subscribe();
    const csv = http.expectOne('/admin/overview/export');
    expect(csv.request.responseType).toBe('blob');
    csv.flush(new Blob(['section,label,value']));
  });

  it('searches, filters and pages the users (api 83)', () => {
    api.users({ q: '  ada ', filter: 'maker', page: 2, pageSize: 25 }).subscribe();
    const req = http.expectOne((r) => r.url === '/admin/users');
    expect(req.request.params.get('q')).toBe('ada');
    expect(req.request.params.get('filter')).toBe('maker');
    expect(req.request.params.get('page')).toBe('2');
    expect(req.request.params.get('pageSize')).toBe('25');
    expect(req.request.params.has('excludeDeactivated')).toBeFalse();
    req.flush({});
  });

  it('leaves out an empty search and the All roles filter', () => {
    api.users({ q: '   ', filter: 'all', excludeDeactivated: true }).subscribe();
    const req = http.expectOne((r) => r.url === '/admin/users');
    expect(req.request.params.keys()).toEqual(['excludeDeactivated']);
    expect(req.request.params.get('excludeDeactivated')).toBe('true');
    req.flush({});
  });

  it("reads a user and replaces their direct roles (api 84, 85)", () => {
    api.user('u 1').subscribe();
    http.expectOne({ method: 'GET', url: '/admin/users/u%201' }).flush({});

    api.saveRoles('u1', [{ role: 'data-owner', datasourceId: 'ds1' }]).subscribe();
    const put = http.expectOne({ method: 'PUT', url: '/admin/users/u1/roles' });
    expect(put.request.body).toEqual({
      roles: [{ role: 'data-owner', datasourceId: 'ds1' }],
    });
    put.flush({ ok: true, message: 'Roles saved for Ada' });
  });

  it('transfers agents (api 86)', () => {
    api.transferAgents(['a1', 'a2'], 'u2').subscribe();
    const req = http.expectOne({ method: 'POST', url: '/admin/agents/transfer' });
    expect(req.request.body).toEqual({ agentIds: ['a1', 'a2'], toUserId: 'u2' });
    req.flush({ ok: true, message: 'Transferred 2 agents to Grace' });
  });

  it('searches the groups and manages mappings (api 87-90)', () => {
    api.groups({ q: 'ana', pageSize: 10 }).subscribe();
    const groups = http.expectOne((r) => r.url === '/admin/groups');
    expect(groups.request.params.get('q')).toBe('ana');
    expect(groups.request.params.get('pageSize')).toBe('10');
    groups.flush({});

    api.roleMappings().subscribe();
    http.expectOne({ method: 'GET', url: '/admin/role-mappings' }).flush({});

    let status = 0;
    api
      .addRoleMapping({ groupId: 'g1', role: 'maker' })
      .subscribe((res) => (status = res.status));
    http
      .expectOne({ method: 'POST', url: '/admin/role-mappings' })
      .flush(
        { ok: true, message: 'Mapping added' },
        { status: 201, statusText: 'Created' },
      );
    expect(status).toBe(201);

    api.removeRoleMapping('m1').subscribe();
    http.expectOne({ method: 'DELETE', url: '/admin/role-mappings/m1' }).flush({});
  });

  it('assigns and removes direct roles (api 79, 80)', () => {
    let status = 0;
    api
      .assignRole({ userId: 'u1', role: 'approver' })
      .subscribe((res) => (status = res.status));
    const post = http.expectOne({ method: 'POST', url: '/admin/role-assignments' });
    expect(post.request.body).toEqual({ userId: 'u1', role: 'approver' });
    post.flush({ ok: true, message: 'Role already assigned' });
    expect(status).toBe(200);

    api.removeRoleAssignment('ra1').subscribe();
    http
      .expectOne({ method: 'DELETE', url: '/admin/role-assignments/ra1' })
      .flush({ ok: true, message: 'Role removed' });
  });
});
