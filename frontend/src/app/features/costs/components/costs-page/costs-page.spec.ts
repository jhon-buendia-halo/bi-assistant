import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ShellState } from '../../../../core/shell/shell-state';
import { MonitoringStateService } from '../../../monitoring/services/monitoring-state.service';
import { UsageSummary, periodStart } from '../../models/usage.model';
import { CostsPage, niceCeiling } from './costs-page';

const SUMMARY: UsageSummary = {
  from: '2026-10-17T05:00:00.000Z',
  to: '2026-11-15T17:00:00.000Z',
  timeZone: 'America/Bogota',
  today: { costUsd: 1.5, calls: 3 },
  thisMonth: { costUsd: 12.25, calls: 40 },
  totals: {
    costUsd: 20,
    calls: 61,
    pricedCalls: 60,
    inputTokens: 1_200_000,
    outputTokens: 45_000,
  },
  daily: [
    { date: '2026-11-14', costUsd: 4, calls: 10 },
    { date: '2026-11-15', costUsd: 1.5, calls: 3 },
  ],
  monthly: Array.from({ length: 12 }, (_, i) => ({
    month: `2026-${String(i + 1).padStart(2, '0')}`,
    costUsd: i === 10 ? 7.75 : 0,
    calls: i === 10 ? 21 : 0,
  })),
  byModel: [
    {
      model: 'claude-sonnet-5-5',
      provider: 'anthropic',
      costUsd: 20,
      calls: 60,
      inputTokens: 1,
      outputTokens: 1,
      priced: true,
    },
    {
      model: 'local-llama',
      provider: 'custom',
      costUsd: 0,
      calls: 1,
      inputTokens: 1,
      outputTokens: 1,
      priced: false,
    },
  ],
  byWorkflow: [
    {
      id: 'wf-1',
      name: 'Answer a Business Question',
      kind: 'workflow',
      costUsd: 15,
      calls: 40,
    },
    { id: null, name: 'No workflow', kind: 'none', costUsd: 5, calls: 21 },
  ],
  byAgent: [{ id: 'assistant', name: 'Assistant', costUsd: 20, calls: 61 }],
};

describe('CostsPage', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CostsPage],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
  });

  function render() {
    const fixture = TestBed.createComponent(CostsPage);
    const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    const req = http.expectOne((r) => r.url.endsWith('/monitoring/usage'));
    return { fixture, http, req, el: fixture.nativeElement as HTMLElement };
  }

  it('asks for the last 30 days in the local time zone and shows the KPIs', () => {
    const { fixture, req, el } = render();
    expect(req.request.params.get('tz')).toBeTruthy();
    const from = new Date(req.request.params.get('from') as string);
    expect(from.getTime()).toBe((periodStart('30d') as Date).getTime());
    req.flush(SUMMARY);
    fixture.detectChanges();

    expect(
      el.querySelector('[data-testid="kpi-today"]')?.textContent,
    ).toContain('$1.50');
    expect(
      el.querySelector('[data-testid="kpi-month"]')?.textContent,
    ).toContain('$12.25');
    expect(
      el.querySelector('[data-testid="kpi-period"]')?.textContent,
    ).toContain('$20.00');
    expect(
      el.querySelector('[data-testid="kpi-period"]')?.textContent,
    ).toContain('61 calls');
    expect(
      el.querySelector('[data-testid="costs-unpriced"]')?.textContent,
    ).toContain('1 call ');
    expect(
      el.querySelectorAll('[data-testid^="costs-daily-bar-"]').length,
    ).toBe(2);
    expect(
      el.querySelectorAll('[data-testid^="costs-monthly-bar-"]').length,
    ).toBe(12);
    expect(
      el.querySelectorAll('[data-testid="costs-workflow-row"]').length,
    ).toBe(2);
    expect(
      el.querySelector('[data-testid="costs-by-model"]')?.textContent,
    ).toContain('No price');
  });

  it('asks again without a start for All time', () => {
    const { fixture, http, req } = render();
    req.flush(SUMMARY);
    const select = fixture.nativeElement.querySelector(
      '[data-testid="costs-period"]',
    ) as HTMLSelectElement;
    select.value = 'all';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    const next = http.expectOne((r) => r.url.endsWith('/monitoring/usage'));
    expect(next.request.params.has('from')).toBeFalse();
  });

  it('shows the chart data as a table on demand', () => {
    const { fixture, req, el } = render();
    req.flush(SUMMARY);
    fixture.detectChanges();
    (
      el.querySelector(
        '[data-testid="costs-daily-toggle"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    const rows = el.querySelectorAll('[data-testid="costs-daily"] tbody tr');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('$4.00');
  });

  it('opens Monitoring filtered to an agent over the period', () => {
    const { fixture, req, el } = render();
    req.flush(SUMMARY);
    fixture.detectChanges();
    (
      el.querySelector('[data-testid="costs-agent-row"]') as HTMLButtonElement
    ).click();

    const monitoring = TestBed.inject(MonitoringStateService);
    expect(monitoring.filters().agent).toBe('assistant');
    expect(monitoring.filters().range).toBe('custom');
    expect(monitoring.filters().from).toMatch(/^\d{4}-\d{2}-\d{2}T00:00$/);
    expect(monitoring.tab()).toBe('calls');
    expect(TestBed.inject(ShellState).currentArea()).toBe('monitoring');
  });

  it('shows the empty state with no calls in the period', () => {
    const { fixture, req, el } = render();
    req.flush({
      ...SUMMARY,
      totals: {
        costUsd: 0,
        calls: 0,
        pricedCalls: 0,
        inputTokens: 0,
        outputTokens: 0,
      },
      daily: [],
      byModel: [],
      byWorkflow: [],
      byAgent: [],
    });
    fixture.detectChanges();
    expect(
      el.querySelector('[data-testid="costs-empty"]')?.textContent?.trim(),
    ).toBe('No LLM calls in this period.');
    expect(
      el.querySelector('[data-testid="costs-monthly-chart"]'),
    ).not.toBeNull();
    expect(el.querySelector('[data-testid="costs-by-model"]')).toBeNull();
  });

  it('shows the backend reason when the load fails', () => {
    const { fixture, req, el } = render();
    req.flush(
      { message: 'Time zone is not valid' },
      { status: 400, statusText: 'Bad Request' },
    );
    fixture.detectChanges();
    expect(el.querySelector('[role="alert"]')?.textContent).toContain(
      'Could not load usage: Time zone is not valid',
    );
  });

  it('rounds the scale up to a round ceiling', () => {
    expect(niceCeiling(0)).toBe(1);
    expect(niceCeiling(3.2)).toBe(5);
    expect(niceCeiling(0.0042)).toBeCloseTo(0.005);
    expect(niceCeiling(20)).toBe(20);
    expect(niceCeiling(21)).toBe(25);
  });
});
