import { TestBed } from '@angular/core/testing';
import { TablePanelItem } from '../../models/session.model';
import { PanelTableView, compareCells } from './panel-table-view';

const table = (over: Partial<TablePanelItem> = {}): TablePanelItem => ({
  id: 't1',
  kind: 'table',
  title: 'Goals',
  shownAt: '2026-10-14T10:00:00Z',
  tool: 'run_readonly_sql',
  input: 'select team, goals from t',
  columns: ['team', 'goals'],
  rows: [
    { team: 'Brazil', goals: 10 },
    { team: 'Chile', goals: 9 },
    { team: 'Peru', goals: 100 },
  ],
  rowCount: 3,
  ...over,
});

describe('PanelTableView', () => {
  function create(item: TablePanelItem) {
    const fixture = TestBed.createComponent(PanelTableView);
    fixture.componentRef.setInput('item', item);
    fixture.detectChanges();
    return fixture;
  }
  const firstCells = (el: HTMLElement) =>
    [...el.querySelectorAll('tbody tr')].map(
      (tr) => tr.querySelector('td')?.textContent?.trim(),
    );

  it('sorts numerically and toggles with aria-sort', () => {
    const fixture = create(table());
    const el: HTMLElement = fixture.nativeElement;
    const goals = () =>
      el.querySelectorAll('th')[1] as HTMLElement;
    (goals().querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(goals().getAttribute('aria-sort')).toBe('ascending');
    expect(firstCells(el)).toEqual(['Chile', 'Brazil', 'Peru']);
    (goals().querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(goals().getAttribute('aria-sort')).toBe('descending');
    expect(firstCells(el)).toEqual(['Peru', 'Brazil', 'Chile']);
  });

  it('shows the row count, the truncation note and a collapsible query', () => {
    const fixture = create(table({ rowCount: 500, truncated: true }));
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('500 rows');
    expect(el.textContent).toContain('(first 200 shown)');
    expect(el.querySelector('pre')).toBeNull();
    const toggle = [...el.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Query'),
    ) as HTMLButtonElement;
    toggle.click();
    fixture.detectChanges();
    expect(el.querySelector('pre')?.textContent).toContain('select team');
  });

  it('orders empty cells last', () => {
    expect(compareCells(null, 1)).toBeGreaterThan(0);
    expect(compareCells('b', 'a')).toBeGreaterThan(0);
  });
});
