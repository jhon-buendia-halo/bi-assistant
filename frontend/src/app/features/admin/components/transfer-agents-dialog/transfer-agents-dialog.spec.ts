import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ToastService } from '../../../../core/toast/toast.service';
import { userRow, usersPage } from '../../testing/admin.fixtures';
import { PICKER_DEBOUNCE_MS } from '../directory-picker/directory-picker';
import { TransferAgentsDialog } from './transfer-agents-dialog';

describe('TransferAgentsDialog', () => {
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TransferAgentsDialog],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  function render() {
    const fixture = TestBed.createComponent(TransferAgentsDialog);
    fixture.componentRef.setInput('title', 'Transfer ownership');
    fixture.componentRef.setInput('intro', 'Move agents from Ada Lovelace.');
    fixture.componentRef.setInput('agents', [
      { id: 'a1', name: 'Card counter', description: 'Draft' },
      { id: 'a2', name: 'Goal analyst', description: 'Live' },
    ]);
    fixture.componentRef.setInput('exclude', ['u-ada']);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const button = (label: string) =>
      Array.from(element.querySelectorAll('button')).find(
        (b) => b.textContent?.trim() === label,
      )!;
    const boxes = () =>
      Array.from(element.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
    const picker = () => element.querySelector<HTMLInputElement>('input[role="combobox"]')!;
    return { fixture, element, button, boxes, picker };
  }

  /** Types in the New owner picker and picks Grace. */
  function pickGrace(r: ReturnType<typeof render>) {
    r.picker().value = 'Gra';
    r.picker().dispatchEvent(new Event('input'));
    tick(PICKER_DEBOUNCE_MS);
    const req = http.expectOne((q) => q.url === '/admin/users');
    expect(req.request.params.get('excludeDeactivated')).toBe('true');
    req.flush(
      usersPage([
        userRow({ id: 'u-ada', displayName: 'Ada Lovelace' }),
        userRow({ id: 'u-grace', displayName: 'Grace Hopper', email: 'grace@contoso.test' }),
      ]),
    );
    r.fixture.detectChanges();
    const options = Array.from(r.element.querySelectorAll('[role="option"]'));
    // The current owner is left out (admin R63).
    expect(options.map((o) => o.textContent?.trim())).toEqual([
      'Grace Hopper · grace@contoso.test',
    ]);
    options[0].dispatchEvent(new MouseEvent('mousedown'));
    r.fixture.detectChanges();
  }

  it('labels each agent and describes it, all ticked', () => {
    const { element, boxes } = render();
    expect(boxes().every((b) => b.checked)).toBeTrue();
    const first = boxes()[0];
    expect(element.querySelector(`label[for="${first.id}"]`)?.textContent).toBe('Card counter');
    expect(
      element.querySelector(`#${first.getAttribute('aria-describedby')}`)?.textContent?.trim(),
    ).toBe('Draft');
    const dialog = element.querySelector('[role="dialog"]')!;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
  });

  it('enables Transfer once a new owner is chosen and an agent ticked', fakeAsync(() => {
    const r = render();
    expect(r.button('Transfer').disabled).toBeTrue();
    pickGrace(r);
    expect(r.picker().value).toBe('Grace Hopper · grace@contoso.test');
    expect(r.button('Transfer').disabled).toBeFalse();

    r.boxes().forEach((b) => b.click());
    r.fixture.detectChanges();
    expect(r.button('Transfer').disabled).toBeTrue();
  }));

  it('moves the ticked agents and toasts the result (admin R64)', fakeAsync(() => {
    const r = render();
    const toast = TestBed.inject(ToastService);
    let done = false;
    r.fixture.componentInstance.done.subscribe(() => (done = true));
    pickGrace(r);
    r.boxes()[0].click();
    r.fixture.detectChanges();

    r.button('Transfer').click();
    const req = http.expectOne('/admin/agents/transfer');
    expect(req.request.body).toEqual({ agentIds: ['a2'], toUserId: 'u-grace' });
    req.flush({ ok: true, message: 'Transferred 1 agent to Grace Hopper', transferred: 1 });

    expect(done).toBeTrue();
    expect(toast.toasts().map((t) => t.message)).toEqual([
      'Transferred 1 agent to Grace Hopper',
    ]);
    flushToasts();
  }));

  it('keeps the dialog open and toasts a refusal', fakeAsync(() => {
    const r = render();
    const toast = TestBed.inject(ToastService);
    let done = false;
    r.fixture.componentInstance.done.subscribe(() => (done = true));
    pickGrace(r);
    r.button('Transfer').click();
    http
      .expectOne('/admin/agents/transfer')
      .flush(
        { message: 'Grace Hopper already has an agent named "Goal analyst"' },
        { status: 409, statusText: 'Conflict' },
      );
    r.fixture.detectChanges();

    expect(done).toBeFalse();
    expect(toast.toasts().map((t) => t.message)).toEqual([
      'Grace Hopper already has an agent named "Goal analyst"',
    ]);
    expect(r.button('Transfer').disabled).toBeFalse();
    flushToasts();
  }));

  it('closes on Escape without changes', () => {
    const { fixture, element } = render();
    let cancelled = false;
    fixture.componentInstance.cancel.subscribe(() => (cancelled = true));
    element
      .querySelector('[role="dialog"]')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(cancelled).toBeTrue();
  });

  /** Lets toast timers run out inside fakeAsync. */
  function flushToasts() {
    tick(10_000);
  }
});
