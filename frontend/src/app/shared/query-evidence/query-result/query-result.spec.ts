import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Observable, Subject, of, throwError } from 'rxjs';
import {
  PageRequest,
  FilterInterpretation,
  PageResult,
  QUERY_EVIDENCE_API,
  QueryEvidenceApi,
} from '../query-evidence.model';
import { QueryResult } from './query-result';

function pageOf(patch: Partial<PageResult> = {}): PageResult {
  const page = patch.page ?? 1;
  return {
    columns: ['country', 'goals'],
    columnKinds: { country: 'text', goals: 'number' },
    rows: Array.from({ length: 50 }, (_, i) => ({
      country: `c${(page - 1) * 50 + i}`,
      goals: i,
    })),
    page,
    pageSize: 50,
    pageCount: 41,
    matchedRows: 2034,
    capped: false,
    view: { filters: [], sort: [], page, pageSize: 50 },
    ranAt: '2026-11-15T10:00:00.000Z',
    ...patch,
  };
}

class FakeApi implements QueryEvidenceApi {
  prepare = jasmine.createSpy('prepare');
  explain = jasmine.createSpy('explain');
  countStages = jasmine.createSpy('countStages');
  rerun = jasmine.createSpy('rerun');
  downloadCsv = jasmine.createSpy('downloadCsv');
  interpretFilter = jasmine.createSpy('interpretFilter');
  page = jasmine
    .createSpy('page')
    .and.callFake(
      (_index: number, request: PageRequest): Observable<PageResult> =>
        of(pageOf({ page: request.page ?? 1 })),
    );
}

describe('QueryResult (ui.md 4.12.2; agent-answers R76, R79 to R81)', () => {
  let api: FakeApi;
  let fixture: ComponentFixture<QueryResult>;
  let root: HTMLElement;

  const stored = Array.from({ length: 50 }, (_, i) => ({
    country: `s${i}`,
    goals: i,
  }));

  function setup(inputs: Record<string, unknown> = {}): void {
    fixture = TestBed.createComponent(QueryResult);
    fixture.componentRef.setInput('index', 0);
    fixture.componentRef.setInput('columns', ['country', 'goals']);
    fixture.componentRef.setInput('rows', stored);
    fixture.componentRef.setInput('total', 2034);
    for (const [key, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(key, value);
    }
    fixture.detectChanges();
    root = fixture.nativeElement as HTMLElement;
  }
  const all = (id: string) =>
    Array.from(root.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`));
  const el = (id: string) => all(id)[0] ?? null;
  const text = (id: string) => el(id)?.textContent?.replace(/\s+/g, ' ').trim();
  function click(id: string, nth = 0): void {
    all(id)[nth].click();
    fixture.detectChanges();
  }
  function type(id: string, value: string): void {
    const input = el(id) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }
  function choose(id: string, value: string): void {
    const select = el(id) as HTMLSelectElement;
    select.value = value;
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }
  function addFilter(column: string, op: string, value?: string): void {
    click('query-filter-add');
    choose('query-filter-column', column);
    choose('query-filter-op', op);
    if (value !== undefined) type('query-filter-value', value);
    click('query-filter-apply');
  }

  beforeEach(() => {
    api = new FakeApi();
    TestBed.configureTestingModule({
      providers: [{ provide: QUERY_EVIDENCE_API, useValue: api }],
    });
  });

  it('shows the stored rows and asks the server for nothing at first', () => {
    setup({ note: 'Showing the first 50 of 2,034 rows.' });
    expect(api.page).not.toHaveBeenCalled();
    expect(root.querySelectorAll('tbody tr').length).toBe(50);
    expect(text('query-result-note')).toContain('Showing the first 50');
    expect(text('query-result-page-label')).toBe('Rows 1–50 of 2,034');
  });

  it('Next requests page 2 with the current filters and sort', () => {
    setup();
    click('query-result-sort');
    addFilter('country', 'contains', 'br');
    api.page.calls.reset();
    click('query-result-next-page');
    expect(api.page).toHaveBeenCalledOnceWith(0, {
      page: 2,
      pageSize: 50,
      filters: [{ column: 'country', op: 'contains', value: 'br' }],
      sort: [{ column: 'country', direction: 'asc' }],
    });
    expect(text('query-result-page-label')).toBe('Rows 51–100 of 2,034 matching');
    click('query-result-prev-page');
    expect(api.page.calls.mostRecent().args[1].page).toBe(1);
  });

  it('labels the first page of a filtered, then a capped, result', () => {
    api.page.and.returnValue(of(pageOf({ matchedRows: 312, pageCount: 7 })));
    setup();
    addFilter('country', 'eq', 'Brazil');
    expect(text('query-result-page-label')).toBe('Rows 1–50 of 312 matching');
    api.page.and.returnValue(
      of(pageOf({ matchedRows: 50000, capped: true, pageCount: 1000 })),
    );
    click('query-filter-clear');
    expect(text('query-result-page-label')).toBe('Rows 1–50 of 50,000+');
  });

  it('cycles aria-sort ascending, descending, none and requests each', () => {
    setup();
    const th = () => root.querySelectorAll('th')[1];
    expect(th().getAttribute('aria-sort')).toBe('none');
    click('query-result-sort', 1);
    expect(th().getAttribute('aria-sort')).toBe('ascending');
    expect(api.page.calls.mostRecent().args[1].sort).toEqual([
      { column: 'goals', direction: 'asc' },
    ]);
    click('query-result-sort', 1);
    expect(th().getAttribute('aria-sort')).toBe('descending');
    expect(api.page.calls.mostRecent().args[1].sort).toEqual([
      { column: 'goals', direction: 'desc' },
    ]);
    click('query-result-sort', 1);
    expect(th().getAttribute('aria-sort')).toBe('none');
    expect(api.page.calls.mostRecent().args[1].sort).toEqual([]);
  });

  it('sorts by one column at a time', () => {
    setup();
    click('query-result-sort', 0);
    click('query-result-sort', 1);
    const ths = root.querySelectorAll('th');
    expect(ths[0].getAttribute('aria-sort')).toBe('none');
    expect(ths[1].getAttribute('aria-sort')).toBe('ascending');
  });

  it('adds a filter as a chip and removing it asks again', () => {
    setup();
    addFilter('country', 'eq', 'Brazil');
    expect(text('query-filter-chip')).toContain('country is Brazil');
    expect(
      el('query-filter-chip-remove')?.getAttribute('aria-label'),
    ).toBe('Remove filter country is Brazil');
    expect(api.page.calls.mostRecent().args[1].filters).toEqual([
      { column: 'country', op: 'eq', value: 'Brazil' },
    ]);
    api.page.calls.reset();
    click('query-filter-chip-remove');
    expect(all('query-filter-chip').length).toBe(0);
    expect(api.page).toHaveBeenCalledOnceWith(0, {
      page: 1,
      pageSize: 50,
      filters: [],
      sort: [],
    });
  });

  it('takes between, list and no-value operators', () => {
    setup();
    click('query-filter-add');
    choose('query-filter-column', 'goals');
    choose('query-filter-op', 'between');
    type('query-filter-value', '1');
    type('query-filter-value-to', '3');
    click('query-filter-apply');
    addFilter('country', 'in', 'Brazil, Chile');
    click('query-filter-add');
    choose('query-filter-column', 'country');
    choose('query-filter-op', 'is_null');
    expect(el('query-filter-value')).toBeNull();
    click('query-filter-apply');
    expect(api.page.calls.mostRecent().args[1].filters).toEqual([
      { column: 'goals', op: 'between', value: '1', valueTo: '3' },
      { column: 'country', op: 'in', values: ['Brazil', 'Chile'] },
      { column: 'country', op: 'is_null' },
    ]);
    expect(all('query-filter-chip').map((c) => c.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      'goals between 1 and 3 ×',
      'country is one of Brazil, Chile ×',
      'country is empty ×',
    ]);
  });

  it('shows the empty state when no row matches', () => {
    api.page.and.returnValue(
      of(pageOf({ rows: [], matchedRows: 0, pageCount: 0 })),
    );
    setup();
    addFilter('country', 'eq', 'Mars');
    expect(text('query-result-empty')).toBe('No rows match these filters.');
  });

  it('shows the cap note when the result is capped', () => {
    api.page.and.returnValue(of(pageOf({ capped: true, matchedRows: 50000 })));
    setup();
    click('query-result-next-page');
    expect(text('query-result-cap-note')).toBe(
      'Paging stops at 50,000 rows. Add a filter to narrow the result.',
    );
  });

  it('says it pages past the top N of a top-n query', () => {
    setup({ topN: 100 });
    expect(el('query-result-topn-note')).toBeNull();
    click('query-result-next-page');
    expect(text('query-result-topn-note')).toBe(
      'Paging the full result, not only the top 100 the answer used',
    );
  });

  it('shows an alert on failure and Retry repeats the request', () => {
    api.page.and.returnValue(throwError(() => new Error('Page 99 is past the limit')));
    setup();
    click('query-result-next-page');
    expect(el('query-page-error')?.getAttribute('role')).toBe('alert');
    expect(text('query-page-error')).toContain(
      'Could not load this page: Page 99 is past the limit',
    );
    api.page.calls.reset();
    api.page.and.returnValue(of(pageOf({ page: 2 })));
    click('query-page-retry');
    expect(api.page).toHaveBeenCalledOnceWith(0, {
      page: 2,
      pageSize: 50,
      filters: [],
      sort: [],
    });
    expect(el('query-page-error')).toBeNull();
    expect(text('query-result-page-label')).toBe('Rows 51–100 of 2,034');
  });

  it("returns to the answer's rows", () => {
    setup();
    addFilter('country', 'eq', 'Brazil');
    expect(root.querySelector('tbody td')?.textContent?.trim()).toBe('c0');
    click('query-result-show-stored');
    expect(root.querySelector('tbody td')?.textContent?.trim()).toBe('s0');
    expect(all('query-filter-chip').length).toBe(0);
    expect(el('query-result-show-stored')).toBeNull();
  });

  describe('filter in words (R82)', () => {
    const interpretation: FilterInterpretation = {
      request: {
        page: 1,
        filters: [{ column: 'country', op: 'eq', value: 'Brazil' }],
        sort: [{ column: 'goals', direction: 'desc' }],
      },
      understood: 'Country is Brazil · newest first',
    };

    it('interprets the words, then pages with the interpreted request', () => {
      api.interpretFilter.and.returnValue(of(interpretation));
      setup();
      type('query-filter-text', 'only Brazil');
      click('query-filter-text-apply');
      expect(api.interpretFilter).toHaveBeenCalledOnceWith(0, 'only Brazil', null);
      expect(api.page).toHaveBeenCalledOnceWith(0, {
        page: 1,
        pageSize: 50,
        filters: interpretation.request.filters,
        sort: interpretation.request.sort,
      });
      expect(text('query-filter-understood')).toBe(
        'Understood as: Country is Brazil · newest first',
      );
      expect(all('query-filter-chip').length).toBe(1);
      expect(el('query-filter-rejected')).toBeNull();
    });

    it('passes the current view to the next interpretation', () => {
      api.interpretFilter.and.returnValue(of(interpretation));
      setup();
      addFilter('country', 'eq', 'Peru');
      type('query-filter-text', 'and goals over 3');
      click('query-filter-text-apply');
      expect(api.interpretFilter.calls.mostRecent().args[2]?.filters).toEqual([
        { column: 'country', op: 'eq', value: 'Peru' },
      ]);
    });

    it('lists what was ignored', () => {
      api.interpretFilter.and.returnValue(
        of({ ...interpretation, rejected: ['colour', 'mood'] }),
      );
      setup();
      type('query-filter-text', 'x');
      click('query-filter-text-apply');
      expect(text('query-filter-rejected')).toContain('colour');
      expect(text('query-filter-rejected')).toContain('mood');
    });

    it('shows the server message and keeps the view when it fails', () => {
      api.interpretFilter.and.returnValue(
        throwError(() => ({ error: { message: 'No such column' } })),
      );
      setup();
      type('query-filter-text', 'x');
      click('query-filter-text-apply');
      expect(text('query-filter-text-error')).toBe(
        'Could not turn that into a filter: No such column',
      );
      expect(el('query-filter-text-error')?.getAttribute('role')).toBe('alert');
      expect(api.page).not.toHaveBeenCalled();
    });

    it('disables Apply while waiting', () => {
      const wait = new Subject<FilterInterpretation>();
      api.interpretFilter.and.returnValue(wait);
      setup();
      type('query-filter-text', 'x');
      click('query-filter-text-apply');
      expect((el('query-filter-text-apply') as HTMLButtonElement).disabled).toBeTrue();
      wait.next(interpretation);
      wait.complete();
      fixture.detectChanges();
      expect((el('query-filter-text-apply') as HTMLButtonElement).disabled).toBeFalse();
    });

    it('is not offered for a sample', () => {
      setup({ pageable: false });
      expect(el('query-filter-text')).toBeNull();
    });
  });

  it('opens on a preset view and notes it (R83)', () => {
    api.page.and.returnValue(of(pageOf({ page: 2 })));
    setup({
      view: {
        filters: [{ column: 'Country', op: 'eq', value: 'Brazil' }],
        sort: [{ column: 'Goals', direction: 'desc' }],
        page: 2,
        pageSize: 50,
      },
    });
    expect(api.page).toHaveBeenCalledOnceWith(0, {
      page: 2,
      pageSize: 50,
      filters: [{ column: 'Country', op: 'eq', value: 'Brazil' }],
      sort: [{ column: 'Goals', direction: 'desc' }],
    });
    expect(text('query-result-view-note')).toBe(
      'Page 2 of 41 · Country is Brazil · sorted by Goals, high to low',
    );
  });

  it('does not offer paging for a sample', () => {
    setup({ pageable: false });
    expect(el('query-result-pager')).toBeNull();
    expect(el('query-result-sort')).toBeNull();
    expect(el('query-filter-add')).toBeNull();
  });
});
