import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ToastService } from '../../../../core/toast/toast.service';
import { InactiveMaker } from '../../models/admin.models';
import {
  InactiveMakersDialog,
  inactiveMakerDescription,
} from './inactive-makers-dialog';

const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

const ALAN: InactiveMaker = {
  user: { id: 'u-alan', displayName: 'Alan Turing' },
  lastActiveAt: ago(95),
  makerAssignmentId: 'ra-alan',
  makerGroups: [],
};
const FATIMA: InactiveMaker = {
  user: { id: 'u-fatima', displayName: 'Fatima Khan' },
  lastActiveAt: ago(120),
  makerAssignmentId: null,
  makerGroups: ['Data-Engineering', 'Makers'],
};
const CHEN: InactiveMaker = {
  user: { id: 'u-chen', displayName: 'Chen Wei' },
  lastActiveAt: ago(91),
  makerAssignmentId: 'ra-chen',
  makerGroups: [],
};

describe('InactiveMakersDialog', () => {
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [InactiveMakersDialog],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  function render(items: InactiveMaker[]) {
    const fixture = TestBed.createComponent(InactiveMakersDialog);
    fixture.componentRef.setInput('items', items);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const boxes = () =>
      Array.from(element.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
    const removeButton = () =>
      Array.from(element.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('Remove Maker role'),
      )!;
    return { fixture, element, boxes, removeButton };
  }

  it('describes how each user holds Maker (admin R45)', () => {
    expect(inactiveMakerDescription(ALAN)).toBe(
      'Last active 95 days ago · Direct assignment',
    );
    expect(inactiveMakerDescription(FATIMA)).toBe(
      'Last active 120 days ago · From group Data-Engineering, Makers',
    );
  });

  it('ticks direct assignments and disables group-only Maker', () => {
    const { boxes } = render([ALAN, FATIMA]);
    expect(boxes().map((b) => [b.checked, b.disabled])).toEqual([
      [true, false],
      [false, true],
    ]);
  });

  it('removes each ticked assignment in turn, then toasts and closes', () => {
    const { fixture, boxes, removeButton } = render([ALAN, FATIMA, CHEN]);
    const toast = TestBed.inject(ToastService);
    let done = false;
    fixture.componentInstance.done.subscribe(() => (done = true));

    const remove = removeButton();
    remove.click();
    fixture.detectChanges();
    expect(remove.textContent).toContain('Removing…');
    expect(remove.disabled).toBeTrue();
    http
      .expectOne({ method: 'DELETE', url: '/admin/role-assignments/ra-alan' })
      .flush({ ok: true, message: 'Role removed' });
    http
      .expectOne({ method: 'DELETE', url: '/admin/role-assignments/ra-chen' })
      .flush({ ok: true, message: 'Role removed' });

    expect(done).toBeTrue();
    expect(toast.toasts().map((t) => t.message)).toEqual([
      'Maker role removed from 2 users',
    ]);
    expect(boxes().length).toBe(3);
  });

  it('disables Remove Maker role with nothing ticked', () => {
    const { fixture, boxes, removeButton } = render([ALAN]);
    boxes()[0].click();
    fixture.detectChanges();
    expect(removeButton().disabled).toBeTrue();
  });

  it('stops at the first failure, toasts it and asks for a reload', () => {
    const { fixture, removeButton } = render([ALAN, CHEN]);
    const toast = TestBed.inject(ToastService);
    let changed = false;
    fixture.componentInstance.changed.subscribe(() => (changed = true));

    removeButton().click();
    http
      .expectOne('/admin/role-assignments/ra-alan')
      .flush(
        { message: 'Role assignment ra-alan not found' },
        { status: 404, statusText: 'Not Found' },
      );

    expect(changed).toBeTrue();
    expect(toast.toasts().map((t) => t.message)).toEqual([
      'Role assignment ra-alan not found',
    ]);
  });
});
