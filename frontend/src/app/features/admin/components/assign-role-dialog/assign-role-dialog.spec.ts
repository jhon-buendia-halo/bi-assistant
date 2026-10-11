import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ToastService } from '../../../../core/toast/toast.service';
import { userRow, usersPage } from '../../testing/admin.fixtures';
import { PICKER_DEBOUNCE_MS } from '../directory-picker/directory-picker';
import { AssignRoleDialog } from './assign-role-dialog';

describe('AssignRoleDialog', () => {
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AssignRoleDialog],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  function render(datasources = [{ id: 'ds1', name: 'World Cup' }]) {
    const fixture = TestBed.createComponent(AssignRoleDialog);
    fixture.detectChanges();
    http.expectOne('/datasources').flush({ datasources });
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const byLabel = <T extends HTMLElement>(label: string) => {
      const forId = Array.from(element.querySelectorAll('label')).find(
        (l) => l.textContent?.trim() === label,
      )!.htmlFor;
      return element.querySelector<T>(`#${forId}`)!;
    };
    const assign = () =>
      Array.from(element.querySelectorAll('button')).find((b) =>
        ['Assign', 'Assigning…'].includes(b.textContent?.trim() ?? ''),
      )!;
    const choose = (label: string, value: string) => {
      const select = byLabel<HTMLSelectElement>(label);
      select.value = value;
      select.dispatchEvent(new Event('change'));
      fixture.detectChanges();
    };
    return { fixture, element, byLabel, assign, choose };
  }

  function pickGrace(r: ReturnType<typeof render>) {
    const picker = r.byLabel<HTMLInputElement>('User');
    expect(picker.getAttribute('role')).toBe('combobox');
    picker.value = 'grace';
    picker.dispatchEvent(new Event('input'));
    tick(PICKER_DEBOUNCE_MS);
    http
      .expectOne((req) => req.url === '/admin/users')
      .flush(usersPage([userRow({ id: 'u-grace', displayName: 'Grace Hopper', email: 'grace@contoso.test' })]));
    r.fixture.detectChanges();
    r.element.querySelector('[role="option"]')!.dispatchEvent(new MouseEvent('mousedown'));
    r.fixture.detectChanges();
  }

  it('offers the four assignable roles; Datasource only for Data owner (admin R56)', () => {
    const { byLabel, choose, element } = render();
    const role = byLabel<HTMLSelectElement>('Role');
    expect(Array.from(role.options).map((o) => o.text.trim())).toEqual([
      'Choose a role',
      'Maker',
      'Data owner',
      'Approver',
      'Platform admin',
    ]);
    const datasource = byLabel<HTMLSelectElement>('Datasource');
    expect(datasource.disabled).toBeTrue();
    expect(
      element.querySelector(`#${datasource.getAttribute('aria-describedby')}`)?.textContent?.trim(),
    ).toBe('Only for Data owner.');
    choose('Role', 'data-owner');
    expect(datasource.disabled).toBeFalse();
    expect(Array.from(datasource.options).map((o) => o.text.trim())).toEqual([
      'Choose a datasource',
      'World Cup',
    ]);
  });

  it('reads "No datasources" when there are none', () => {
    const { byLabel, choose } = render([]);
    choose('Role', 'data-owner');
    const datasource = byLabel<HTMLSelectElement>('Datasource');
    expect(datasource.disabled).toBeTrue();
    expect(datasource.options[0].text.trim()).toBe('No datasources');
  });

  it('needs a user, a role and, for Data owner, a datasource', fakeAsync(() => {
    const r = render();
    expect(r.assign().disabled).toBeTrue();
    pickGrace(r);
    expect(r.assign().disabled).toBeTrue();
    r.choose('Role', 'data-owner');
    expect(r.assign().disabled).toBeTrue();
    r.choose('Datasource', 'ds1');
    expect(r.assign().disabled).toBeFalse();
    r.choose('Role', 'approver');
    expect(r.assign().disabled).toBeFalse();
  }));

  it('assigns and toasts "Role assigned" on 201', fakeAsync(() => {
    const r = render();
    const toast = TestBed.inject(ToastService);
    let done = false;
    r.fixture.componentInstance.done.subscribe(() => (done = true));
    pickGrace(r);
    r.choose('Role', 'data-owner');
    r.choose('Datasource', 'ds1');

    r.assign().click();
    r.fixture.detectChanges();
    expect(r.assign().textContent?.trim()).toBe('Assigning…');
    const req = http.expectOne('/admin/role-assignments');
    expect(req.request.body).toEqual({
      userId: 'u-grace',
      role: 'data-owner',
      datasourceId: 'ds1',
    });
    req.flush(
      { ok: true, message: 'Role assigned', assignment: { id: 'ra1' } },
      { status: 201, statusText: 'Created' },
    );
    expect(done).toBeTrue();
    expect(toast.toasts().map((t) => [t.kind, t.message])).toEqual([
      ['success', 'Role assigned'],
    ]);
    tick(10_000);
  }));

  it('toasts "Role already assigned" as info on 200, without a datasource for other roles', fakeAsync(() => {
    const r = render();
    const toast = TestBed.inject(ToastService);
    pickGrace(r);
    r.choose('Role', 'approver');
    r.assign().click();
    const req = http.expectOne('/admin/role-assignments');
    expect(req.request.body).toEqual({ userId: 'u-grace', role: 'approver' });
    req.flush({ ok: true, message: 'Role already assigned', assignment: { id: 'ra1' } });
    expect(toast.toasts().map((t) => [t.kind, t.message])).toEqual([
      ['info', 'Role already assigned'],
    ]);
    tick(10_000);
  }));
});
