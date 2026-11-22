import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Observable, of, throwError } from 'rxjs';
import { ChatMessage } from '../../../features/sessions/models/session.model';
import {
  QUERY_EVIDENCE_API,
  QueryEvidence,
  QueryEvidenceApi,
  QueryExplanation,
  QueryRerunResult,
  StepPreview,
} from '../query-evidence.model';
import { QueryInspector } from './query-inspector';

class FakeApi implements QueryEvidenceApi {
  prepare = jasmine.createSpy('prepare').and.returnValue(of(undefined));
  explain = jasmine
    .createSpy('explain')
    .and.callFake((): Observable<void> => of(undefined));
  countStages = jasmine.createSpy('countStages').and.returnValue(of(undefined));
  previewStep = jasmine.createSpy('previewStep').and.returnValue(of(undefined));
  rerun = jasmine.createSpy('rerun');
  downloadCsv = jasmine
    .createSpy('downloadCsv')
    .and.returnValue(of(new Blob(['x'])));
  page = jasmine.createSpy('page');
  interpretFilter = jasmine.createSpy('interpretFilter');
}

const EXPLANATION = (status?: 'verified' | 'unverified'): QueryExplanation => ({
  at: '2026-11-15T10:00:00.000Z',
  steps: [
    {
      verb: 'start',
      text: 'the',
      table: 'public.products',
      unit: 'products',
      rows: 1870,
    },
    { verb: 'sort', text: 'by revenue' },
    {
      verb: 'show',
      text: 'Show the first 100',
      note: '(LIMIT 100: only the list is shortened)',
      rows: 100,
      unit: 'rows',
    },
  ],
  ...(status
    ? { stageCounts: { status, at: '2026-11-15T10:00:00.000Z' } }
    : {}),
});

function message(evidence: Partial<QueryEvidence>[] = []): ChatMessage {
  const rows = Array.from({ length: 3 }, (_, i) => ({ n: i, name: `p${i}` }));
  return {
    role: 'assistant',
    content: 'Answer',
    at: '2026-11-15T10:00:00.000Z',
    data: [
      {
        tool: 'run_readonly_sql',
        input: 'select 1',
        rowCount: 3,
        rows,
        columns: ['n', 'name'],
        rationale: 'First',
      },
      {
        tool: 'run_readonly_sql',
        input: 'select * from products order by r limit 100',
        rowCount: 100,
        columns: ['n', 'name'],
        rows,
        rationale: 'Top products by revenue',
      },
    ],
    evidence: evidence.map((e, index) => ({ index, ...e })),
  };
}

describe('QueryInspector (ui.md 4.12.2)', () => {
  let api: FakeApi;
  let fixture: ComponentFixture<QueryInspector>;

  function setup(msg: ChatMessage, index = 1): HTMLElement {
    fixture = TestBed.createComponent(QueryInspector);
    fixture.componentRef.setInput('message', msg);
    fixture.componentRef.setInput('index', index);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }
  const el = (root: HTMLElement, id: string) =>
    root.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const text = (root: HTMLElement, id: string) =>
    el(root, id)?.textContent?.replace(/\s+/g, ' ').trim();

  beforeEach(() => {
    api = new FakeApi();
    (window.document.activeElement as HTMLElement | null)?.blur();
    TestBed.configureTestingModule({
      providers: [{ provide: QUERY_EVIDENCE_API, useValue: api }],
    });
  });

  it('reads Source 2 of 2 with the rationale, the source and the tabs', () => {
    const root = setup(
      message([
        {},
        { datasourceKind: 'postgres', coverage: 'top-n', outerLimit: 100 },
      ]),
    );
    expect(text(root, 'query-inspector-position')).toBe('Source 2 of 2');
    expect(text(root, 'query-inspector-title')).toBe('Top products by revenue');
    expect(text(root, 'query-inspector-meta')).toBe('PostgreSQL · 100 rows');
    expect(root.getAttribute('role')).toBe('dialog');
    expect(root.getAttribute('aria-modal')).toBe('false');
    expect(text(root, 'query-inspector-tab-steps')).toBe('Step by step');
    expect(text(root, 'query-inspector-tab-result')).toBe('Result (100 rows)');
    expect(text(root, 'query-inspector-tab-sql')).toBe('SQL');
    expect(
      el(root, 'query-inspector-tab-steps')?.getAttribute('aria-selected'),
    ).toBe('true');
    expect(
      el(root, 'query-inspector-next')?.hasAttribute('disabled'),
    ).toBeTrue();
  });

  describe("a step's rows (ui.md 4.12.2)", () => {
    const withPreview = (preview?: StepPreview): QueryExplanation => {
      const base = EXPLANATION('verified');
      return {
        ...base,
        steps: [
          {
            ...base.steps[0],
            previewSql: 'select * from products',
            ...(preview ? { preview } : {}),
          },
          base.steps[1],
          base.steps[2],
        ],
      };
    };
    const toggles = (root: HTMLElement) =>
      Array.from(
        root.querySelectorAll<HTMLButtonElement>(
          '[data-testid="query-step-toggle"]',
        ),
      );

    it('opens a step with a statement on a click: its rows are read once, then shown with what they are', () => {
      const root = setup(message([{}, { explanation: withPreview() }]));
      // Start (a statement) and Show (the query's own rows); Sort has neither.
      expect(toggles(root).length).toBe(2);
      const start = toggles(root)[0];
      expect(start.getAttribute('aria-expanded')).toBe('false');
      start.click();
      fixture.detectChanges();
      expect(api.previewStep).toHaveBeenCalledOnceWith(1, 0);
      expect(start.getAttribute('aria-expanded')).toBe('true');

      // The host hands the answer back with the step's rows.
      fixture.componentRef.setInput(
        'message',
        message([
          {},
          {
            explanation: withPreview({
              columns: ['id', 'name'],
              rows: Array.from({ length: 10 }, (_, i) => ({
                id: i,
                name: `p${i}`,
              })),
              more: true,
              total: 1870,
              at: 't',
              check: 'matches',
            }),
          },
        ]),
      );
      fixture.detectChanges();
      const rows = el(root, 'query-step-rows')!;
      expect(rows.querySelectorAll('tbody tr').length).toBe(5);
      expect(
        Array.from(rows.querySelectorAll('th')).map((th) =>
          th.textContent?.trim(),
        ),
      ).toEqual(['id', 'name']);
      expect(text(root, 'query-step-rows-caption')).toBe(
        '1,870 products after this step · showing the first 5',
      );
      expect(el(root, 'query-step-rows-differs')).toBeNull();

      start.click();
      fixture.detectChanges();
      expect(el(root, 'query-step-rows')).toBeNull();
      expect(api.previewStep).toHaveBeenCalledTimes(1);
    });

    it("opens the Show step from the query's own rows, asking nothing", () => {
      const root = setup(message([{}, { explanation: withPreview() }]));
      toggles(root)[1].click();
      fixture.detectChanges();
      expect(api.previewStep).not.toHaveBeenCalled();
      expect(
        el(root, 'query-step-rows')!.querySelectorAll('tbody tr').length,
      ).toBe(3);
      expect(text(root, 'query-step-rows-caption')).toBe(
        '100 rows after this step · showing the first 3',
      );
    });

    it("says when the rows may not be the step's, and shows a read that failed", () => {
      const root = setup(
        message([
          {},
          {
            explanation: withPreview({
              columns: ['id'],
              rows: [{ id: 1 }],
              more: false,
              total: 1,
              at: 't',
              check: 'differs',
            }),
          },
        ]),
      );
      toggles(root)[0].click();
      fixture.detectChanges();
      expect(el(root, 'query-step-rows-differs')).not.toBeNull();

      api.previewStep.and.returnValue(
        throwError(() => ({
          error: { message: 'Step 1 could not be previewed: boom' },
        })),
      );
      const fresh = setup(message([{}, { explanation: withPreview() }]));
      toggles(fresh)[0].click();
      fixture.detectChanges();
      expect(
        el(fresh, 'query-step-rows')!.querySelector('[role="alert"]')
          ?.textContent,
      ).toContain('Step 1 could not be previewed: boom');
    });

    it('offers to explain again an explanation from before step rows, and asks for it with refresh', () => {
      const root = setup(message([{}, { explanation: EXPLANATION() }]));
      // Without statements only the Show step opens.
      expect(toggles(root).length).toBe(1);
      el(root, 'query-explain-again')!.click();
      expect(api.explain).toHaveBeenCalledWith(1, true);

      const current = setup(message([{}, { explanation: withPreview() }]));
      expect(el(current, 'query-explain-again')).toBeNull();
    });
  });

  it('shows 100 of 1,870 on the Show step only when the counts are verified', () => {
    const unverified = setup(
      message([{}, { coverage: 'top-n', explanation: EXPLANATION() }]),
    );
    const show = unverified.querySelector('[data-verb="show"]') as HTMLElement;
    expect(show.textContent).toContain('100 rows');
    expect(show.textContent).not.toContain('100 of 1,870');
    expect(show.getAttribute('data-rows')).toBe('100');
    expect(text(unverified, 'query-funnel')).toContain('1,870 products');

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: QUERY_EVIDENCE_API, useValue: api }],
    });
    const verified = setup(
      message([
        {},
        { coverage: 'top-n', explanation: EXPLANATION('verified') },
      ]),
    );
    expect(
      (verified.querySelector('[data-verb="show"]') as HTMLElement).textContent,
    ).toContain('100 of 1,870');
  });

  it('explains the query when Step by step is first shown and it has no steps', () => {
    setup(message([{}, { coverage: 'top-n' }]));
    expect(api.explain).toHaveBeenCalledOnceWith(1);
  });

  it('does not ask again when the query already has its steps', () => {
    const root = setup(message([{}, { explanation: EXPLANATION() }]));
    expect(api.explain).not.toHaveBeenCalled();
    expect(el(root, 'query-funnel')).not.toBeNull();
  });

  it('reads Reading the query… while the steps load', () => {
    api.explain.and.returnValue(new Observable<void>(() => undefined));
    const root = setup(message([{}, {}]));
    expect(root.textContent).toContain('Reading the query…');
  });

  it('shows the explain error with Try again, which asks again', () => {
    api.explain.and.returnValue(
      throwError(() => ({ error: { message: 'model down' } })),
    );
    const root = setup(message([{}, {}]));
    expect(text(root, 'query-explain-error')).toContain(
      'The steps could not be explained: model down. The SQL tab shows the query.',
    );
    api.explain.and.returnValue(of(undefined));
    el(root, 'query-explain-retry')!.click();
    expect(api.explain).toHaveBeenCalledTimes(2);
  });

  it('offers no steps for a failed query, only its error, and its SQL on the SQL tab', () => {
    const msg = message([{}, {}]);
    msg.data![1] = {
      tool: 'run_readonly_sql',
      input: 'select oops',
      error: 'syntax error',
    };
    const root = setup(msg);
    expect(api.explain).not.toHaveBeenCalled();
    expect(root.textContent).toContain('syntax error');
    expect(el(root, 'query-rerun')).toBeNull();
    expect(el(root, 'query-download-csv')).toBeNull();
    el(root, 'query-inspector-tab-sql')!.click();
    fixture.detectChanges();
    expect(text(root, 'query-sql')).toBe('select oops');
    expect(el(root, 'query-copy-sql')).not.toBeNull();
  });

  it('counts the steps on request and says when the counts could not be verified', () => {
    const counted = EXPLANATION();
    counted.steps[0].countSql = 'select count(*) from products';
    const root = setup(message([{}, { explanation: counted }]));
    el(root, 'query-count-steps')!.click();
    expect(api.countStages).toHaveBeenCalledOnceWith(1);

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: QUERY_EVIDENCE_API, useValue: api }],
    });
    const unverified = setup(
      message([{}, { explanation: EXPLANATION('unverified') }]),
    );
    expect(text(unverified, 'query-counts-unverified')).toBe(
      'The row counts could not be verified, so they are not shown.',
    );
    expect(el(unverified, 'query-count-steps')).toBeNull();
  });

  it('notes that the Result tab holds only the first rows', () => {
    const msg = message([{}, { totalRows: 1870, coverage: 'partial' }]);
    const root = setup(msg);
    el(root, 'query-inspector-tab-result')!.click();
    fixture.detectChanges();
    expect(
      el(root, 'query-result-table')!.querySelectorAll('tbody tr').length,
    ).toBe(3);
    expect(text(root, 'query-result-note')).toBe(
      'Showing the first 3 of 1,870 rows. Download all rows for the rest.',
    );
    expect(text(root, 'query-download-csv')).toBe(
      'Download all 1,870 rows (CSV)',
    );
  });

  it("shows the re-run banner, then goes back to the answer's rows", () => {
    const result: QueryRerunResult = {
      columns: ['n'],
      rows: [{ n: 9 }],
      rowCount: 98,
      coverage: 'top-n',
      ranAt: new Date(2026, 10, 15, 14, 32).toISOString(),
    };
    api.rerun.and.returnValue(of(result));
    const root = setup(
      message([{}, { coverage: 'top-n', explanation: EXPLANATION() }]),
    );
    el(root, 'query-rerun')!.click();
    fixture.detectChanges();
    expect(
      el(root, 'query-inspector-tab-result')!.getAttribute('aria-selected'),
    ).toBe('true');
    expect(text(root, 'query-rerun-banner')).toContain(
      'Re-run at 14:32: 98 rows. The answer was written from 100 rows.',
    );
    expect(
      el(root, 'query-result-table')!.querySelectorAll('tbody tr').length,
    ).toBe(1);
    Array.from(el(root, 'query-rerun-banner')!.querySelectorAll('button'))
      .find((b) => b.textContent?.includes("Show the answer's rows"))!
      .click();
    fixture.detectChanges();
    expect(el(root, 'query-rerun-banner')).toBeNull();
    expect(
      el(root, 'query-result-table')!.querySelectorAll('tbody tr').length,
    ).toBe(3);
  });

  it('copies the SQL', async () => {
    const write = jasmine.createSpy('writeText').and.resolveTo();
    spyOnProperty(window.navigator, 'clipboard', 'get').and.returnValue({
      writeText: write,
    } as unknown as Clipboard);
    const root = setup(message([{}, {}]));
    el(root, 'query-inspector-tab-sql')!.click();
    fixture.detectChanges();
    expect(text(root, 'query-sql')).toBe(
      'select * from products order by r limit 100',
    );
    el(root, 'query-copy-sql')!.click();
    expect(write).toHaveBeenCalledWith(
      'select * from products order by r limit 100',
    );
  });

  it('downloads the stored rows in the browser when they are the whole result, else asks the server', () => {
    const whole = setup(
      message([{ coverage: 'whole-table' }, { coverage: 'whole-table' }]),
      0,
    );
    const created = spyOn(URL, 'createObjectURL').and.returnValue('blob:x');
    spyOn(URL, 'revokeObjectURL');
    el(whole, 'query-download-csv')!.click();
    expect(created).toHaveBeenCalled();
    expect(api.downloadCsv).not.toHaveBeenCalled();

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: QUERY_EVIDENCE_API, useValue: api }],
    });
    const cut = setup(message([{}, { coverage: 'top-n' }]));
    el(cut, 'query-download-csv')!.click();
    expect(api.downloadCsv).toHaveBeenCalledOnceWith(1);
  });

  it('asks to close on Escape and on the close button, and focuses the close button first', async () => {
    const root = setup(message([{}, {}]));
    const closed = jasmine.createSpy('close');
    fixture.componentInstance.close.subscribe(closed);
    await fixture.whenStable();
    expect(document.activeElement).toBe(el(root, 'query-inspector-close'));
    root.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    expect(closed).toHaveBeenCalledTimes(1);
    el(root, 'query-inspector-close')!.click();
    expect(closed).toHaveBeenCalledTimes(2);
  });

  it('navigates to the previous query', () => {
    const root = setup(message([{}, {}]));
    const picked = jasmine.createSpy('navigate');
    fixture.componentInstance.navigate.subscribe(picked);
    el(root, 'query-inspector-prev')!.click();
    expect(picked).toHaveBeenCalledOnceWith(0);
  });
});
