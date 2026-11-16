import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { Dataset } from '../../services/datasets-api.service';
import { DatasetPicker } from './dataset-picker';

function ds(name: string, extra: Partial<Dataset> = {}): Dataset {
  return { name, tables: ['t1', 't2'], ...extra };
}

const FEW = [ds('World Cup'), ds('Formula 1')];
const MANY = Array.from({ length: 12 }, (_, i) =>
  ds(`Dataset ${String(i).padStart(2, '0')}`, {
    datasourceId: i % 2 ? 'pg' : 'dbx',
    datasourceKind: i % 2 ? 'postgres' : 'databricks',
    tables: i === 7 ? ['sales_orders'] : ['t'],
  }),
);

describe('DatasetPicker', () => {
  let fixture: ComponentFixture<DatasetPicker>;
  let el: HTMLElement;
  let http: HttpTestingController;
  let emitted: string[][];

  function render(datasets: Dataset[], selected: string[] = []): void {
    fixture.componentRef.setInput('datasets', datasets);
    fixture.componentRef.setInput('selected', selected);
    fixture.detectChanges();
  }

  /** Feeds every emitted pick back in, as the host does. */
  function wireHost(): void {
    fixture.componentInstance.selectedChange.subscribe((value) => {
      emitted.push(value);
      fixture.componentRef.setInput('selected', value);
    });
  }

  const q = (id: string) => el.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const all = (selector: string) => Array.from(el.querySelectorAll<HTMLElement>(selector));
  const optionNames = () =>
    all('[role="option"]').map((o) => o.querySelector('.picker-label')!.textContent!.trim());

  function openList(): void {
    q('dataset-picker-open')!.click();
    fixture.detectChanges();
    tick();
  }

  function key(name: string): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true });
    q('dataset-picker-search')!.dispatchEvent(event);
    fixture.detectChanges();
    tick();
    return event;
  }

  function type(value: string): void {
    const input = q('dataset-picker-search') as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [DatasetPicker],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(DatasetPicker);
    el = fixture.nativeElement;
    emitted = [];
    wireHost();
  });

  afterEach(() => http.verify());

  it('offers a few datasets as one-click suggestions while nothing is picked', () => {
    render(FEW);
    const suggestions = all('[data-testid="dataset-picker-suggestion"]');
    expect(suggestions.map((b) => b.textContent!.replace(/\s+/g, ' ').trim())).toEqual([
      'World Cup, 2 entities',
      'Formula 1, 2 entities',
    ]);
    suggestions[1].click();
    fixture.detectChanges();
    expect(emitted).toEqual([['Formula 1']]);
    expect(all('[data-testid="dataset-picker-suggestion"]').length).toBe(0);
    const chip = q('dataset-picker-chip')!;
    expect(chip.textContent).toContain('Formula 1');
    expect(chip.querySelector('button')!.getAttribute('aria-label')).toBe('Remove Formula 1');
  });

  it('marks a picked name no dataset has any more as missing, and removes it', () => {
    render(FEW, ['World Cup', 'Gone']);
    const chips = all('[data-testid="dataset-picker-chip"]');
    expect(chips.map((c) => c.textContent!.replace(/\s+/g, ' ').trim())).toEqual([
      'World Cup',
      'Gone (missing)',
    ]);
    expect(chips[0].classList).not.toContain('picker-chip-missing');
    expect(chips[1].classList).toContain('picker-chip-missing');
    chips[1].querySelector('button')!.click();
    fixture.detectChanges();
    expect(emitted).toEqual([['World Cup']]);
  });

  it('shows no suggestions for a large catalogue, only Add dataset', () => {
    render(MANY);
    expect(all('[data-testid="dataset-picker-suggestion"]').length).toBe(0);
    expect(q('dataset-picker-open')!.textContent!.trim()).toBe('Add dataset');
  });

  it('removes a picked dataset from its chip and keeps the focus on the field', () => {
    render(FEW, ['World Cup', 'Formula 1']);
    all('[data-testid="dataset-picker-chip"] button')[0].click();
    fixture.detectChanges();
    expect(emitted).toEqual([['Formula 1']]);
    expect(document.activeElement).toBe(q('dataset-picker-open'));
  });

  it('opens a searchable listbox focused on the search, and picks with a click', fakeAsync(() => {
    render(FEW);
    openList();
    const trigger = q('dataset-picker-open')!;
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const listbox = el.querySelector('[role="listbox"]')!;
    expect(trigger.getAttribute('aria-controls')).toBe(listbox.id);
    expect(listbox.getAttribute('aria-multiselectable')).toBe('true');
    expect(document.activeElement).toBe(q('dataset-picker-search'));
    expect(optionNames()).toEqual(['Formula 1', 'World Cup']);

    all('[role="option"]')[1].click();
    fixture.detectChanges();
    expect(emitted).toEqual([['World Cup']]);
    expect(all('[role="option"]')[1].getAttribute('aria-selected')).toBe('true');
    expect(q('dataset-picker-count')!.textContent!.trim()).toBe('1 selected · 2 datasets');
  }));

  it('moves with the arrows, toggles with Enter without submitting, and closes with Escape', fakeAsync(() => {
    render(FEW);
    openList();
    const search = q('dataset-picker-search')!;
    const options = all('[role="option"]');
    expect(search.getAttribute('aria-activedescendant')).toBe(options[0].id);
    key('ArrowDown');
    expect(search.getAttribute('aria-activedescendant')).toBe(options[1].id);
    key('ArrowDown');
    expect(search.getAttribute('aria-activedescendant')).toBe(options[1].id);
    const enter = key('Enter');
    expect(enter.defaultPrevented).toBeTrue();
    expect(emitted).toEqual([['World Cup']]);
    key('ArrowUp');
    key('Enter');
    expect(emitted[1]).toEqual(['World Cup', 'Formula 1']);

    key('Escape');
    expect(q('dataset-picker-popover')).toBeNull();
    expect(document.activeElement).toBe(q('dataset-picker-open'));
  }));

  it('groups a large catalogue by datasource and searches names and tables', fakeAsync(() => {
    render(MANY);
    openList();
    http.expectOne((r) => r.url.endsWith('/datasources')).flush({
      datasources: [
        { id: 'pg', name: 'World Cup PostgreSQL', kind: 'postgres' },
        { id: 'dbx', name: 'Finance DW', kind: 'databricks' },
      ],
    });
    fixture.detectChanges();
    expect(all('.picker-group').map((g) => g.textContent!.trim())).toEqual([
      'Databricks · Finance DW',
      'PostgreSQL · World Cup PostgreSQL',
    ]);

    type('sales');
    expect(all('.picker-group').map((g) => g.textContent!.trim())).toEqual(['Table matches']);
    expect(optionNames()).toEqual(['Dataset 07']);
    expect(el.querySelector('[role="option"] .picker-mark')!.textContent).toBe('sales');

    type('nothing like it');
    expect(q('dataset-picker-empty')!.textContent!.trim()).toBe('No datasets match “nothing like it”.');
  }));

  it('still groups by kind when the datasources cannot be read', fakeAsync(() => {
    render(MANY);
    openList();
    http
      .expectOne((r) => r.url.endsWith('/datasources'))
      .flush('down', { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();
    expect(all('.picker-group').map((g) => g.textContent!.trim())).toEqual(['Databricks', 'PostgreSQL']);
  }));

  it('clears every pick, and Done closes the list', fakeAsync(() => {
    render(FEW, ['World Cup']);
    openList();
    q('dataset-picker-clear')!.click();
    fixture.detectChanges();
    expect(emitted).toEqual([[]]);
    expect((q('dataset-picker-clear') as HTMLButtonElement).disabled).toBeTrue();
    q('dataset-picker-done')!.click();
    fixture.detectChanges();
    expect(q('dataset-picker-popover')).toBeNull();
    expect(document.activeElement).toBe(q('dataset-picker-open'));
  }));
});
