import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { PersonasApiService } from '../../services/personas-api.service';
import { UserPersona } from '../../models/persona.model';
import { PersonaForm } from './persona-form';

const SAVED: UserPersona = {
  id: 'p1',
  name: 'Finance lead',
  role: 'CFO',
  description: '',
  goals: '',
  typicalQuestions: [],
  expertise: 'intermediate',
  answerStyle: '',
  createdAt: '2026-11-09T00:00:00.000Z',
  updatedAt: '2026-11-09T00:00:00.000Z',
};

describe('PersonaForm', () => {
  let fixture: ComponentFixture<PersonaForm>;
  let component: PersonaForm;
  let el: HTMLElement;
  let api: jasmine.SpyObj<PersonasApiService>;

  beforeEach(async () => {
    api = jasmine.createSpyObj<PersonasApiService>('PersonasApiService', [
      'list',
      'create',
      'update',
      'remove',
    ]);
    api.create.and.returnValue(of(SAVED));
    api.update.and.returnValue(of(SAVED));
    await TestBed.configureTestingModule({
      imports: [PersonaForm],
      providers: [{ provide: PersonasApiService, useValue: api }],
    }).compileComponents();
    fixture = TestBed.createComponent(PersonaForm);
    component = fixture.componentInstance;
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
  });

  function saveButton(): HTMLButtonElement {
    return el.querySelector('[data-testid="persona-save"]') as HTMLButtonElement;
  }

  function type(testId: string, value: string): void {
    const field = el.querySelector(`[data-testid="${testId}"]`) as
      | HTMLInputElement
      | HTMLTextAreaElement;
    field.value = value;
    field.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  it('starts blank with Intermediate expertise, limits set and Save disabled', () => {
    expect(component.expertise()).toBe('intermediate');
    expect(
      (el.querySelector('[data-testid="persona-expertise"]') as HTMLSelectElement)
        .value,
    ).toBe('intermediate');
    expect(component.typicalQuestions()).toEqual(['']);
    expect(saveButton().disabled).toBeTrue();
    expect(
      el.querySelector('[data-testid="persona-name"]')?.getAttribute('maxlength'),
    ).toBe('80');
    expect(
      el
        .querySelector('[data-testid="persona-answer-style"]')
        ?.getAttribute('maxlength'),
    ).toBe('500');

    type('persona-name', '   ');
    expect(saveButton().disabled).toBeTrue();
    type('persona-name', 'Finance lead');
    expect(saveButton().disabled).toBeFalse();
  });

  it('adds and removes typical question rows, up to 10', () => {
    const add = el.querySelector(
      '[data-testid="persona-question-add"]',
    ) as HTMLButtonElement;
    for (let i = 0; i < 12; i++) {
      add.click();
      fixture.detectChanges();
    }
    expect(component.typicalQuestions().length).toBe(10);
    expect(add.disabled).toBeTrue();
    expect(el.querySelectorAll('[data-testid^="persona-question-remove-"]').length).toBe(10);

    type('persona-question-1', 'second');
    (
      el.querySelector('[data-testid="persona-question-remove-0"]') as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    expect(component.typicalQuestions().length).toBe(9);
    expect(component.typicalQuestions()[0]).toBe('second');
    expect(add.disabled).toBeFalse();
  });

  it('saves the trimmed payload with blank question rows dropped', () => {
    const saved = jasmine.createSpy('saved');
    component.saved.subscribe(saved);
    type('persona-name', '  Finance lead ');
    type('persona-role', 'CFO');
    type('persona-goals', 'Control spend');
    type('persona-question-0', 'What is our burn?');
    component.addQuestion();
    component.addQuestion();
    fixture.detectChanges();
    type('persona-question-2', '  Which teams overspend? ');
    const select = el.querySelector(
      '[data-testid="persona-expertise"]',
    ) as HTMLSelectElement;
    select.value = 'expert';
    select.dispatchEvent(new Event('change'));
    type('persona-answer-style', 'Short, numbers first');

    saveButton().click();

    expect(api.create).toHaveBeenCalledWith({
      name: 'Finance lead',
      role: 'CFO',
      description: '',
      goals: 'Control spend',
      typicalQuestions: ['What is our burn?', 'Which teams overspend?'],
      expertise: 'expert',
      answerStyle: 'Short, numbers first',
    });
    expect(saved).toHaveBeenCalledWith(SAVED);
  });

  it('updates an existing persona by id', () => {
    fixture.componentRef.setInput('persona', {
      ...SAVED,
      typicalQuestions: ['Q1'],
      expertise: 'novice',
    });
    fixture.detectChanges();
    expect(component.name()).toBe('Finance lead');
    expect(component.typicalQuestions()).toEqual(['Q1']);
    saveButton().click();
    expect(api.update).toHaveBeenCalledWith(
      'p1',
      jasmine.objectContaining({ typicalQuestions: ['Q1'], expertise: 'novice' }),
    );
  });

  it('shows the backend message inline when the save fails', () => {
    api.create.and.returnValue(
      throwError(() => ({
        status: 409,
        error: { message: 'A persona named "Finance lead" already exists' },
      })),
    );
    type('persona-name', 'Finance lead');
    saveButton().click();
    fixture.detectChanges();
    expect(
      el.querySelector('[data-testid="persona-error"]')?.textContent,
    ).toContain('A persona named "Finance lead" already exists');
    expect(saveButton().disabled).toBeFalse();
  });

  it('emits cancelled from Cancel', () => {
    const cancelled = jasmine.createSpy('cancelled');
    component.cancelled.subscribe(cancelled);
    (el.querySelector('[data-testid="persona-cancel"]') as HTMLButtonElement).click();
    expect(cancelled).toHaveBeenCalled();
  });
});
