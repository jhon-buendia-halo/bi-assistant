import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { MonitoringApiService } from '../../services/monitoring-api.service';
import { MonitoringStateService } from '../../services/monitoring-state.service';
import {
  SessionPage,
  SessionQuery,
  SessionRow,
} from '../../models/session-flow.model';
import { SessionsPage } from './sessions-page';

function sessionRow(id: string, extra: Partial<SessionRow> = {}): SessionRow {
  return {
    id,
    name: 'Monitoring probe',
    agents: [{ id: 'assistant', name: 'Questions to Insights Assistant' }],
    turns: 2,
    firstAt: '2026-11-10T10:00:00.000Z',
    lastAt: '2026-11-10T10:01:00.000Z',
    wallMs: 20900,
    modelMs: 20800,
    toolCalls: 6,
    inputTokens: 79225,
    outputTokens: 2644,
    costUsd: 0.0776,
    errors: 0,
    status: 'succeeded',
    ...extra,
  };
}

function page(
  items: SessionRow[],
  extra: Partial<SessionPage> = {},
): SessionPage {
  return {
    items,
    total: items.length,
    page: 1,
    pageSize: 25,
    facets: {
      agents: [
        { id: 'assistant', name: 'Questions to Insights Assistant' },
        { id: 'visualization', name: 'Visual Designer' },
      ],
    },
    ...extra,
  };
}

describe('SessionsPage', () => {
  let fixture: ComponentFixture<SessionsPage>;
  let api: jasmine.SpyObj<MonitoringApiService>;
  let state: MonitoringStateService;
  let el: HTMLElement;

  async function render(
    response: SessionPage | Error = page([sessionRow('session-1')]),
  ): Promise<void> {
    api = jasmine.createSpyObj<MonitoringApiService>('MonitoringApiService', [
      'listSessions',
    ]);
    api.listSessions.and.returnValue(
      response instanceof Error
        ? throwError(() => ({ status: 500, error: { message: 'down' } }))
        : of(response),
    );
    await TestBed.configureTestingModule({
      imports: [SessionsPage],
      providers: [{ provide: MonitoringApiService, useValue: api }],
    }).compileComponents();
    state = TestBed.inject(MonitoringStateService);
    fixture = TestBed.createComponent(SessionsPage);
    el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const q = (id: string) =>
    el.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

  function lastQuery(): SessionQuery {
    return api.listSessions.calls.mostRecent().args[0];
  }

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('lists a session with its agents, turns, times, tokens, cost and status', async () => {
    await render();
    expect(lastQuery()).toEqual({ page: 1, pageSize: 25 });
    const row = q('monitoring-session-row-session-1')!;
    const cells = Array.from(row.querySelectorAll('td')).map((td) =>
      td.textContent!.replace(/\s+/g, ' ').trim(),
    );
    expect(cells[0]).toBe('Monitoring probe');
    expect(cells[1]).toBe('Questions to Insights Assistant');
    expect(cells[2]).toBe('2');
    expect(cells[4]).toBe('20.9 s');
    expect(cells[5]).toBe('20.8 s');
    expect(cells[6]).toBe('6');
    expect(cells[7]).toBe('79,225 / 2,644');
    expect(cells[8]).toBe('$0.0776');
    expect(cells[9]).toBe('Succeeded');
    const headers = Array.from(
      el.querySelectorAll('[data-testid="monitoring-sessions-table"] th'),
    ).map((th) => th.textContent!.trim());
    expect(headers).toEqual([
      'Session',
      'Agent',
      'Turns',
      'Last activity',
      'Wall time',
      'Model time',
      'Tools',
      'Tokens in / out',
      'Cost',
      'Status',
    ]);
  });

  it('shows "Unnamed session" with the short id when the session is gone', async () => {
    await render(
      page([
        sessionRow('abcdef1234567890', {
          name: null,
          agents: [],
          costUsd: null,
          status: 'failed',
        }),
      ]),
    );
    const row = q('monitoring-session-row-abcdef1234567890')!;
    const first = row.querySelector('td')!;
    expect(first.textContent).toContain('Unnamed session');
    expect(first.querySelector('.font-mono')!.textContent!.trim()).toBe(
      'abcdef12',
    );
    expect(row.querySelectorAll('td')[1].textContent!.trim()).toBe('—');
    expect(row.querySelectorAll('td')[8].textContent!.trim()).toBe('—');
    expect(q('monitoring-session-status-abcdef1234567890')!.className).toContain(
      'chip-danger',
    );
  });

  it('opens a session on click and on Enter', async () => {
    await render();
    const opened: string[] = [];
    fixture.componentInstance.openSession.subscribe((id) => opened.push(id));
    const row = q('monitoring-session-row-session-1')!;
    row.click();
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(opened).toEqual(['session-1', 'session-1']);
  });

  it('offers the agents from the facets and filters by one', async () => {
    await render();
    const select = q('session-filter-agent') as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent!.trim())).toEqual([
      'All agents',
      'Questions to Insights Assistant',
      'Visual Designer',
    ]);
    select.value = 'visualization';
    select.dispatchEvent(new Event('change'));
    await settle();
    expect(state.sessionFilters().agent).toBe('visualization');
    expect(lastQuery()).toEqual({
      page: 1,
      pageSize: 25,
      agent: 'visualization',
    });
    expect((q('session-filters-clear') as HTMLButtonElement).disabled).toBeFalse();
  });

  it('shows From and To only for a custom date range and sends them', async () => {
    await render();
    expect(q('session-filter-from')).toBeNull();
    const range = q('session-filter-range') as HTMLSelectElement;
    expect(Array.from(range.options).map((o) => o.textContent!.trim())).toEqual([
      'Any time',
      'Last hour',
      'Last 24 hours',
      'Last 7 days',
      'Custom',
    ]);
    range.value = 'custom';
    range.dispatchEvent(new Event('change'));
    await settle();
    const from = q('session-filter-from') as HTMLInputElement;
    expect(q('session-filter-to')).toBeTruthy();
    from.value = '2026-11-01T10:00';
    from.dispatchEvent(new Event('change'));
    await settle();
    expect(lastQuery().from).toBe(new Date('2026-11-01T10:00').toISOString());
  });

  it('says no sessions yet, or none match the filters', async () => {
    await render(page([]));
    expect(q('monitoring-sessions-empty')!.textContent!.trim()).toBe(
      'No sessions yet.',
    );
    expect((q('session-filters-clear') as HTMLButtonElement).disabled).toBeTrue();

    state.setSessionFilter('range', 'hour');
    await settle();
    expect(q('monitoring-sessions-empty')!.textContent!.trim()).toBe(
      'No sessions match these filters.',
    );
    (q('session-filters-clear') as HTMLButtonElement).click();
    await settle();
    expect(state.hasSessionFilters()).toBeFalse();
    expect(lastQuery()).toEqual({ page: 1, pageSize: 25 });
  });

  it('pages through the sessions and changes the page size', async () => {
    const rows = Array.from({ length: 25 }, (_, i) => sessionRow(`s-${i}`));
    await render(page(rows, { total: 60 }));
    expect(q('session-page-summary')!.textContent!.trim()).toBe('1–25 of 60');
    expect((q('session-page-prev') as HTMLButtonElement).disabled).toBeTrue();

    (q('session-page-next') as HTMLButtonElement).click();
    await settle();
    expect(state.sessionPage()).toBe(2);
    expect(lastQuery()).toEqual({ page: 2, pageSize: 25 });
    expect(q('session-page-summary')!.textContent!.trim()).toBe('26–50 of 60');
    expect((q('session-page-prev') as HTMLButtonElement).disabled).toBeFalse();

    const size = q('session-page-size') as HTMLSelectElement;
    size.value = '50';
    size.dispatchEvent(new Event('change'));
    await settle();
    expect(lastQuery()).toEqual({ page: 1, pageSize: 50 });
  });

  it('keeps the filters and page in the state service across renders', async () => {
    await render();
    state.setSessionFilter('agent', 'assistant');
    state.setSessionPage(1);
    fixture.destroy();
    const again = TestBed.createComponent(SessionsPage);
    again.detectChanges();
    await again.whenStable();
    again.detectChanges();
    const select = (again.nativeElement as HTMLElement).querySelector(
      '[data-testid="session-filter-agent"]',
    ) as HTMLSelectElement;
    expect(select.value).toBe('assistant');
    expect(lastQuery().agent).toBe('assistant');
  });

  it('shows the reason when the sessions cannot be loaded', async () => {
    await render(new Error('down'));
    expect(q('monitoring-sessions-error')!.textContent!.trim()).toBe(
      'Could not load sessions: down',
    );
  });
});
