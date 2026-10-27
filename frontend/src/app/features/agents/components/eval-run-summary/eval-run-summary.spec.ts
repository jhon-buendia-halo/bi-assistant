import { TestBed } from '@angular/core/testing';
import {
  EvalRunSummary,
  EvalSplitSummary,
} from '../../services/agents-api.service';
import { EvalRunSummaryTables } from './eval-run-summary';

const NONE: EvalSplitSummary = {
  passed: 0,
  failed: 0,
  notScored: 0,
  flaky: 0,
  total: 0,
};

const SUMMARY: EvalRunSummary = {
  passed: 1,
  failed: 1,
  notScored: 1,
  byCategory: [
    {
      category: 'lookup',
      passed: 1,
      failed: 0,
      notScored: 0,
      flaky: 0,
      total: 1,
      dev: {
        passed: 1,
        failed: 0,
        notScored: 0,
        flaky: 0,
        total: 1,
        interval: { low: 0.21, high: 1 },
      },
      heldOut: NONE,
    },
    {
      category: 'out-of-scope',
      passed: 0,
      failed: 1,
      notScored: 1,
      flaky: 1,
      total: 2,
      dev: NONE,
      heldOut: {
        passed: 0,
        failed: 1,
        notScored: 1,
        flaky: 1,
        total: 2,
        interval: { low: 0, high: 0.79 },
      },
    },
  ],
  byCriterion: [
    { criterion: 'D3', passed: 4, failed: 0, total: 4 },
    { criterion: 'G2', passed: 2, failed: 1, total: 3 },
  ],
};

async function render(summary: EvalRunSummary): Promise<HTMLElement> {
  await TestBed.configureTestingModule({
    imports: [EvalRunSummaryTables],
  }).compileComponents();
  const fixture = TestBed.createComponent(EvalRunSummaryTables);
  fixture.componentRef.setInput('summary', summary);
  fixture.componentRef.setInput('jobId', 'job-1');
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

function cells(row: Element | null): string[] {
  return [...(row?.querySelectorAll('th, td') ?? [])].map(
    (cell) => cell.textContent?.trim() ?? '',
  );
}

describe('EvalRunSummaryTables', () => {
  it('renders a table by category and one by criterion, with header cells', async () => {
    const el = await render(SUMMARY);
    const block = el.querySelector('[data-testid="eval-run-summary-job-1"]');
    expect(block).not.toBeNull();

    const tables = [...el.querySelectorAll('table')];
    expect(
      tables.map((table) =>
        table.querySelector('caption')?.textContent?.trim(),
      ),
    ).toEqual(['By category', 'By criterion']);
    expect(
      [...tables[0].querySelectorAll('thead th[scope="col"]')].map((th) =>
        th.textContent?.trim(),
      ),
    ).toEqual(['Category', 'Dev', 'Held-out', 'Flaky', 'Not scored', 'Total']);
    expect(
      [...tables[1].querySelectorAll('thead th[scope="col"]')].map((th) =>
        th.textContent?.trim(),
      ),
    ).toEqual(['Criterion', 'Passed', 'Failed', 'Total']);
  });

  it('gives each category and criterion a row of cells', async () => {
    const el = await render(SUMMARY);
    expect(
      cells(
        el.querySelector(
          '[data-testid="eval-run-summary-category-out-of-scope"]',
        ),
      ),
    ).toEqual(['out-of-scope', '—', '0/1 (0–79%)', '1', '1', '2']);
    expect(
      cells(
        el.querySelector('[data-testid="eval-run-summary-category-lookup"]'),
      ),
    ).toEqual(['lookup', '1/1 (21–100%)', '—', '0', '0', '1']);
    expect(
      cells(el.querySelector('[data-testid="eval-run-summary-criterion-G2"]')),
    ).toEqual(['G2', '2', '1', '3']);
    expect(
      el.querySelector(
        '[data-testid="eval-run-summary-category-lookup"] th[scope="row"]',
      ),
    ).not.toBeNull();
  });

  it('reads a category without split counts as dashes and no flaky', async () => {
    const el = await render({
      ...SUMMARY,
      byCategory: [
        { category: 'old', passed: 1, failed: 0, notScored: 0, total: 1 },
      ],
    });
    expect(
      cells(el.querySelector('[data-testid="eval-run-summary-category-old"]')),
    ).toEqual(['old', '—', '—', '0', '0', '1']);
  });

  it('leaves out a table with no rows', async () => {
    const el = await render({ ...SUMMARY, byCriterion: [] });
    expect(el.querySelectorAll('table').length).toBe(1);
    expect(el.querySelector('caption')?.textContent?.trim()).toBe(
      'By category',
    );
  });
});
