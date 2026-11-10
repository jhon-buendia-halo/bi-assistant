import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { PersonasApiService } from '../../services/personas-api.service';
import { UserPersona } from '../../models/persona.model';
import { PersonaList } from './persona-list';

function persona(id: string, name: string, extra: Partial<UserPersona> = {}): UserPersona {
  return {
    id,
    name,
    role: '',
    description: '',
    goals: '',
    typicalQuestions: [],
    expertise: 'intermediate',
    answerStyle: '',
    createdAt: '2026-11-09T00:00:00.000Z',
    updatedAt: '2026-11-09T00:00:00.000Z',
    ...extra,
  };
}

describe('PersonaList', () => {
  let fixture: ComponentFixture<PersonaList>;
  let api: jasmine.SpyObj<PersonasApiService>;

  async function render(list: UserPersona[] | Error): Promise<HTMLElement> {
    api = jasmine.createSpyObj<PersonasApiService>('PersonasApiService', [
      'list',
      'create',
      'update',
      'remove',
    ]);
    api.list.and.returnValue(
      list instanceof Error
        ? throwError(() => ({ status: 500, error: {} }))
        : of(list),
    );
    api.remove.and.returnValue(of(undefined));
    await TestBed.configureTestingModule({
      imports: [PersonaList],
      providers: [{ provide: PersonasApiService, useValue: api }],
    }).compileComponents();
    fixture = TestBed.createComponent(PersonaList);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('renders personas sorted by name with role and expertise chip', async () => {
    const el = await render([
      persona('b', 'Zara', { role: 'Analyst', expertise: 'expert' }),
      persona('a', 'adam', { role: 'CFO', expertise: 'novice' }),
    ]);
    expect(el.querySelector('h2')?.textContent).toContain('User personas');
    expect(el.textContent).toContain(
      'Agents will use personas as context in a later release.',
    );
    const rows = Array.from(
      el.querySelectorAll('[data-testid^="persona-row-"]'),
    );
    expect(rows.map((r) => r.getAttribute('data-testid'))).toEqual([
      'persona-row-a',
      'persona-row-b',
    ]);
    expect(rows[0].textContent).toContain('CFO');
    expect(rows[0].textContent).toContain('Novice');
    expect(rows[1].textContent).toContain('Analyst');
    expect(rows[1].textContent).toContain('Expert');
    expect(el.querySelector('[data-testid="persona-new"]')).toBeTruthy();
  });

  it('shows the empty state with a New persona button', async () => {
    const el = await render([]);
    expect(el.textContent).toContain('No personas yet');
    const buttons = Array.from(el.querySelectorAll('button')).filter((b) =>
      b.textContent?.includes('New persona'),
    );
    expect(buttons.length).toBe(2);
  });

  it('shows a load error', async () => {
    const el = await render(new Error('down'));
    expect(
      el.querySelector('[data-testid="personas-error"]')?.textContent,
    ).toContain('Could not load personas');
  });

  it('deletes a persona only after confirmation', async () => {
    const el = await render([persona('a', 'Adam')]);
    const confirm = spyOn(window, 'confirm').and.returnValue(false);
    const del = el.querySelector(
      '[data-testid="persona-delete-a"]',
    ) as HTMLButtonElement;

    del.click();
    expect(confirm).toHaveBeenCalledWith('Delete persona "Adam"?');
    expect(api.remove).not.toHaveBeenCalled();

    confirm.and.returnValue(true);
    del.click();
    fixture.detectChanges();
    expect(api.remove).toHaveBeenCalledWith('a');
    expect(el.querySelector('[data-testid="persona-row-a"]')).toBeNull();
  });

  it('opens the form from New persona and returns to the list on cancel', async () => {
    const el = await render([persona('a', 'Adam')]);
    (el.querySelector('[data-testid="persona-new"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="persona-form"]')).toBeTruthy();

    (el.querySelector('[data-testid="persona-cancel"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="persona-form"]')).toBeNull();
    expect(el.querySelector('[data-testid="persona-row-a"]')).toBeTruthy();
  });
});
