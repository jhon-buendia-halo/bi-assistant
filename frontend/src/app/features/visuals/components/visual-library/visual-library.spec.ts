import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { VisualsApiService } from '../../services/visuals-api.service';
import { VisualChart } from '../../models/visual-chart.model';
import { VisualLibrary } from './visual-library';

function chart(
  id: string,
  name: string,
  category: string,
  extra: Partial<VisualChart> = {},
): VisualChart {
  return {
    id,
    name,
    category,
    previewKey: 'bar',
    rendererForm: null,
    description: '',
    whenToUse: '',
    whenToAvoid: '',
    dataShape: '',
    enabled: true,
    builtIn: true,
    createdAt: '2026-11-10T00:00:00.000Z',
    updatedAt: '2026-11-10T00:00:00.000Z',
    ...extra,
  };
}

const CHARTS: VisualChart[] = [
  chart('custom', 'Gauge', 'Custom gauges'),
  chart('pie', 'Pie chart', 'Part-to-whole', { previewKey: 'pie' }),
  chart('line', 'Line chart', 'Change over time', {
    previewKey: 'line',
    rendererForm: 'line',
    description: 'Shows a trend over time.',
  }),
  chart('col', 'column chart', 'Comparison', {
    previewKey: 'column',
    rendererForm: 'bar',
  }),
  chart('bar', 'Bar chart', 'Comparison', {
    rendererForm: 'bar',
    whenToUse: 'Ranking a few categories.',
  }),
  chart('alpha', 'Abacus', 'aardvark'),
  chart('sankey', 'Sankey diagram', 'Flow', {
    previewKey: 'sankey',
    enabled: false,
  }),
];

describe('VisualLibrary', () => {
  let fixture: ComponentFixture<VisualLibrary>;
  let api: jasmine.SpyObj<VisualsApiService>;
  let el: HTMLElement;

  async function render(list: VisualChart[] | Error): Promise<HTMLElement> {
    api = jasmine.createSpyObj<VisualsApiService>('VisualsApiService', [
      'list',
      'create',
      'update',
      'remove',
    ]);
    api.list.and.returnValue(
      list instanceof Error
        ? throwError(() => ({ status: 500, error: { message: 'down' } }))
        : of(list),
    );
    api.remove.and.returnValue(of(undefined));
    await TestBed.configureTestingModule({
      imports: [VisualLibrary],
      providers: [{ provide: VisualsApiService, useValue: api }],
    }).compileComponents();
    fixture = TestBed.createComponent(VisualLibrary);
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
    return el;
  }

  function q<T extends HTMLElement>(testId: string): T {
    return el.querySelector(`[data-testid="${testId}"]`) as T;
  }

  function headings(): string[] {
    return Array.from(el.querySelectorAll('h3 span:first-child')).map(
      (h) => h.textContent?.trim() ?? '',
    );
  }

  function cardIds(): string[] {
    return Array.from(el.querySelectorAll('[data-testid^="visual-card-"]')).map(
      (c) => c.getAttribute('data-testid')!.replace('visual-card-', ''),
    );
  }

  function search(value: string): void {
    const input = q<HTMLInputElement>('visuals-search');
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  it('groups charts by category: shipped order first, others alphabetically, names sorted', async () => {
    await render(CHARTS);
    expect(el.querySelector('h2')?.textContent).toContain('Visuals');
    expect(el.textContent).toContain(
      'Chart types for data visualization, grouped by what they show.',
    );
    expect(headings()).toEqual([
      'Comparison',
      'Change over time',
      'Part-to-whole',
      'Flow',
      'aardvark',
      'Custom gauges',
    ]);
    expect(
      q('visuals-group-Comparison').querySelector('h3')?.textContent,
    ).toContain('2');
    expect(cardIds()).toEqual([
      'bar',
      'col',
      'line',
      'pie',
      'sankey',
      'alpha',
      'custom',
    ]);
    // Chips: All + each category present, in the same order.
    const chips = Array.from(
      el.querySelectorAll('[data-testid^="visuals-category-"]'),
    ).map((c) => c.textContent?.trim());
    expect(chips).toEqual(['All', ...headings()]);
  });

  it('shows the preview, the badges and fades disabled charts', async () => {
    await render(CHARTS);
    const line = q('visual-card-line');
    expect(
      line.querySelector('[data-testid="visual-preview-line"]'),
    ).toBeTruthy();
    expect(line.textContent).toContain('Shows a trend over time.');
    expect(line.textContent).toContain('Drawn by the app');
    expect(q('visual-card-pie').textContent).not.toContain('Drawn by the app');
    const sankey = q('visual-card-sankey');
    expect(sankey.textContent).toContain('Disabled');
    expect(sankey.classList).toContain('opacity-60');
    expect(q('visual-card-pie').classList).not.toContain('opacity-60');
  });

  it('searches name, description, when to use and category', async () => {
    await render(CHARTS);
    expect(q('visuals-search').closest('label')?.textContent).toContain(
      'Search charts',
    );
    search('TREND');
    expect(cardIds()).toEqual(['line']);
    search('ranking a few');
    expect(cardIds()).toEqual(['bar']);
    search('part-to');
    expect(cardIds()).toEqual(['pie']);
    search('sankey');
    expect(cardIds()).toEqual(['sankey']);
    search('nothing like this');
    expect(cardIds()).toEqual([]);
    expect(el.textContent).toContain('No charts match your search.');
  });

  it('filters by category chip and back to All', async () => {
    await render(CHARTS);
    const chip = q<HTMLButtonElement>('visuals-category-Comparison');
    chip.click();
    fixture.detectChanges();
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    expect(headings()).toEqual(['Comparison']);
    expect(cardIds()).toEqual(['bar', 'col']);
    search('column');
    expect(cardIds()).toEqual(['col']);
    search('');
    q<HTMLButtonElement>('visuals-category-all').click();
    fixture.detectChanges();
    expect(cardIds().length).toBe(CHARTS.length);
  });

  it('opens the editor in place of the clicked card, spanning the row, and scrolls it into view', async () => {
    await render(CHARTS);
    const scroll = spyOn(Element.prototype, 'scrollIntoView');
    q('visual-card-pie').click();
    fixture.detectChanges();
    await fixture.whenStable();

    const forms = el.querySelectorAll('[data-testid="visual-chart-form"]');
    expect(forms.length).toBe(1);
    expect(q('visual-card-pie')).toBeNull();
    // It sits inside the Part-to-whole group, not at the top of the list.
    const slot = q('visual-form-slot');
    expect(q('visuals-group-Part-to-whole').contains(slot)).toBeTrue();
    expect(slot.classList).toContain('col-span-full');
    expect(
      (
        slot.querySelector(
          '[data-testid="visual-form-name"]',
        ) as HTMLInputElement
      ).value,
    ).toBe('Pie chart');
    expect(scroll).toHaveBeenCalled();
    expect(scroll.calls.mostRecent().object).toBe(forms[0]);

    // The Edit button of another card moves the one editor there.
    q<HTMLButtonElement>('visual-edit-line').click();
    fixture.detectChanges();
    expect(
      el.querySelectorAll('[data-testid="visual-chart-form"]').length,
    ).toBe(1);
    expect(q('visual-card-pie')).toBeTruthy();
    expect(
      q('visuals-group-Change over time').contains(q('visual-form-slot')),
    ).toBeTrue();

    q<HTMLButtonElement>('visual-form-cancel').click();
    fixture.detectChanges();
    expect(q('visual-chart-form')).toBeNull();
    expect(q('visual-card-line')).toBeTruthy();
  });

  it('opens an empty Add chart form at the top and reloads after save', async () => {
    await render(CHARTS);
    const created = chart('new', 'Dot plot', 'Distribution');
    api.create.and.returnValue(of(created));
    api.list.and.returnValue(of([...CHARTS, created]));

    q<HTMLButtonElement>('visuals-add').click();
    fixture.detectChanges();
    const form = q('visual-chart-form');
    expect(form).toBeTruthy();
    expect(q('visual-form-slot')).toBeNull();
    // Above the first group.
    expect(
      form.compareDocumentPosition(q('visuals-group-Comparison')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    const type = (id: string, value: string) => {
      const input = q<HTMLInputElement>(id);
      input.value = value;
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();
    };
    type('visual-form-name', 'Dot plot');
    type('visual-form-category', 'Distribution');
    q<HTMLButtonElement>('visual-form-save').click();
    fixture.detectChanges();

    expect(api.create).toHaveBeenCalledWith(
      jasmine.objectContaining({ name: 'Dot plot', category: 'Distribution' }),
    );
    expect(api.list).toHaveBeenCalledTimes(2);
    expect(q('visual-chart-form')).toBeNull();
    expect(q('visual-card-new')).toBeTruthy();
    expect(headings()).toContain('Distribution');
  });

  it('saves an edited chart with PATCH and closes the editor', async () => {
    await render(CHARTS);
    api.update.and.returnValue(of({ ...CHARTS[1], name: 'Pie' }));
    q('visual-card-pie').click();
    fixture.detectChanges();
    q<HTMLButtonElement>('visual-form-save').click();
    fixture.detectChanges();
    expect(api.update).toHaveBeenCalledWith(
      'pie',
      jasmine.objectContaining({ name: 'Pie chart', previewKey: 'pie' }),
    );
    expect(q('visual-chart-form')).toBeNull();
  });

  it('removes a chart deleted from its editor', async () => {
    await render(CHARTS);
    spyOn(window, 'confirm').and.returnValue(true);
    q('visual-card-pie').click();
    fixture.detectChanges();
    q<HTMLButtonElement>('visual-form-delete').click();
    fixture.detectChanges();
    expect(api.remove).toHaveBeenCalledWith('pie');
    expect(q('visual-card-pie')).toBeNull();
    expect(q('visual-chart-form')).toBeNull();
    expect(headings()).not.toContain('Part-to-whole');
  });

  it('shows the empty state', async () => {
    await render([]);
    expect(q('visuals-empty').textContent).toContain('No charts yet.');
    expect(q('visuals-search')).toBeNull();
  });

  it('shows a load error', async () => {
    await render(new Error('down'));
    const error = q('visuals-error');
    expect(error.getAttribute('role')).toBe('alert');
    expect(error.textContent).toContain('Could not load charts: down');
  });
});
