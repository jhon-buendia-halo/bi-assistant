import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  TestRequest,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { AuthService } from '../../../../core/auth/auth.service';
import { groupsPage, userRow, usersPage } from '../../testing/admin.fixtures';
import {
  AdminUsersTab,
  SEARCH_DEBOUNCE_MS,
  emptyMessage,
  roleBadges,
} from './admin-users';

const ADA = userRow();
const ALAN = userRow({
  id: 'u-alan',
  displayName: 'Alan Turing',
  email: 'alan@contoso.test',
  initials: 'AT',
  roles: [],
  groups: ['Engineers'],
  lastActiveAt: new Date(Date.now() - 95 * 86_400_000).toISOString(),
  status: 'inactive',
});
const GRACE = userRow({
  id: 'u-grace',
  displayName: 'Grace Hopper',
  email: 'grace@contoso.test',
  initials: 'GH',
  roles: [],
  groups: [],
  lastActiveAt: null,
  status: 'not-signed-in',
});

describe('AdminUsersTab', () => {
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AdminUsersTab],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  const usersRequest = (): TestRequest =>
    http.expectOne((req) => req.url === '/admin/users');

  function render() {
    const fixture = TestBed.createComponent(AdminUsersTab);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const text = () => element.textContent?.replace(/\s+/g, ' ') ?? '';
    const rows = () =>
      Array.from(element.querySelectorAll('table tbody tr')).map((tr) =>
        Array.from(tr.querySelectorAll('td')).map((td) =>
          td.textContent?.replace(/\s+/g, ' ').trim(),
        ),
      );
    const buttons = (selector = 'button') =>
      Array.from(element.querySelectorAll<HTMLButtonElement>(selector));
    const button = (label: string) =>
      buttons().find((b) => b.textContent?.trim() === label || b.getAttribute('aria-label') === label)!;
    const search = () => element.querySelector<HTMLInputElement>('input[type="search"]')!;
    return { fixture, element, text, rows, buttons, button, search };
  }

  function loaded(lastSyncAt: string | null = null) {
    const r = render();
    expect(r.text()).toContain('Loading users…');
    const req = usersRequest();
    expect(req.request.params.get('pageSize')).toBe('25');
    expect(req.request.params.has('filter')).toBeFalse();
    req.flush(
      usersPage([ADA, ALAN, GRACE], {
        counts: {
          users: 4,
          groups: 2,
          platformAdmins: 1,
          approvers: 0,
          dataOwners: 0,
          makers: 1,
          inactive: 1,
        },
        total: 4,
        lastSyncAt,
      }),
    );
    r.fixture.detectChanges();
    return r;
  }

  it('lists badges in role order, User only when no other role (admin R52)', () => {
    expect(roleBadges(userRow({ roles: ['maker', 'platform-admin'] }))).toEqual([
      { label: 'Platform admin', chip: 'chip-danger' },
      { label: 'Maker', chip: 'chip-info' },
    ]);
    expect(roleBadges(userRow({ roles: [] }))).toEqual([
      { label: 'User', chip: 'chip-neutral' },
    ]);
  });

  it('says what an empty result means (admin R57)', () => {
    expect(emptyMessage('users', 'x')).toBe('No users match your search.');
    expect(emptyMessage('users', '')).toBe('No users match this filter.');
    expect(emptyMessage('groups', 'x')).toBe('No groups match your search.');
    expect(emptyMessage('groups', '')).toBe(
      'No groups yet. Groups arrive from Entra ID through SCIM.',
    );
    expect(emptyMessage('groups', '', false)).toBe('No groups in local mode.');
    expect(emptyMessage('groups', 'x', false)).toBe('No groups match your search.');
  });

  it('shows the view switch, chips and one row per user (admin R49-R52)', () => {
    const { element, rows, buttons } = loaded();
    expect(
      buttons('[role="tab"]').map((b) => [b.textContent?.trim(), b.getAttribute('aria-selected')]),
    ).toEqual([
      ['Users · 4', 'true'],
      ['Groups · 2', 'false'],
    ]);
    expect(
      buttons('[role="group"] button').map((b) => b.textContent?.trim()),
    ).toEqual([
      'All roles',
      'Platform admins · 1',
      'Approvers · 0',
      'Data owners · 0',
      'Makers · 1',
      'Inactive 90d · 1',
    ]);
    expect(
      Array.from(element.querySelectorAll('thead th')).map((th) => th.textContent?.trim()),
    ).toEqual(['Name', 'Roles', 'IdP groups', 'Agents owned', 'Last active', 'Status']);
    expect(rows()).toEqual([
      ['AL Ada Lovelace ada@contoso.test', 'Maker', 'Analysts', '0', 'Today', 'Active'],
      ['AT Alan Turing alan@contoso.test', 'User', 'Engineers', '0', '95 days ago', 'Inactive'],
      ['GH Grace Hopper grace@contoso.test', 'User', '—', '0', 'Never', 'Not signed in'],
    ]);
    const name = element.querySelector<HTMLButtonElement>('#admin-user-u-ada')!;
    expect(
      element.querySelector(`#${name.getAttribute('aria-describedby')}`)?.textContent?.trim(),
    ).toBe('ada@contoso.test');
  });

  it('reads the last sync note (admin R54)', () => {
    const before = loaded();
    expect(before.text()).toContain(
      'Users and groups come from Entra ID via SCIM · not synced yet. Roles are assigned here or mapped from groups.',
    );
    before.fixture.destroy();

    const after = loaded(new Date(Date.now() - 2 * 3_600_000).toISOString());
    expect(after.text()).toContain(
      'Users and groups come from Entra ID via SCIM · last sync 2 hours ago. Roles are assigned here or mapped from groups.',
    );
  });

  it('reads the local-mode footer note (admin R74, ui.md 4.18.6)', () => {
    TestBed.inject(AuthService).handleUnauthorized('local');
    const { text } = loaded();
    expect(text()).toContain(
      'Users are the local personas of this machine. Roles are assigned here.',
    );
    expect(text()).not.toContain('Entra ID');
  });

  it('searches 250 ms after typing stops, from the first page (admin R50)', fakeAsync(() => {
    const { fixture, search, text } = loaded();
    search().value = '  analysts ';
    search().dispatchEvent(new Event('input'));
    tick(SEARCH_DEBOUNCE_MS - 1);
    http.expectNone((req) => req.url === '/admin/users');
    tick(1);
    const req = usersRequest();
    expect(req.request.params.get('q')).toBe('analysts');
    expect(req.request.params.get('page')).toBe('1');
    req.flush(usersPage([], { total: 0 }));
    fixture.detectChanges();
    expect(text()).toContain('No users match your search.');
  }));

  it('filters by a chip and says when nothing matches (admin R51, R57)', () => {
    const { fixture, button, text } = loaded();
    button('Approvers · 0').click();
    const req = usersRequest();
    expect(req.request.params.get('filter')).toBe('approver');
    req.flush(usersPage([], { total: 0 }));
    fixture.detectChanges();
    expect(button('Approvers · 0').getAttribute('aria-pressed')).toBe('true');
    expect(text()).toContain('No users match this filter.');
  });

  it('pages by 25 with the range and disabled ends (admin R53)', () => {
    const { fixture, button, text } = render();
    usersRequest().flush(usersPage([ADA], { total: 34 }));
    fixture.detectChanges();
    expect(text()).toContain('1–25 of 34');
    expect(button('Previous page').disabled).toBeTrue();
    expect(button('Next page').disabled).toBeFalse();

    button('Next page').click();
    const req = usersRequest();
    expect(req.request.params.get('page')).toBe('2');
    req.flush(usersPage([ALAN], { total: 34, page: 2 }));
    fixture.detectChanges();
    expect(text()).toContain('26–34 of 34');
    expect(button('Next page').disabled).toBeTrue();
    expect(button('Previous page').disabled).toBeFalse();
  });

  it('switches to the Groups view with its own search (admin R55)', () => {
    const { fixture, element, rows, buttons, search } = loaded();
    buttons('[role="tab"]')[1].click();
    fixture.detectChanges();
    const req = http.expectOne((r) => r.url === '/admin/groups');
    expect(req.request.params.get('pageSize')).toBe('25');
    req.flush(
      groupsPage([
        {
          id: 'g1',
          displayName: 'Analysts',
          members: 1,
          mappings: [
            { role: 'maker' },
            { role: 'data-owner', datasourceId: 'ds1', datasourceName: 'World Cup' },
          ],
        },
        { id: 'g2', displayName: 'Engineers', members: 1, mappings: [] },
      ]),
    );
    fixture.detectChanges();

    expect(search().getAttribute('aria-label')).toBe('Search groups');
    expect(search().placeholder).toBe('Search group name');
    expect(element.querySelector('[role="group"]')).toBeNull();
    expect(rows()).toEqual([
      ['Analysts', '1', 'MakerData owner · World Cup'],
      ['Engineers', '1', '—'],
    ]);
  });

  it('opens the user detail panel with compact columns, and closes it (admin R58)', fakeAsync(() => {
    const { fixture, element } = loaded();
    element.querySelector<HTMLButtonElement>('#admin-user-u-ada')!.click();
    fixture.detectChanges();
    http.expectOne('/admin/users/u-ada');
    http.expectOne('/datasources');

    expect(
      Array.from(element.querySelectorAll('thead th')).map((th) => th.textContent?.trim()),
    ).toEqual(['Name', 'Roles', 'Last active']);
    const row = element.querySelector('#admin-user-u-ada')!.closest('tr')!;
    expect(row.getAttribute('aria-current')).toBe('true');
    expect(element.querySelector('app-user-detail-panel')).not.toBeNull();

    fixture.componentInstance.closePanel();
    fixture.detectChanges();
    tick();
    expect(element.querySelector('app-user-detail-panel')).toBeNull();
    expect(
      Array.from(element.querySelectorAll('thead th')).map((th) => th.textContent?.trim()),
    ).toContain('Status');
    expect(document.activeElement?.id).toBe('admin-user-u-ada');
  }));

  it("shows the server's message with Retry when loading fails (admin R38)", () => {
    const { fixture, button, text } = render();
    usersRequest().flush({ message: 'Unknown filter: x' }, { status: 400, statusText: 'Bad' });
    fixture.detectChanges();
    expect(text()).toContain('Unknown filter: x');
    button('Retry').click();
    usersRequest().flush(usersPage([ADA]));
  });
});
