import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { API_BASE_URL } from '../../../../core/config/api.config';
import { ToastService } from '../../../../core/toast/toast.service';
import {
  Confidence,
  ReasoningTrace,
} from '../../models/expert-trace.model';
import { SessionActionResult } from '../../models/session.model';
import {
  ExpertTrace,
  confidenceText,
  locateClause,
  sqlSegments,
} from './expert-trace';

const SQL = `SELECT ROUND(AVG(s.annual_base_amount * fx.rate_to_usd), 2) AS avg_salary_usd
FROM world_cup.hr.salary_history s
JOIN world_cup.hr.employees e ON e.id = s.employee_id
JOIN world_cup.hr.departments d ON d.id = e.department_id
JOIN world_cup.hr.exchange_rates fx ON fx.currency = s.currency AND fx.year = 2025
WHERE d.division = 'Technology'
  AND e.employment_type = 'employee'
  AND s.effective_from <= DATE '2025-12-31'
  AND (s.effective_to IS NULL OR s.effective_to > DATE '2025-12-31')`;

function confidence(score: number, band: Confidence['band']): Confidence {
  return {
    score,
    band,
    signals: [
      {
        id: 'execution',
        label: 'Query ran cleanly',
        value: 1,
        weight: 0.25,
        note: '1 row, no repair, no warnings',
      },
      {
        id: 'self_report',
        label: "Model's own estimate",
        value: 0.9,
        weight: 0.1,
        note: 'verbalized confidence',
      },
    ],
  };
}

/**
 * Handcrafted trace for "What is the average salary of tech employees in
 * 2025?" on the HR fixture — every block, every basis family, a join the
 * schema does not declare and a rejected table.
 */
export const SAMPLE_TRACE: ReasoningTrace = {
  id: '6f1c2d4e-0000-4000-8000-000000000001',
  version: 1,
  generatedAt: '2026-09-29T12:00:00.000Z',
  model: 'openai/gpt-5',
  overall: confidence(0.86, 'high'),
  blocks: [
    // Stored out of order on purpose: the component renders contract order.
    {
      kind: 'sql',
      sql: SQL,
      rowCount: 1,
      annotations: [
        {
          clause: "WHERE d.division = 'Technology'",
          explanation: 'Tech employees are the Technology division.',
          assumptionIds: ['a1'],
        },
        {
          clause: "s.effective_from <= DATE '2025-12-31'   AND (s.effective_to IS NULL OR s.effective_to > DATE '2025-12-31')",
          explanation: 'The salary for 2025 is the row in effect on 31 December.',
          assumptionIds: ['a2'],
        },
        {
          clause: 'fx.rate_to_usd',
          explanation: 'Converted to USD with the same-year rate.',
          assumptionIds: [],
        },
      ],
      confidence: confidence(0.91, 'high'),
    },
    {
      kind: 'interpretation',
      restatement:
        'Average annual base salary in USD of Technology-division employees, as of 31 December 2025.',
      terms: [
        {
          term: 'tech employees',
          mappedTo: 'employees in the Technology division',
          basis: 'knowledge',
          sourceRef: 'Tech employees',
        },
        {
          term: 'salary',
          mappedTo: 'annual base pay, bonuses excluded',
          basis: 'knowledge',
          sourceRef: 'Salary',
        },
        {
          term: 'in 2025',
          mappedTo: 'the salary row in effect on 2025-12-31',
          basis: 'convention',
        },
      ],
      ambiguities: ['Tech by job family (Engineering, Data, IT) instead of division'],
      confidence: confidence(0.82, 'high'),
    },
    {
      kind: 'data-selection',
      tables: [
        {
          entity: 'world_cup.hr.salary_history',
          role: 'fact',
          reason: 'Annual base pay per employee over time.',
          columnsUsed: ['employee_id', 'annual_base_amount', 'currency'],
        },
        {
          entity: 'world_cup.hr.employees',
          role: 'dimension',
          reason: 'Employment type and department.',
          columnsUsed: ['id', 'department_id', 'employment_type'],
        },
        {
          entity: 'world_cup.hr.departments',
          role: 'dimension',
          reason: 'The division that defines tech.',
          columnsUsed: ['id', 'division'],
        },
        {
          entity: 'world_cup.hr.exchange_rates',
          role: 'lookup',
          reason: 'Same-year conversion to USD.',
          columnsUsed: ['currency', 'year', 'rate_to_usd'],
        },
      ],
      joins: [
        {
          from: 'world_cup.hr.salary_history',
          fromColumn: 'employee_id',
          to: 'world_cup.hr.employees',
          toColumn: 'id',
          basis: 'schema',
        },
        {
          from: 'world_cup.hr.employees',
          fromColumn: 'department_id',
          to: 'world_cup.hr.departments',
          toColumn: 'id',
          basis: 'schema',
        },
        {
          from: 'world_cup.hr.salary_history',
          fromColumn: 'currency',
          to: 'world_cup.hr.exchange_rates',
          toColumn: 'currency',
          basis: 'convention',
        },
      ],
      rejected: [
        {
          entity: 'world_cup.hr.job_titles',
          reason: 'Job family does not define tech.',
        },
      ],
      confidence: confidence(0.74, 'medium'),
    },
    {
      kind: 'assumptions',
      items: [
        {
          id: 'a1',
          statement: 'Only permanent employees count; contractors and interns are excluded.',
          sqlFragment: "e.employment_type = 'employee'",
          basis: 'knowledge',
          sourceRef: 'Employees only',
          alternative: 'Including contractors and interns lowers the average.',
        },
        {
          id: 'a2',
          statement: 'People who left during 2025 are still counted if a salary row covers 31 December.',
          basis: 'assumption',
          alternative: 'Restricting to employees active on 31 December changes the population.',
        },
      ],
      confidence: confidence(0.5, 'low'),
    },
    {
      kind: 'metric',
      name: 'Average base salary (USD)',
      formula: 'AVG(annual_base_amount * rate_to_usd)',
      grain: 'one salary row per employee, in effect on 2025-12-31',
      basis: 'metric',
      sourceRef: 'avg_base_salary_usd',
      confidence: confidence(0.88, 'high'),
    },
  ],
  feedback: {
    metric: { vote: 'up', comment: 'Matches the finance definition.', at: '2026-09-29T12:05:00.000Z' },
  },
};

const MESSAGE_AT = '2026-09-29T12:00:00.000Z';

describe('expert trace helpers', () => {
  it('formats a confidence badge as band and percent', () => {
    expect(confidenceText({ score: 0.857, band: 'high', signals: [] })).toBe(
      'High · 86%',
    );
    expect(confidenceText({ score: 0.5, band: 'low', signals: [] })).toBe(
      'Low · 50%',
    );
  });

  it('finds a clause regardless of whitespace and case', () => {
    const range = locateClause(
      SQL,
      "s.effective_from <= date '2025-12-31' AND (s.effective_to IS NULL",
    )!;
    expect(range).toBeTruthy();
    expect(SQL.slice(range.start, range.end)).toContain('\n  AND (s.effective_to');
    expect(locateClause(SQL, 'GROUP BY 1')).toBeNull();
    expect(locateClause(SQL, '   ')).toBeNull();
  });

  it('splits the SQL around the highlighted range', () => {
    expect(sqlSegments('abc', null)).toEqual([{ text: 'abc', highlight: false }]);
    expect(sqlSegments('select x from t', { start: 7, end: 8 })).toEqual([
      { text: 'select ', highlight: false },
      { text: 'x', highlight: true },
      { text: ' from t', highlight: false },
    ]);
  });
});

describe('ExpertTrace', () => {
  let fixture: ComponentFixture<ExpertTrace>;
  let http: HttpTestingController;
  let el: HTMLElement;
  let saved: SessionActionResult[];

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ExpertTrace],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ExpertTrace);
    fixture.componentRef.setInput('trace', SAMPLE_TRACE);
    fixture.componentRef.setInput('sessionId', 'session 1');
    fixture.componentRef.setInput('messageAt', MESSAGE_AT);
    saved = [];
    fixture.componentInstance.feedbackSaved.subscribe((r) => saved.push(r));
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
  });

  afterEach(() => http.verify());

  const button = (label: string) =>
    el.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;

  it('renders the overall strip and all five blocks in contract order', () => {
    expect(button('Confidence details for overall confidence').textContent).toContain(
      'High · 86%',
    );
    const kinds = Array.from(el.querySelectorAll('[data-block]')).map((b) =>
      b.getAttribute('data-block'),
    );
    expect(kinds).toEqual([
      'interpretation',
      'data-selection',
      'assumptions',
      'metric',
      'sql',
    ]);
    const text = el.textContent ?? '';
    for (const title of [
      'Interpretation',
      'Data selection',
      'Assumptions',
      'Metric definition',
      'Annotated SQL',
    ]) {
      expect(text).toContain(title);
    }
    // Interpretation: term mapping, basis chip, source caption, alternatives.
    expect(text).toContain('“tech employees”');
    expect(text).toContain('employees in the Technology division');
    expect(text).toContain('Also considered');
    // Data selection: the diagram and both lists.
    expect(el.querySelectorAll('app-table-join-diagram g[data-node]').length).toBe(4);
    expect(el.querySelectorAll('app-table-join-diagram g[data-edge]').length).toBe(3);
    expect(text).toContain('Why these tables');
    expect(text).toContain('Job family does not define tech.');
    // Assumptions: fragment and alternative.
    expect(text).toContain("e.employment_type = 'employee'");
    expect(text).toContain('If wrong: Including contractors and interns lowers the average.');
    // Metric and SQL.
    expect(text).toContain('AVG(annual_base_amount * rate_to_usd)');
    expect(el.querySelector('[aria-label="Final SQL"]')?.textContent).toBe(SQL);
    expect(text).toContain('Returned 1 row');
  });

  it('colours badges by band and basis chips by source', () => {
    const block = (kind: string) => el.querySelector(`[data-block="${kind}"]`)!;
    expect(
      button('Confidence details for Data selection').className,
    ).toContain('text-amber-400');
    expect(button('Confidence details for Assumptions').className).toContain(
      'text-red-400',
    );
    const chips = Array.from(
      block('interpretation').querySelectorAll<HTMLElement>('[title]'),
    ).filter((chip) => ['Knowledge', 'Convention'].includes(chip.textContent!.trim()));
    expect(chips[0].className).toContain('text-emerald-400');
    expect(chips[0].title).toContain('Tech employees');
    expect(chips[2].className).toContain('text-amber-400');
    const guess = Array.from(
      block('assumptions').querySelectorAll<HTMLElement>('span'),
    ).find((chip) => chip.textContent?.trim() === 'Assumption')!;
    expect(guess.className).toContain('text-red-400');
  });

  it('opens the signals behind a badge on click', () => {
    const badge = button('Confidence details for Annotated SQL');
    expect(badge.getAttribute('aria-expanded')).toBe('false');
    expect(el.querySelector('[data-block="sql"] [data-signal]')).toBeNull();

    badge.click();
    fixture.detectChanges();

    expect(badge.getAttribute('aria-expanded')).toBe('true');
    const signals = el.querySelectorAll('[data-block="sql"] [data-signal]');
    expect(signals.length).toBe(2);
    expect(signals[0].textContent).toContain('Query ran cleanly');
    expect(signals[0].textContent).toContain('100%');
    expect(signals[0].textContent).toContain('weight 0.25');
    expect(signals[0].textContent).toContain('1 row, no repair, no warnings');

    badge.click();
    fixture.detectChanges();
    expect(el.querySelector('[data-block="sql"] [data-signal]')).toBeNull();
  });

  it('highlights the clause of the hovered annotation inside the SQL', () => {
    const notes = el.querySelectorAll<HTMLElement>('[aria-label="SQL annotations"] li');
    expect(notes.length).toBe(3);
    expect(el.querySelector('mark.qti-sql-hl')).toBeNull();

    notes[1].dispatchEvent(new MouseEvent('mouseenter'));
    fixture.detectChanges();
    const mark = el.querySelector('mark.qti-sql-hl')!;
    expect(mark.textContent).toContain("s.effective_from <= DATE '2025-12-31'");
    expect(mark.textContent).toContain("s.effective_to > DATE '2025-12-31'");
    // The SQL text itself is untouched by the highlight.
    expect(el.querySelector('[aria-label="Final SQL"]')?.textContent).toBe(SQL);

    notes[1].dispatchEvent(new MouseEvent('mouseleave'));
    fixture.detectChanges();
    expect(el.querySelector('mark.qti-sql-hl')).toBeNull();
  });

  it('votes on one block optimistically and posts only the vote', () => {
    const down = button('Mark Data selection as wrong');
    down.click();
    fixture.detectChanges();
    expect(down.getAttribute('aria-pressed')).toBe('true');
    expect(down.className).toContain('text-red-400');

    const req = http.expectOne(
      `${API_BASE_URL}/sessions/session%201/expert/feedback`,
    );
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      messageAt: MESSAGE_AT,
      block: 'data-selection',
      vote: 'down',
    });
    const result: SessionActionResult = { ok: true, message: 'Feedback saved' };
    req.flush(result);
    expect(saved).toEqual([result]);
  });

  it('clears a vote when the same thumb is clicked again', () => {
    const up = button('Mark Metric definition as right');
    expect(up.getAttribute('aria-pressed')).toBe('true');
    up.click();
    fixture.detectChanges();
    expect(up.getAttribute('aria-pressed')).toBe('false');
    const req = http.expectOne(
      `${API_BASE_URL}/sessions/session%201/expert/feedback`,
    );
    expect(req.request.body).toEqual({
      messageAt: MESSAGE_AT,
      block: 'metric',
      vote: null,
    });
    req.flush({ ok: true, message: 'Cleared' });
  });

  it('rolls a vote back and toasts when saving fails', () => {
    const toast = TestBed.inject(ToastService);
    const error = spyOn(toast, 'error');
    const up = button('Mark Interpretation as right');
    up.click();
    fixture.detectChanges();
    expect(up.getAttribute('aria-pressed')).toBe('true');

    http
      .expectOne(`${API_BASE_URL}/sessions/session%201/expert/feedback`)
      .flush({ message: 'Trace not found' }, { status: 404, statusText: 'Not Found' });
    fixture.detectChanges();

    expect(up.getAttribute('aria-pressed')).toBe('false');
    expect(error).toHaveBeenCalledWith('Trace not found');
    expect(saved).toEqual([]);
  });

  it('saves a note without touching the vote, pre-filling an existing one', () => {
    // Existing note shows and pre-fills the editor.
    expect(el.textContent).toContain('“Matches the finance definition.”');
    button('Edit note on Metric definition').click();
    fixture.detectChanges();
    const existing = el.querySelector<HTMLTextAreaElement>(
      '[aria-label="Note on Metric definition"]',
    )!;
    expect(existing.value).toBe('Matches the finance definition.');
    button('Edit note on Metric definition').click();
    fixture.detectChanges();

    button('Add note on Annotated SQL').click();
    fixture.detectChanges();
    const box = el.querySelector<HTMLTextAreaElement>(
      '[aria-label="Note on Annotated SQL"]',
    )!;
    expect(box.value).toBe('');
    box.value = '  Should exclude people who left before 31 December.  ';
    box.dispatchEvent(new Event('input'));
    button('Save note on Annotated SQL').click();
    fixture.detectChanges();

    const req = http.expectOne(
      `${API_BASE_URL}/sessions/session%201/expert/feedback`,
    );
    expect(req.request.body).toEqual({
      messageAt: MESSAGE_AT,
      block: 'sql',
      comment: 'Should exclude people who left before 31 December.',
    });
    // While the save is in flight the editor stays open (learning runs
    // synchronously on comment save) and the button says so.
    const saveBtn = button('Save note on Annotated SQL');
    expect(saveBtn.textContent?.trim()).toContain('Save & teach');
    expect(saveBtn.disabled).toBeTrue();
    expect(
      el.querySelector('[aria-label="Note on Annotated SQL"]'),
    ).toBeTruthy();

    req.flush({ ok: true, message: 'Note saved' });
    fixture.detectChanges();
    expect(saved.length).toBe(1);
    // Saved: the editor closes and the comment shows as persisted.
    expect(el.querySelector('[aria-label="Note on Annotated SQL"]')).toBeNull();
    expect(el.textContent).toContain(
      '“Should exclude people who left before 31 December.”',
    );
  });

  it('shows a "Learned from your note" chip on a basis chip matching a learned title', () => {
    fixture.componentRef.setInput('learnedTitles', ['Tech employees']);
    fixture.detectChanges();
    // The interpretation term "tech employees" carries sourceRef "Tech
    // employees" — a case-insensitive match.
    const chip = el.querySelector('[title="Learned from your feedback note"]');
    expect(chip).toBeTruthy();
    expect(chip?.textContent).toContain('Learned from your note');

    // The convention-basis term has no sourceRef, so no chip for it.
    const conventionChips = Array.from(
      el.querySelectorAll('[title="Learned from your feedback note"]'),
    );
    expect(conventionChips.length).toBe(1);
  });

  it('shows no "Learned from your note" chip when learnedTitles is empty', () => {
    expect(
      el.querySelector('[title="Learned from your feedback note"]'),
    ).toBeNull();
  });

  it('re-seeds feedback from a refreshed trace', () => {
    fixture.componentRef.setInput('trace', {
      ...SAMPLE_TRACE,
      feedback: { sql: { vote: 'down', at: '2026-09-29T12:10:00.000Z' } },
    });
    fixture.detectChanges();
    expect(
      button('Mark Annotated SQL as wrong').getAttribute('aria-pressed'),
    ).toBe('true');
    expect(
      button('Mark Metric definition as right').getAttribute('aria-pressed'),
    ).toBe('false');
  });

  it('collapses to the overall strip', () => {
    button('Hide reasoning').click();
    fixture.detectChanges();
    expect(el.querySelectorAll('[data-block]').length).toBe(0);
    expect(button('Show reasoning')).toBeTruthy();
    expect(button('Confidence details for overall confidence')).toBeTruthy();
  });
});
