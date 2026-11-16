import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ChatMessage } from '../../models/session.model';
import { AnswerView } from './answer-view';

/** The answer view with the query inspector on (1.25.2). */
describe('AnswerView with the query inspector', () => {
  let fixture: ComponentFixture<AnswerView>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [AnswerView] }).compileComponents();
  });

  const base: ChatMessage = {
    role: 'assistant',
    content: 'The Aero Kettle had **1,204** returns.',
    at: '2026-01-01T00:00:01.000Z',
    entities: ['db.sales.returns'],
    reasoning: [{ step: 1, tool: 'run_readonly_sql', rationale: 'Count returns' }],
    data: [
      {
        tool: 'run_readonly_sql',
        input: 'select 1',
        rationale: 'Returns per product',
        rows: [{ product: 'Aero Kettle', n: 1204 }],
        rowCount: 1,
      },
      { tool: 'run_readonly_sql', input: 'select 2', rationale: 'Dates', rows: [{ d: '2025-11-14' }], rowCount: 1 },
    ],
    evidence: [
      { index: 0, coverage: 'whole-table', tables: [{ entity: 'db.sales.returns', rows: 48912 }] },
      { index: 1, coverage: 'sample' },
    ],
  };

  function render(message: ChatMessage, inspector: boolean): HTMLElement {
    fixture = TestBed.createComponent(AnswerView);
    fixture.componentRef.setInput('message', message);
    fixture.componentRef.setInput('queryInspector', inspector);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('shows chips, the coverage line and one row per query, and hides the old blocks', () => {
    const el = render(base, true);
    const chip = el.querySelector('[data-testid="figure-ref"]');
    expect(chip?.textContent).toBe('Q1');
    expect(el.querySelector('[data-testid="query-coverage-line"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="query-row-0"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="query-row-1"]')).not.toBeNull();
    expect(el.textContent).not.toContain('Data used');
    expect(el.textContent).not.toContain('How I worked this out');
    expect(el.textContent).toContain('db.sales.returns');
  });

  it('emits inspectQuery with the record index on a chip, a row and the inspect link', () => {
    const el = render(base, true);
    const picked: number[] = [];
    fixture.componentInstance.inspectQuery.subscribe((i) => picked.push(i));
    el.querySelector<HTMLElement>('button.figure-ref')?.click();
    el.querySelector<HTMLElement>('[data-testid="query-row-1"]')?.click();
    el.querySelector<HTMLElement>('[data-testid="query-inspect-all"]')?.click();
    expect(picked).toEqual([0, 1, 0]);
  });

  it('shows rows without a coverage chip or line when the answer has no evidence', () => {
    const el = render({ ...base, evidence: undefined }, true);
    expect(el.querySelector('[data-testid="query-row-0"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="query-coverage-chip"]')).toBeNull();
    expect(el.querySelector('[data-testid="query-coverage-line"]')).toBeNull();
  });

  it('shows the summary in the clarification branch too', () => {
    const el = render(
      { ...base, clarification: { question: 'Which?', options: [{ label: 'A' }] } },
      true,
    );
    expect(el.querySelector('[data-testid="query-evidence"]')).not.toBeNull();
    expect(el.textContent).not.toContain('Data used');
  });

  it('drops a script tag and an onerror handler from the answer text', () => {
    const el = render(
      {
        ...base,
        content:
          '1,204 <script>window.__pwned = 1</script><img src="x" onerror="window.__pwned = 2"> [x](javascript:alert(1))',
      },
      true,
    );
    expect(el.querySelector('script')).toBeNull();
    expect(el.querySelector('img[onerror]')).toBeNull();
    expect(el.innerHTML).not.toContain('onerror');
    expect(el.innerHTML).not.toContain('javascript:');
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
    expect(el.querySelector('button.figure-ref')).not.toBeNull();
  });

  it('renders no chip, line or row with the mode off', () => {
    const el = render(base, false);
    expect(el.querySelector('[data-testid="figure-ref"]')).toBeNull();
    expect(el.querySelector('[data-testid="query-evidence"]')).toBeNull();
    expect(el.textContent).toContain('Data used (2 queries)');
    expect(el.textContent).toContain('How I worked this out');
  });
});
