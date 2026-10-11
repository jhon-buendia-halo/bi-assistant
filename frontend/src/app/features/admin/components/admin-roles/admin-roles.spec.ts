import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ToastService } from '../../../../core/toast/toast.service';
import { GroupRoleMapping } from '../../models/admin.models';
import { groupsPage } from '../../testing/admin.fixtures';
import { AdminRolesTab, removeMappingQuestion } from './admin-roles';

const MAKERS: GroupRoleMapping = {
  id: 'm1',
  groupId: 'g1',
  groupName: 'Analysts',
  role: 'maker',
};
const OWNERS: GroupRoleMapping = {
  id: 'm2',
  groupId: 'g1',
  groupName: 'Analysts',
  role: 'data-owner',
  datasourceId: 'ds1',
  datasourceName: 'World Cup',
};

describe('AdminRolesTab', () => {
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AdminRolesTab],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  function render(mappings: GroupRoleMapping[], groups = 1) {
    const fixture = TestBed.createComponent(AdminRolesTab);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const text = () => element.textContent?.replace(/\s+/g, ' ') ?? '';
    expect(text()).toContain('Loading roles…');
    http.expectOne('/admin/role-mappings').flush({ mappings });
    http
      .expectOne((req) => req.url === '/admin/groups')
      .flush(groupsPage([], { total: groups }));
    fixture.detectChanges();
    const button = (label: string) =>
      Array.from(element.querySelectorAll('button')).find(
        (b) => b.textContent?.trim() === label || b.getAttribute('aria-label') === label,
      )!;
    return { fixture, element, text, button };
  }

  it('shows the read-only 11 × 5 permission matrix (admin R21, R65)', () => {
    const { element } = render([]);
    const table = element.querySelector('table')!;
    expect(table.querySelector('caption')?.textContent?.trim()).toBe('Permission matrix');
    expect(
      Array.from(table.querySelectorAll('thead th')).map((th) => th.textContent?.trim()),
    ).toEqual(['Permission', 'User', 'Maker', 'Data owner', 'Approver', 'Platform admin']);
    const rows = Array.from(table.querySelectorAll('tbody tr'));
    expect(rows.length).toBe(11);
    const granted = (name: string) => {
      const row = rows.find((tr) => tr.querySelector('th')?.textContent?.trim() === name)!;
      return Array.from(row.querySelectorAll('td')).map((td) =>
        td.querySelector('.sr-only')?.textContent === 'Granted',
      );
    };
    expect(granted('Use agents in the gallery and chat')).toEqual([true, true, true, true, true]);
    expect(granted('Approve access to a data source')).toEqual([false, false, true, false, true]);
    expect(granted('View audit log')).toEqual([false, false, false, true, true]);
    expect(granted('Manage LLM configuration')).toEqual([false, false, false, false, true]);
    expect(table.querySelectorAll('button, input, select').length).toBe(0);
  });

  it('lists the mappings with a remove button each (admin R66)', () => {
    const { element } = render([OWNERS, MAKERS]);
    const list = element.querySelector('ul[aria-label="Group mappings"]')!;
    const items = Array.from(list.querySelectorAll('li')).map((li) => [
      li.textContent?.replace(/\s+/g, ' ').trim(),
      li.querySelector('button')?.getAttribute('aria-label'),
    ]);
    expect(items).toEqual([
      ['AnalystsData owner · World Cup', 'Remove mapping Analysts → Data owner · World Cup'],
      ['AnalystsMaker', 'Remove mapping Analysts → Maker'],
    ]);
  });

  it('says when there are no mappings, and disables Add mapping without groups (admin R66, R67)', () => {
    const { text, button } = render([], 0);
    expect(text()).toContain('No group mappings yet.');
    expect(button('Add mapping').disabled).toBeTrue();
    expect(button('Add mapping').title).toBe(
      'No groups yet. Groups arrive from Entra ID through SCIM.',
    );
  });

  it('asks before removing a mapping, then toasts and reloads (admin R68)', () => {
    const { fixture, button } = render([MAKERS]);
    const toast = TestBed.inject(ToastService);
    const confirm = spyOn(window, 'confirm').and.returnValues(false, true);

    button('Remove mapping Analysts → Maker').click();
    expect(confirm).toHaveBeenCalledWith(
      'Remove the mapping “Analysts → Maker”?\n\nMembers of Analysts lose the Maker role on their next request, unless they hold it another way.',
    );
    http.expectNone('/admin/role-mappings/m1');

    button('Remove mapping Analysts → Maker').click();
    http
      .expectOne({ method: 'DELETE', url: '/admin/role-mappings/m1' })
      .flush({ ok: true, message: 'Mapping removed' });
    expect(toast.toasts().map((t) => t.message)).toEqual(['Mapping removed']);
    http.expectOne('/admin/role-mappings').flush({ mappings: [] });
    http.expectOne((req) => req.url === '/admin/groups').flush(groupsPage([], { total: 1 }));
    fixture.detectChanges();
  });

  it('names the datasource in a Data owner removal question', () => {
    expect(removeMappingQuestion(OWNERS)).toBe(
      'Remove the mapping “Analysts → Data owner · World Cup”?\n\nMembers of Analysts lose the Data owner · World Cup role on their next request, unless they hold it another way.',
    );
  });

  it('opens Add mapping and reloads the list once added (admin R67)', () => {
    const { fixture, element, button } = render([]);
    button('Add mapping').click();
    fixture.detectChanges();
    http.expectOne('/datasources').flush({ datasources: [] });
    expect(element.querySelector('[role="dialog"] h2')?.textContent?.trim()).toBe('Add mapping');

    fixture.componentInstance.onAdded();
    fixture.detectChanges();
    expect(element.querySelector('[role="dialog"]')).toBeNull();
    http.expectOne('/admin/role-mappings').flush({ mappings: [MAKERS] });
    http.expectOne((req) => req.url === '/admin/groups').flush(groupsPage([], { total: 1 }));
  });
});
