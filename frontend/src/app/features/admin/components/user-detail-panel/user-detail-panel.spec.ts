import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ToastService } from '../../../../core/toast/toast.service';
import { AdminUserDetail } from '../../models/admin.models';
import { userDetail } from '../../testing/admin.fixtures';
import { UserDetailPanel } from './user-detail-panel';

const WORLD_CUP = { id: 'ds1', name: 'World Cup', kind: 'postgres', summary: '', config: {} };

describe('UserDetailPanel', () => {
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UserDetailPanel],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  function render(detail: AdminUserDetail, datasources = [WORLD_CUP]) {
    const fixture = TestBed.createComponent(UserDetailPanel);
    fixture.componentRef.setInput('userId', detail.id);
    fixture.detectChanges();
    http.expectOne(`/admin/users/${detail.id}`).flush(detail);
    http.expectOne('/datasources').flush({ datasources });
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const text = () => element.textContent?.replace(/\s+/g, ' ') ?? '';
    const box = (label: string) => {
      const forId = Array.from(element.querySelectorAll('label')).find(
        (l) => l.textContent?.trim() === label,
      )?.htmlFor;
      return element.querySelector<HTMLInputElement>(`#${forId}`)!;
    };
    const description = (input: HTMLElement) =>
      element
        .querySelector(`#${input.getAttribute('aria-describedby')}`)
        ?.textContent?.replace(/\s+/g, ' ')
        .trim();
    const button = (label: string) =>
      Array.from(element.querySelectorAll('button')).find(
        (b) => b.textContent?.trim() === label || b.getAttribute('aria-label') === label,
      )!;
    return { fixture, element, text, box, description, button };
  }

  it("shows the user's header, roles, groups and agents (admin R59)", () => {
    const { element, text, box, description, button } = render(
      userDetail({
        agents: [
          { id: 'a1', name: 'Card counter', status: 'draft' },
          { id: 'a2', name: 'Goal analyst', status: 'live' },
        ],
      }),
    );
    expect(element.querySelector('section')?.getAttribute('aria-label')).toBe('User details');
    expect(element.querySelector('h3')?.textContent?.trim()).toBe('Ada Lovelace');
    expect(text()).toContain('ada@contoso.test');
    expect(text()).toContain('Active');
    expect(box('Maker').checked).toBeTrue();
    expect(box('Platform admin').checked).toBeFalse();
    expect(box('Approver').checked).toBeFalse();
    expect(description(box('Maker'))).toBe('Create, test and share agents with their team');
    expect(text()).toContain('Groups (from Entra ID, read-only) Analysts');
    const agents = Array.from(element.querySelectorAll('li.list-row')).map((li) =>
      li.textContent?.replace(/\s+/g, ' ').trim(),
    );
    expect(agents).toEqual(['Card counterDraft', 'Goal analystLive']);
    expect(button('Transfer ownership').disabled).toBeFalse();
    expect(button('Save changes').disabled).toBeTrue();
    expect(button('Save changes').title).toBe('No changes to save');
  });

  it('says when there are no groups or agents (admin R59, R63)', () => {
    const { text, button } = render(userDetail({ groupList: [], agents: [] }));
    expect(text()).toContain('No groups.');
    expect(text()).toContain('No agents owned.');
    expect(button('Transfer ownership').disabled).toBeTrue();
    expect(button('Transfer ownership').title).toBe('This user owns no agents');
  });

  it('locks roles held another way, with the reason (admin R60, R61)', () => {
    const { box, description } = render(
      userDetail({
        heldRoles: [
          { role: 'user', source: 'implicit' },
          { role: 'platform-admin', source: 'direct', assignmentId: 'ra1' },
          { role: 'approver', source: 'group', groupId: 'g1', groupNames: ['Analysts'] },
        ],
        isSelf: true,
      }),
    );
    expect([box('Approver').checked, box('Approver').disabled]).toEqual([true, true]);
    expect(description(box('Approver'))).toBe('Approve org-wide publishing From group Analysts');
    expect([box('Platform admin').checked, box('Platform admin').disabled]).toEqual([true, true]);
    expect(description(box('Platform admin'))).toBe(
      "Manage users, roles, policies and settings You can't remove your own Platform admin role.",
    );
  });

  it('adds a Data owner datasource only once one is chosen (admin R59, R62)', () => {
    const { fixture, box, button } = render(userDetail());
    const select = box('Datasource') as unknown as HTMLSelectElement;
    expect(select.disabled).toBeTrue();

    box('Data owner').click();
    fixture.detectChanges();
    expect(select.disabled).toBeFalse();
    expect(button('Save changes').disabled).toBeTrue();
    expect(button('Save changes').title).toBe('Choose a datasource for Data owner');

    select.value = 'ds1';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(button('Save changes').disabled).toBeFalse();

    button('Save changes').click();
    const put = http.expectOne({ method: 'PUT', url: '/admin/users/u-ada/roles' });
    expect(put.request.body).toEqual({
      roles: [{ role: 'maker' }, { role: 'data-owner', datasourceId: 'ds1' }],
    });
  });

  it('disables Data owner when every datasource is owned', () => {
    const { box, description } = render(
      userDetail({
        heldRoles: [
          { role: 'user', source: 'implicit' },
          { role: 'data-owner', source: 'direct', assignmentId: 'ra2', datasourceId: 'ds1', datasourceName: 'World Cup' },
        ],
      }),
    );
    expect(box('Data owner · World Cup').checked).toBeTrue();
    expect(box('Data owner · World Cup').disabled).toBeFalse();
    expect(box('Data owner').disabled).toBeTrue();
    expect(description(box('Data owner'))).toBe(
      'Approves access requests to this data source No other datasource to own.',
    );
  });

  it('lists a Data owner role whose datasource was deleted, so it can be removed', () => {
    const { fixture, box, description, button } = render(
      userDetail({
        heldRoles: [
          { role: 'user', source: 'implicit' },
          { role: 'maker', source: 'direct', assignmentId: 'ra-maker' },
          {
            role: 'data-owner',
            source: 'direct',
            assignmentId: 'ra-gone',
            datasourceId: 'ds-gone',
            datasourceName: 'ds-gone',
            datasourceMissing: true,
          },
        ],
      }),
    );
    const removed = box('Data owner · datasource removed');
    expect([removed.checked, removed.disabled]).toEqual([true, false]);
    expect(description(removed)).toBe(
      'Its datasource no longer exists, so this role grants nothing. Untick it to remove it.',
    );

    removed.click();
    fixture.detectChanges();
    button('Save changes').click();
    const put = http.expectOne('/admin/users/u-ada/roles');
    expect(put.request.body).toEqual({ roles: [{ role: 'maker' }] });
  });

  it('saves the ticked roles, toasts and reloads (admin R62)', () => {
    const { fixture, box, button } = render(userDetail());
    const toast = TestBed.inject(ToastService);
    let changed = false;
    fixture.componentInstance.changed.subscribe(() => (changed = true));

    box('Approver').click();
    box('Maker').click();
    fixture.detectChanges();
    button('Save changes').click();
    fixture.detectChanges();
    expect(button('Saving…').disabled).toBeTrue();

    const put = http.expectOne('/admin/users/u-ada/roles');
    expect(put.request.body).toEqual({ roles: [{ role: 'approver' }] });
    put.flush({ ok: true, message: 'Roles saved for Ada Lovelace', added: 1, removed: 1, heldRoles: [] });
    expect(changed).toBeTrue();
    expect(toast.toasts().map((t) => t.message)).toEqual(['Roles saved for Ada Lovelace']);
    http.expectOne('/admin/users/u-ada').flush(
      userDetail({
        heldRoles: [
          { role: 'user', source: 'implicit' },
          { role: 'approver', source: 'direct', assignmentId: 'ra9' },
        ],
      }),
    );
    fixture.detectChanges();
    expect(box('Approver').checked).toBeTrue();
    expect(box('Maker').checked).toBeFalse();
    expect(button('Save changes').disabled).toBeTrue();
  });

  it('keeps the ticks when a save is refused', () => {
    const { fixture, box, button } = render(userDetail());
    const toast = TestBed.inject(ToastService);
    box('Maker').click();
    fixture.detectChanges();
    button('Save changes').click();
    http
      .expectOne('/admin/users/u-ada/roles')
      .flush({ message: 'Datasource ds9 not found' }, { status: 404, statusText: 'Not Found' });
    fixture.detectChanges();
    expect(box('Maker').checked).toBeFalse();
    expect(button('Save changes').disabled).toBeFalse();
    expect(toast.toasts().map((t) => t.message)).toEqual(['Datasource ds9 not found']);
  });

  it('closes on Close user details and on Escape (admin R58)', () => {
    const { fixture, element, button } = render(userDetail());
    let closed = 0;
    fixture.componentInstance.close.subscribe(() => closed++);
    button('Close user details').click();
    element
      .querySelector('section')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(closed).toBe(2);
  });

  it('opens Transfer ownership with the agents and leaves the owner out (admin R63)', () => {
    const { fixture, element, button } = render(
      userDetail({ agents: [{ id: 'a2', name: 'Goal analyst', status: 'live' }] }),
    );
    button('Transfer ownership').click();
    fixture.detectChanges();
    const dialog = element.querySelector('[role="dialog"]')!;
    expect(dialog.querySelector('h2')?.textContent?.trim()).toBe('Transfer ownership');
    expect(dialog.textContent).toContain(
      'Move agents from Ada Lovelace to another user. Sessions already started from them stay with Ada Lovelace and continue with the assistant.',
    );
    const agent = dialog.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(agent.checked).toBeTrue();
  });
});
