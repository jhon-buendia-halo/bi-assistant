import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { userRow, usersPage } from '../../testing/admin.fixtures';
import { DirectoryPicker, PICKER_DEBOUNCE_MS, PickerOption } from './directory-picker';

describe('DirectoryPicker', () => {
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DirectoryPicker],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  function render() {
    const fixture = TestBed.createComponent(DirectoryPicker);
    fixture.componentRef.setInput('label', 'User');
    fixture.componentRef.setInput('kind', 'user');
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const input = element.querySelector<HTMLInputElement>('input')!;
    const picks: (PickerOption | null)[] = [];
    fixture.componentInstance.picked.subscribe((p) => picks.push(p));
    const key = (k: string) => {
      const event = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
      input.dispatchEvent(event);
      fixture.detectChanges();
      return event;
    };
    const type = (value: string, items = [
      userRow({ id: 'u1', displayName: 'Grace Hopper', email: 'grace@contoso.test' }),
      userRow({ id: 'u2', displayName: 'Grace Kelly', email: null }),
    ]) => {
      input.value = value;
      input.dispatchEvent(new Event('input'));
      tick(PICKER_DEBOUNCE_MS);
      http.expectOne((req) => req.url === '/admin/users').flush(usersPage(items));
      fixture.detectChanges();
    };
    const list = () => element.querySelector<HTMLElement>('[role="listbox"]')!;
    return { fixture, element, input, picks, key, type, list };
  }

  it('is a labelled combobox controlling its listbox', () => {
    const { element, input, list } = render();
    expect(element.querySelector(`label[for="${input.id}"]`)?.textContent).toBe('User');
    expect(input.getAttribute('role')).toBe('combobox');
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(input.getAttribute('aria-controls')).toBe(list().id);
    expect(list().hidden).toBeTrue();
  });

  it('lists matches and picks with the arrow keys and Enter', fakeAsync(() => {
    const { input, picks, key, type, list } = render();
    type('grace');
    expect(input.getAttribute('aria-expanded')).toBe('true');
    expect(
      Array.from(list().querySelectorAll('[role="option"]')).map((o) => o.textContent?.trim()),
    ).toEqual(['Grace Hopper · grace@contoso.test', 'Grace Kelly']);

    key('ArrowDown');
    expect(input.getAttribute('aria-activedescendant')).toBe(`${list().id}-1`);
    key('Enter');
    expect(picks.map((p) => p?.id)).toEqual(['u2']);
    expect(input.value).toBe('Grace Kelly');
    expect(list().hidden).toBeTrue();
  }));

  it('closes the list on Escape without letting the dialog close', fakeAsync(() => {
    const { key, type, list } = render();
    type('grace');
    const escape = key('Escape');
    expect(list().hidden).toBeTrue();
    expect(escape.defaultPrevented).toBeTrue();
    // A second Escape, with the list closed, is left to the dialog.
    expect(key('Escape').defaultPrevented).toBeFalse();
  }));

  it('clears the pick when the text changes, and says when nothing matches', fakeAsync(() => {
    const { element, picks, type, list } = render();
    type('grace');
    list().querySelector<HTMLElement>('[role="option"]')!.click();
    expect(picks.map((p) => p?.id)).toEqual(['u1']);

    type('nobody', []);
    expect(picks).toEqual([jasmine.objectContaining({ id: 'u1' }), null]);
    expect(element.textContent).toContain('No matches.');
  }));
});
