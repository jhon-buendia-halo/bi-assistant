import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ToastService } from '../../../../core/toast/toast.service';
import { groupsPage } from '../../testing/admin.fixtures';
import { PICKER_DEBOUNCE_MS } from '../directory-picker/directory-picker';
import { AddMappingDialog } from './add-mapping-dialog';

describe('AddMappingDialog', () => {
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AddMappingDialog],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  function render() {
    const fixture = TestBed.createComponent(AddMappingDialog);
    fixture.detectChanges();
    http.expectOne('/datasources').flush({ datasources: [{ id: 'ds1', name: 'World Cup' }] });
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const byLabel = <T extends HTMLElement>(label: string) => {
      const forId = Array.from(element.querySelectorAll('label')).find(
        (l) => l.textContent?.trim() === label,
      )!.htmlFor;
      return element.querySelector<T>(`#${forId}`)!;
    };
    const add = () =>
      Array.from(element.querySelectorAll('button')).find((b) =>
        ['Add', 'Adding…'].includes(b.textContent?.trim() ?? ''),
      )!;
    const choose = (label: string, value: string) => {
      const select = byLabel<HTMLSelectElement>(label);
      select.value = value;
      select.dispatchEvent(new Event('change'));
      fixture.detectChanges();
    };
    const pickAnalysts = () => {
      const picker = byLabel<HTMLInputElement>('Entra ID group');
      expect(picker.placeholder).toBe('Search group name');
      picker.value = 'ana';
      picker.dispatchEvent(new Event('input'));
      tick(PICKER_DEBOUNCE_MS);
      const req = http.expectOne((r) => r.url === '/admin/groups');
      expect(req.request.params.get('q')).toBe('ana');
      expect(req.request.params.get('pageSize')).toBe('10');
      req.flush(groupsPage([{ id: 'g1', displayName: 'Analysts', members: 1, mappings: [] }]));
      fixture.detectChanges();
      const option = element.querySelector('[role="option"]')!;
      expect(option.textContent?.trim()).toBe('Analysts');
      option.dispatchEvent(new MouseEvent('click'));
      fixture.detectChanges();
    };
    return { fixture, add, choose, pickAnalysts };
  }

  it('needs a group, a role and, for Data owner, a datasource', fakeAsync(() => {
    const r = render();
    expect(r.add().disabled).toBeTrue();
    r.pickAnalysts();
    r.choose('Role', 'data-owner');
    expect(r.add().disabled).toBeTrue();
    r.choose('Datasource', 'ds1');
    expect(r.add().disabled).toBeFalse();
  }));

  it('adds the mapping and toasts "Mapping added" on 201', fakeAsync(() => {
    const r = render();
    const toast = TestBed.inject(ToastService);
    let done = false;
    r.fixture.componentInstance.done.subscribe(() => (done = true));
    r.pickAnalysts();
    r.choose('Role', 'data-owner');
    r.choose('Datasource', 'ds1');
    r.add().click();
    const req = http.expectOne({ method: 'POST', url: '/admin/role-mappings' });
    expect(req.request.body).toEqual({ groupId: 'g1', role: 'data-owner', datasourceId: 'ds1' });
    req.flush(
      { ok: true, message: 'Mapping added', mapping: {} },
      { status: 201, statusText: 'Created' },
    );
    expect(done).toBeTrue();
    expect(toast.toasts().map((t) => [t.kind, t.message])).toEqual([['success', 'Mapping added']]);
    tick(10_000);
  }));

  it('toasts "Mapping already exists" as info on 200', fakeAsync(() => {
    const r = render();
    const toast = TestBed.inject(ToastService);
    r.pickAnalysts();
    r.choose('Role', 'maker');
    r.add().click();
    const req = http.expectOne('/admin/role-mappings');
    expect(req.request.body).toEqual({ groupId: 'g1', role: 'maker' });
    req.flush({ ok: true, message: 'Mapping already exists', mapping: {} });
    expect(toast.toasts().map((t) => [t.kind, t.message])).toEqual([
      ['info', 'Mapping already exists'],
    ]);
    tick(10_000);
  }));

  it('keeps the dialog open when the server refuses', fakeAsync(() => {
    const r = render();
    const toast = TestBed.inject(ToastService);
    let done = false;
    r.fixture.componentInstance.done.subscribe(() => (done = true));
    r.pickAnalysts();
    r.choose('Role', 'maker');
    r.add().click();
    http
      .expectOne('/admin/role-mappings')
      .flush({ message: 'Group g1 not found' }, { status: 404, statusText: 'Not Found' });
    r.fixture.detectChanges();
    expect(done).toBeFalse();
    expect(r.add().disabled).toBeFalse();
    expect(toast.toasts().map((t) => t.message)).toEqual(['Group g1 not found']);
    tick(10_000);
  }));
});
